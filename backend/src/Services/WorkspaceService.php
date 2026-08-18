<?php

declare(strict_types=1);

namespace App\Services;

use DomainException;
use PDO;

final class WorkspaceService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function list(int $userId): array
    {
        // The hidden per-user 'external' workspace (which backs docs linked in
        // place by absolute path) never appears in the UI.
        $stmt = $this->pdo->prepare(
            'SELECT id, name, description, type, color_hex, icon_key, created_at, updated_at
             FROM workspaces
             WHERE owner_user_id = :user_id AND type <> :hidden_type
             ORDER BY updated_at DESC, id DESC'
        );
        $stmt->execute(['user_id' => $userId, 'hidden_type' => 'external']);

        return $stmt->fetchAll();
    }

    public function create(
        int $userId,
        string $name,
        string $description = '',
        string $type = 'folder',
        ?string $colorHex = null,
        ?string $iconKey = null
    ): int {
        $type = in_array($type, ['multi', 'external'], true) ? $type : 'folder';
        $stmt = $this->pdo->prepare(
            'INSERT INTO workspaces (owner_user_id, name, description, type, color_hex, icon_key)
             VALUES (:owner_user_id, :name, :description, :type, :color_hex, :icon_key)'
        );
        $stmt->execute([
            'owner_user_id' => $userId,
            'name' => trim($name) !== '' ? trim($name) : 'Untitled workspace',
            'description' => trim($description),
            'type' => $type,
            'color_hex' => $this->normalizeColor($colorHex),
            'icon_key' => $this->normalizeIcon($iconKey),
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    /**
     * Update a workspace's name/description/type/color/icon. Only fields that
     * were provided (not null) are touched, so a caller can update just one of
     * them. The TYPE can be switched between 'folder' and 'multi' — switching
     * TO 'multi' keeps existing docs (they become linked); switching back to
     * 'folder' hides the multi-space link UI.
     */
    public function update(
        int $userId,
        int $workspaceId,
        ?string $name,
        ?string $description,
        ?string $type = null,
        ?string $colorHex = null,
        ?string $iconKey = null
    ): void {
        if (!$this->belongsToUser($userId, $workspaceId)) {
            return;
        }

        $fields = [];
        $params = ['id' => $workspaceId];

        $oldType = $this->workspaceType($workspaceId);
        $newType = null;
        if ($type !== null) {
            $newType = $type === 'multi' ? 'multi' : 'folder';
            $fields[] = 'type = :type';
            $params['type'] = $newType;
        }

        if ($name !== null) {
            $fields[] = 'name = :name';
            $params['name'] = trim($name) !== '' ? trim($name) : 'Untitled workspace';
        }
        if ($description !== null) {
            $fields[] = 'description = :description';
            $params['description'] = trim((string) $description);
        }
        if ($colorHex !== null) {
            $fields[] = 'color_hex = :color_hex';
            $params['color_hex'] = $this->normalizeColor($colorHex);
        }
        if ($iconKey !== null) {
            $fields[] = 'icon_key = :icon_key';
            $params['icon_key'] = $this->normalizeIcon($iconKey);
        }

        if (empty($fields)) {
            return;
        }

        $stmt = $this->pdo->prepare(
            'UPDATE workspaces SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE id = :id'
        );
        $stmt->execute($params);

        // Type switch side-effects. Converting a workspace TO multi auto-links
        // its existing docs so none vanish from the tree (they become linked
        // docs that keep living/syncing in this same workspace). Converting
        // back to a folder drops the multi-space link rows.
        if ($newType !== null && $newType !== $oldType) {
            if ($newType === 'multi') {
                $linkStmt = $this->pdo->prepare(
                    'INSERT IGNORE INTO workspace_doc_links (workspace_id, bit_id)
                     SELECT :workspace_id, bit_id FROM doc_files
                     WHERE workspace_id = :workspace_id AND is_deleted = 0'
                );
                $linkStmt->execute(['workspace_id' => $workspaceId]);
            } else {
                $unlinkStmt = $this->pdo->prepare(
                    'DELETE FROM workspace_doc_links WHERE workspace_id = :workspace_id'
                );
                $unlinkStmt->execute(['workspace_id' => $workspaceId]);
            }
        }
    }

    public function delete(int $userId, int $workspaceId): void
    {
        if (!$this->belongsToUser($userId, $workspaceId)) {
            return;
        }
        // The hidden linked-files workspace is never user-deletable.
        if ($this->workspaceType($workspaceId) === 'external') {
            return;
        }

        // Collect every bit owned by this workspace: docs AND folders.
        $bitIds = [];
        $docStmt = $this->pdo->prepare('SELECT bit_id FROM doc_files WHERE workspace_id = :workspace_id');
        $docStmt->execute(['workspace_id' => $workspaceId]);
        foreach ($docStmt->fetchAll() as $row) {
            $bitIds[] = (int) $row['bit_id'];
        }
        $folderStmt = $this->pdo->prepare('SELECT bit_id FROM bit_folders WHERE workspace_id = :workspace_id');
        $folderStmt->execute(['workspace_id' => $workspaceId]);
        foreach ($folderStmt->fetchAll() as $row) {
            $bitIds[] = (int) $row['bit_id'];
        }

        $bitIds = array_values(array_unique($bitIds));

        if (!empty($bitIds)) {
            // bit_relations has no FKs on parent/child, so remove member
            // relations referencing these bits explicitly before deleting.
            $placeholders = implode(',', array_fill(0, count($bitIds), '?'));

            $relAsParent = $this->pdo->prepare(
                "DELETE FROM bit_relations WHERE relation_type = 'member' AND parent_bit_id IN ($placeholders)"
            );
            $relAsParent->execute($bitIds);

            $relAsChild = $this->pdo->prepare(
                "DELETE FROM bit_relations WHERE relation_type = 'member' AND child_bit_id IN ($placeholders)"
            );
            $relAsChild->execute($bitIds);

            $deleteBit = $this->pdo->prepare('DELETE FROM bits WHERE id = :id');
            foreach ($bitIds as $bitId) {
                $deleteBit->execute(['id' => $bitId]);
            }
        }

        $stmt = $this->pdo->prepare('DELETE FROM workspaces WHERE id = :id');
        $stmt->execute(['id' => $workspaceId]);
    }

    public function belongsToUser(int $userId, int $workspaceId): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT id FROM workspaces WHERE id = :workspace_id AND owner_user_id = :user_id LIMIT 1'
        );
        $stmt->execute([
            'workspace_id' => $workspaceId,
            'user_id' => $userId,
        ]);

        return (bool) $stmt->fetch();
    }

    /** @return array{bit_id: int, relative_path: string, revision: int, is_deleted: bool}|null */
    public function docFile(int $workspaceId, string $relativePath): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT bit_id, relative_path, revision, is_deleted
             FROM doc_files
             WHERE workspace_id = :workspace_id AND relative_path = :relative_path
             LIMIT 1'
        );
        $stmt->execute([
            'workspace_id' => $workspaceId,
            'relative_path' => $relativePath,
        ]);
        $row = $stmt->fetch();

        if (!$row) {
            return null;
        }

        return [
            'bit_id' => (int) $row['bit_id'],
            'relative_path' => (string) $row['relative_path'],
            'revision' => (int) $row['revision'],
            'is_deleted' => (bool) $row['is_deleted'],
        ];
    }

    public function workspaceType(int $workspaceId): string
    {
        $stmt = $this->pdo->prepare('SELECT type FROM workspaces WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $workspaceId]);
        $row = $stmt->fetch();

        return $row && $row['type'] === 'multi'
            ? 'multi'
            : ($row && $row['type'] === 'external' ? 'external' : 'folder');
    }

    /**
     * The hidden per-user workspace that backs "linked in place" docs (files
     * that live at an absolute path on disk, gathered into multi-spaces).
     * Created lazily on first use; never listed in the UI.
     */
    public function ensureExternalWorkspace(int $userId): int
    {
        $find = $this->pdo->prepare(
            "SELECT id FROM workspaces
             WHERE owner_user_id = :user_id AND type = 'external'
             ORDER BY id ASC LIMIT 1"
        );
        $find->execute(['user_id' => $userId]);
        $row = $find->fetch();

        if ($row) {
            return (int) $row['id'];
        }

        return $this->create($userId, 'Linked files', '', 'external', '#5B5BD6', 'Cloud');
    }

    /**
     * Link an existing doc (from any of the user's workspaces) into a
     * multi-space. Multi-spaces are the only linkable workspaces, and a doc
     * can never link into the workspace that owns it.
     */
    public function linkDoc(int $userId, int $workspaceId, int $bitId): void
    {
        if (!$this->belongsToUser($userId, $workspaceId) || $this->workspaceType($workspaceId) !== 'multi') {
            throw new DomainException('Workspace not found');
        }

        $doc = $this->findDoc($bitId);
        if ($doc === null || (int) $doc['owner_user_id'] !== $userId) {
            throw new DomainException('Doc not found');
        }
        if ((int) $doc['workspace_id'] === $workspaceId || !empty($doc['is_deleted'])) {
            throw new DomainException('Doc not found');
        }

        $stmt = $this->pdo->prepare(
            'INSERT IGNORE INTO workspace_doc_links (workspace_id, bit_id)
             VALUES (:workspace_id, :bit_id)'
        );
        $stmt->execute(['workspace_id' => $workspaceId, 'bit_id' => $bitId]);
    }

    /**
     * Unlink a doc from a multi-space. Only the link is removed — the doc
     * itself (and any memberships in the multi-space's folders) stays in its
     * real workspace untouched.
     */
    public function unlinkDoc(int $userId, int $workspaceId, int $bitId): void
    {
        if (!$this->belongsToUser($userId, $workspaceId) || $this->workspaceType($workspaceId) !== 'multi') {
            throw new DomainException('Workspace not found');
        }

        $stmt = $this->pdo->prepare(
            'DELETE FROM workspace_doc_links WHERE workspace_id = :workspace_id AND bit_id = :bit_id'
        );
        $stmt->execute(['workspace_id' => $workspaceId, 'bit_id' => $bitId]);

        // Drop the doc from every folder of this multi-space too, so it does
        // not linger in a folder after being removed from the space.
        $folderStmt = $this->pdo->prepare(
            'SELECT bit_id FROM bit_folders WHERE workspace_id = :workspace_id'
        );
        $folderStmt->execute(['workspace_id' => $workspaceId]);
        $folderIds = array_values(array_map(static fn (array $row): int => (int) $row['bit_id'], $folderStmt->fetchAll()));
        if (!empty($folderIds)) {
            $placeholders = implode(',', array_fill(0, count($folderIds), '?'));
            $relStmt = $this->pdo->prepare(
                "DELETE FROM bit_relations
                 WHERE relation_type = 'member' AND child_bit_id = :child
                   AND parent_bit_id IN ($placeholders)"
            );
            $relStmt->execute([$bitId, ...$folderIds]);
        }
    }

    /** @return array{owner_user_id: int, workspace_id: int, is_deleted: bool}|null */
    private function findDoc(int $bitId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT ws.owner_user_id, df.workspace_id, df.is_deleted
             FROM doc_files df
             INNER JOIN workspaces ws ON ws.id = df.workspace_id
             WHERE df.bit_id = :bit_id
             LIMIT 1'
        );
        $stmt->execute(['bit_id' => $bitId]);
        $row = $stmt->fetch();

        if (!$row) {
            return null;
        }

        return [
            'owner_user_id' => (int) $row['owner_user_id'],
            'workspace_id' => (int) $row['workspace_id'],
            'is_deleted' => (bool) $row['is_deleted'],
        ];
    }

    private function normalizeColor(?string $colorHex): string
    {
        $colorHex = trim((string) $colorHex);

        return preg_match('/^#[0-9a-fA-F]{6}$/', $colorHex) === 1
            ? strtoupper($colorHex)
            : '#5B5BD6';
    }

    private function normalizeIcon(?string $iconKey): ?string
    {
        if ($iconKey === null) {
            return null;
        }
        $iconKey = trim($iconKey);

        return $iconKey !== '' ? $iconKey : null;
    }
}
