<?php

declare(strict_types=1);

namespace App\Services;

use DomainException;
use PDO;

/**
 * Organizational folders (database-only — not filesystem directories).
 *
 * A folder is a bit (bit_type = 'folder') with metadata in bit_folders
 * (name lives on bits.title, plus color + icon + workspace scope).
 *
 * Membership reuses bit_relations with relation_type = 'member':
 *   - folder -> doc     : the doc lives in that folder (a doc bit may be the
 *     child of MANY folders, so one note exists in several places at once —
 *     edits reflect everywhere because it is the same bit)
 *   - folder -> folder  : nesting
 * Position drives ordering inside a folder.
 */
final class FolderService
{
    public function __construct(private PDO $pdo, private WorkspaceService $workspaces)
    {
    }

    /** Folders + ordered memberships for the workspace tree. */
    public function treePayload(int $userId, int $workspaceId): array
    {
        if (!$this->workspaces->belongsToUser($userId, $workspaceId)) {
            return ['folders' => [], 'memberships' => []];
        }

        $foldersStmt = $this->pdo->prepare(
            'SELECT bf.bit_id, b.title AS name, bf.color_hex, bf.icon_key
             FROM bit_folders bf
             INNER JOIN bits b ON b.id = bf.bit_id
             WHERE bf.workspace_id = :workspace_id
             ORDER BY b.title ASC'
        );
        $foldersStmt->execute(['workspace_id' => $workspaceId]);

        $membershipsStmt = $this->pdo->prepare(
            'SELECT r.parent_bit_id AS folder_id, r.child_bit_id AS item_id, r.position
             FROM bit_relations r
             INNER JOIN bit_folders bf ON bf.bit_id = r.parent_bit_id
             WHERE bf.workspace_id = :workspace_id
               AND r.relation_type = :relation_type
             ORDER BY r.parent_bit_id ASC, r.position ASC, r.id ASC'
        );
        $membershipsStmt->execute([
            'workspace_id' => $workspaceId,
            'relation_type' => 'member',
        ]);

        return [
            'folders' => $foldersStmt->fetchAll(),
            'memberships' => $membershipsStmt->fetchAll(),
        ];
    }

    public function create(
        int $userId,
        int $workspaceId,
        string $name,
        string $colorHex,
        ?string $iconKey,
        ?int $parentFolderId = null
    ): int {
        if (!$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Workspace not found');
        }

        $colorHex = $this->normalizeColor($colorHex);

        if ($parentFolderId !== null && !$this->folderInWorkspace($parentFolderId, $workspaceId)) {
            throw new DomainException('Parent folder not found');
        }

        $bitStmt = $this->pdo->prepare(
            "INSERT INTO bits (owner_user_id, bit_type, title, content_preview)
             VALUES (:owner, 'folder', :title, '')"
        );
        $bitStmt->execute([
            'owner' => $userId,
            'title' => trim($name) !== '' ? trim($name) : 'New folder',
        ]);
        $folderId = (int) $this->pdo->lastInsertId();

        $metaStmt = $this->pdo->prepare(
            'INSERT INTO bit_folders (bit_id, workspace_id, color_hex, icon_key)
             VALUES (:bit_id, :workspace_id, :color_hex, :icon_key)'
        );
        $metaStmt->execute([
            'bit_id' => $folderId,
            'workspace_id' => $workspaceId,
            'color_hex' => $colorHex,
            'icon_key' => $iconKey !== null && trim($iconKey) !== '' ? trim($iconKey) : null,
        ]);

        if ($parentFolderId !== null) {
            $this->attach($parentFolderId, $folderId);
        }

        return $folderId;
    }

    public function update(
        int $userId,
        int $folderId,
        ?string $name,
        ?string $colorHex,
        ?string $iconKey
    ): void {
        $workspaceId = $this->workspaceForFolder($folderId);
        if ($workspaceId === null || !$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Folder not found');
        }

        if ($name !== null) {
            $stmt = $this->pdo->prepare(
                'UPDATE bits SET title = :title, updated_at = UTC_TIMESTAMP() WHERE id = :id'
            );
            $stmt->execute([
                'title' => trim($name) !== '' ? trim($name) : 'New folder',
                'id' => $folderId,
            ]);
        }

        $fields = [];
        $params = ['bit_id' => $folderId];
        if ($colorHex !== null) {
            $fields[] = 'color_hex = :color_hex';
            $params['color_hex'] = $this->normalizeColor($colorHex);
        }
        if ($iconKey !== null) {
            $fields[] = 'icon_key = :icon_key';
            $params['icon_key'] = trim($iconKey) !== '' ? trim($iconKey) : null;
        }
        if (!empty($fields)) {
            $stmt = $this->pdo->prepare(
                'UPDATE bit_folders SET ' . implode(', ', $fields) . ' WHERE bit_id = :bit_id'
            );
            $stmt->execute($params);
        }
    }

    /** Deletes the folder + descendant folders; member docs are left intact. */
    public function delete(int $userId, int $folderId): void
    {
        $workspaceId = $this->workspaceForFolder($folderId);
        if ($workspaceId === null || !$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Folder not found');
        }

        $toDelete = [];
        $queue = [$folderId];

        while (!empty($queue)) {
            $current = (int) array_shift($queue);
            $toDelete[] = $current;

            $childrenStmt = $this->pdo->prepare(
                "SELECT r.child_bit_id
                 FROM bit_relations r
                 INNER JOIN bits b ON b.id = r.child_bit_id
                 WHERE r.parent_bit_id = :parent
                   AND r.relation_type = 'member'
                   AND b.bit_type = 'folder'"
            );
            $childrenStmt->execute(['parent' => $current]);
            foreach ($childrenStmt->fetchAll() as $row) {
                $queue[] = (int) $row['child_bit_id'];
            }
        }

        // bit_relations has no FK constraints on parent/child, so remove all
        // 'member' relations that reference the deleted folders explicitly
        // (both as parent — docs/subfolders inside them — and as child — the
        // folder's own place in its parent). Docs themselves are untouched.
        $placeholders = implode(',', array_fill(0, count($toDelete), '?'));

        $deleteAsParent = $this->pdo->prepare(
            "DELETE FROM bit_relations WHERE relation_type = 'member' AND parent_bit_id IN ($placeholders)"
        );
        $deleteAsParent->execute($toDelete);

        $deleteAsChild = $this->pdo->prepare(
            "DELETE FROM bit_relations WHERE relation_type = 'member' AND child_bit_id IN ($placeholders)"
        );
        $deleteAsChild->execute($toDelete);

        // Deleting the folder bits cascades bit_folders; docs stay intact.
        $deleteStmt = $this->pdo->prepare('DELETE FROM bits WHERE id = :id');
        foreach ($toDelete as $id) {
            $deleteStmt->execute(['id' => $id]);
        }
    }

    public function addDoc(int $userId, int $folderId, int $docId): void
    {
        $workspaceId = $this->workspaceForFolder($folderId);
        if ($workspaceId === null || !$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Folder not found');
        }

        $docStmt = $this->pdo->prepare(
            'SELECT df.workspace_id, df.is_deleted, ws.owner_user_id AS owner_user_id
             FROM doc_files df
             INNER JOIN workspaces ws ON ws.id = df.workspace_id
             WHERE df.bit_id = :bit_id
             LIMIT 1'
        );
        $docStmt->execute(['bit_id' => $docId]);
        $doc = $docStmt->fetch();

        if (!$doc || !empty($doc['is_deleted'])) {
            throw new DomainException('Doc not found');
        }

        $isMulti = $this->workspaces->workspaceType($workspaceId) === 'multi';
        if ($isMulti) {
            // A multi-space folder may hold docs from ANY of the user's
            // workspaces (that is the whole point of a multi-space). The only
            // hard rule: it must be the user's own doc, never one that lives
            // in the multi-space itself (multi-spaces own no docs anyway).
            if ((int) $doc['owner_user_id'] !== $userId || (int) $doc['workspace_id'] === $workspaceId) {
                throw new DomainException('Doc not found');
            }
        } elseif ((int) $doc['workspace_id'] !== $workspaceId) {
            throw new DomainException('Doc not found');
        }

        $this->attach($folderId, $docId);
    }

    public function removeDoc(int $userId, int $folderId, int $docId): void
    {
        $workspaceId = $this->workspaceForFolder($folderId);
        if ($workspaceId === null || !$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Folder not found');
        }

        $stmt = $this->pdo->prepare(
            "DELETE FROM bit_relations
             WHERE parent_bit_id = :parent AND child_bit_id = :child AND relation_type = 'member'"
        );
        $stmt->execute(['parent' => $folderId, 'child' => $docId]);
    }

    public function moveFolder(int $userId, int $folderId, ?int $parentFolderId): void
    {
        $workspaceId = $this->workspaceForFolder($folderId);
        if ($workspaceId === null || !$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Folder not found');
        }

        if ($parentFolderId !== null) {
            if ($parentFolderId === $folderId || !$this->folderInWorkspace($parentFolderId, $workspaceId)) {
                throw new DomainException('Target folder not found');
            }
            if ($this->wouldCreateCycle($folderId, $parentFolderId)) {
                throw new DomainException('A folder cannot be moved inside itself');
            }
        }

        $detachStmt = $this->pdo->prepare(
            "DELETE FROM bit_relations WHERE child_bit_id = :child AND relation_type = 'member'"
        );
        $detachStmt->execute(['child' => $folderId]);

        if ($parentFolderId !== null) {
            $this->attach($parentFolderId, $folderId);
        }
    }

    public function reorderMembers(int $userId, int $folderId, array $itemIds): void
    {
        $workspaceId = $this->workspaceForFolder($folderId);
        if ($workspaceId === null || !$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Folder not found');
        }

        $stmt = $this->pdo->prepare(
            "UPDATE bit_relations
             SET position = :position
             WHERE parent_bit_id = :parent AND child_bit_id = :child AND relation_type = 'member'"
        );
        foreach (array_values($itemIds) as $index => $itemId) {
            $stmt->execute([
                'position' => $index + 1,
                'parent' => $folderId,
                'child' => (int) $itemId,
            ]);
        }
    }

    // ------------------------------------------------------------------ //
    // Helpers
    // ------------------------------------------------------------------ //

    private function folderInWorkspace(int $folderId, int $workspaceId): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT bit_id FROM bit_folders WHERE bit_id = :bit_id AND workspace_id = :workspace_id LIMIT 1'
        );
        $stmt->execute(['bit_id' => $folderId, 'workspace_id' => $workspaceId]);

        return (bool) $stmt->fetch();
    }

    private function workspaceForFolder(int $folderId): ?int
    {
        $stmt = $this->pdo->prepare(
            'SELECT workspace_id FROM bit_folders WHERE bit_id = :bit_id LIMIT 1'
        );
        $stmt->execute(['bit_id' => $folderId]);
        $row = $stmt->fetch();

        return $row ? (int) $row['workspace_id'] : null;
    }

    /** True if $newParentId is $folderId itself or already inside it. */
    private function wouldCreateCycle(int $folderId, int $newParentId): bool
    {
        $seen = [];
        $current = $newParentId;

        while ($current !== null && !in_array($current, $seen, true)) {
            if ($current === $folderId) {
                return true;
            }
            $seen[] = $current;

            $stmt = $this->pdo->prepare(
                "SELECT r.parent_bit_id
                 FROM bit_relations r
                 WHERE r.child_bit_id = :child AND r.relation_type = 'member' LIMIT 1"
            );
            $stmt->execute(['child' => $current]);
            $row = $stmt->fetch();
            $current = $row ? (int) $row['parent_bit_id'] : null;
        }

        return false;
    }

    private function attach(int $parentFolderId, int $childId): void
    {
        $existsStmt = $this->pdo->prepare(
            "SELECT id FROM bit_relations
             WHERE parent_bit_id = :parent AND child_bit_id = :child AND relation_type = 'member' LIMIT 1"
        );
        $existsStmt->execute(['parent' => $parentFolderId, 'child' => $childId]);
        if ($existsStmt->fetch()) {
            return;
        }

        $stmt = $this->pdo->prepare(
            "INSERT INTO bit_relations (parent_bit_id, child_bit_id, relation_type, position)
             VALUES (:parent, :child, 'member', :position)"
        );
        $stmt->execute([
            'parent' => $parentFolderId,
            'child' => $childId,
            'position' => $this->nextPosition($parentFolderId),
        ]);
    }

    private function nextPosition(int $parentFolderId): int
    {
        $stmt = $this->pdo->prepare(
            "SELECT COALESCE(MAX(position), 0) + 1 AS next_position
             FROM bit_relations
             WHERE parent_bit_id = :parent AND relation_type = 'member'"
        );
        $stmt->execute(['parent' => $parentFolderId]);

        return (int) ($stmt->fetch()['next_position'] ?? 1);
    }

    private function normalizeColor(string $colorHex): string
    {
        $colorHex = trim($colorHex);

        return preg_match('/^#[0-9a-fA-F]{6}$/', $colorHex) === 1
            ? strtoupper($colorHex)
            : '#5B5BD6';
    }
}
