<?php

declare(strict_types=1);

namespace App\Services;

use DomainException;
use PDO;

/**
 * Docs are stored as "bits" (bit_type = 'doc') with the markdown body in
 * bit_notes.body — the same bits structure used across the Board/Stickly apps.
 * doc_files maps each doc to a workspace-relative file path and tracks the
 * content hash + revision used by the folder-sync engine.
 */
final class DocService
{
    public function __construct(private PDO $pdo, private WorkspaceService $workspaces)
    {
    }

    public function tree(int $userId, int $workspaceId): array
    {
        if (!$this->workspaces->belongsToUser($userId, $workspaceId)) {
            return [];
        }

        // Multi-spaces don't own doc_files rows: their docs are links to bits
        // that live in the user's other (folder) workspaces. Include both the
        // top-level links and any docs filed inside the multi-space's folders,
        // each tagged with its real home workspace so the UI can group them.
        if ($this->workspaces->workspaceType($workspaceId) === 'multi') {
            return $this->multiTree($workspaceId);
        }

        $stmt = $this->pdo->prepare(
            'SELECT
                df.bit_id AS id,
                df.relative_path,
                df.local_path,
                df.content_hash,
                df.revision,
                df.is_deleted,
                b.title,
                b.content_preview,
                b.created_at,
                b.updated_at
             FROM doc_files df
             INNER JOIN bits b ON b.id = df.bit_id
             WHERE df.workspace_id = :workspace_id
             ORDER BY df.relative_path ASC'
        );
        $stmt->execute(['workspace_id' => $workspaceId]);

        return $stmt->fetchAll();
    }

    private function multiTree(int $workspaceId): array
    {
        $select = 'SELECT
                df.bit_id AS id,
                df.relative_path,
                df.local_path,
                df.content_hash,
                df.revision,
                df.is_deleted,
                b.title,
                b.content_preview,
                b.created_at,
                b.updated_at,
                ws.id AS source_workspace_id,
                ws.name AS source_workspace_name';

        $stmt = $this->pdo->prepare(
            $select . '
             FROM workspace_doc_links wdl
             INNER JOIN bits b ON b.id = wdl.bit_id
             INNER JOIN doc_files df ON df.bit_id = b.id
             INNER JOIN workspaces ws ON ws.id = df.workspace_id
             WHERE wdl.workspace_id = :workspace_id
               AND df.is_deleted = 0
             UNION
             ' . $select . '
             FROM bit_relations r
             INNER JOIN bits b ON b.id = r.child_bit_id
             INNER JOIN doc_files df ON df.bit_id = b.id
             INNER JOIN workspaces ws ON ws.id = df.workspace_id
             WHERE r.relation_type = :relation_type
               AND r.parent_bit_id IN (
                   SELECT bit_id FROM bit_folders WHERE workspace_id = :workspace_id
               )
               AND df.is_deleted = 0'
        );
        $stmt->execute([
            'workspace_id' => $workspaceId,
            'relation_type' => 'member',
        ]);

        return $stmt->fetchAll();
    }

    public function detail(int $bitId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT
                b.id,
                b.bit_type,
                b.title,
                b.content_preview,
                b.created_at,
                b.updated_at,
                n.body AS content,
                df.workspace_id,
                df.relative_path,
                df.local_path,
                df.revision,
                df.is_deleted
             FROM bits b
             LEFT JOIN bit_notes n ON n.bit_id = b.id
             LEFT JOIN doc_files df ON df.bit_id = b.id
             WHERE b.id = :bit_id
             LIMIT 1'
        );
        $stmt->execute(['bit_id' => $bitId]);
        $row = $stmt->fetch();

        return $row ?: null;
    }

    public function create(int $userId, int $workspaceId, string $relativePath, string $content, ?string $localPath = null): int
    {
        if (!$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Workspace not found');
        }

        // Multi-spaces don't own files: a page must be created in a (folder)
        // workspace first, then linked in. Rejecting direct creates here keeps
        // old/stale clients from silently planting invisible docs inside a
        // multi-space (they never show up in its tree and block re-creating
        // the same name).
        if ($this->workspaces->workspaceType($workspaceId) === 'multi') {
            throw new DomainException('Pages can only be created in a folder workspace, then added to a multi-space.');
        }

        $path = $this->normalizePath($relativePath);
        if ($path === '') {
            throw new DomainException('A relative path is required');
        }

        $existing = $this->workspaces->docFile($workspaceId, $path);

        // Resurrect a soft-deleted doc at the same path instead of failing.
        if ($existing !== null && !$existing['is_deleted']) {
            throw new DomainException('A doc already exists at this path');
        }
        if ($existing !== null) {
            $this->writeDoc($existing['bit_id'], $this->titleFromPath($path), $content);
            $this->upsertFile($workspaceId, $existing['bit_id'], $path, hash('sha256', $content), null, $localPath);

            return $existing['bit_id'];
        }

        $bitId = $this->insertBit($userId, $this->titleFromPath($path), $content);
        $this->insertNote($bitId, $content);
        $this->upsertFile($workspaceId, $bitId, $path, hash('sha256', $content), null, $localPath);

        return $bitId;
    }

    public function update(int $userId, int $bitId, ?string $title = null, ?string $content = null, ?string $relativePath = null): array
    {
        $detail = $this->detail($bitId);

        if ($detail === null) {
            throw new DomainException('Doc not found');
        }

        $workspaceId = (int) ($detail['workspace_id'] ?? 0);
        if ($workspaceId === 0 || !$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Doc not found');
        }

        // Linked-in-place docs (local_path set) keep their file path frozen:
        // the file lives at an absolute path on disk, so a rename must never
        // move it — only the display title may change.
        $frozenPath = !empty($detail['local_path']);
        $newPath = $frozenPath
            ? (string) ($detail['relative_path'] ?? '')
            : ($relativePath !== null ? $this->normalizePath($relativePath) : (string) ($detail['relative_path'] ?? ''));
        $newContent = $content !== null ? $content : (string) ($detail['content'] ?? '');
        $newTitle = $title !== null ? trim($title) : (string) ($detail['title'] ?? '');

        if ($newPath === '') {
            throw new DomainException('A relative path is required');
        }
        if ($newPath !== $detail['relative_path']) {
            $collision = $this->workspaces->docFile($workspaceId, $newPath);
            if ($collision !== null && $collision['bit_id'] !== $bitId && !$collision['is_deleted']) {
                throw new DomainException('A doc already exists at this path');
            }
        }

        $this->writeDoc($bitId, $newTitle !== '' ? $newTitle : $this->titleFromPath($newPath), $newContent);

        $revision = $this->upsertFile($workspaceId, $bitId, $newPath, hash('sha256', $newContent));

        return ['ok' => true, 'revision' => $revision];
    }

    /**
     * External (linked-in-place) docs for the desktop sync engine: every
     * doc_files row with a local_path, across all of the user's workspaces.
     */
    public function linkedFiles(int $userId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT
                df.bit_id,
                df.relative_path,
                df.local_path,
                df.content_hash,
                df.revision,
                df.is_deleted,
                df.updated_at,
                b.title
             FROM doc_files df
             INNER JOIN bits b ON b.id = df.bit_id
             INNER JOIN workspaces ws ON ws.id = df.workspace_id
             WHERE ws.owner_user_id = :user_id
               AND df.local_path IS NOT NULL
             ORDER BY df.local_path ASC'
        );
        $stmt->execute(['user_id' => $userId]);

        return $stmt->fetchAll();
    }

    public function softDelete(int $userId, int $bitId): array
    {
        $detail = $this->detail($bitId);
        $workspaceId = (int) ($detail['workspace_id'] ?? 0);

        if ($detail === null || $workspaceId === 0 || !$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Doc not found');
        }

        if (!empty($detail['is_deleted'])) {
            return ['ok' => false];
        }

        $stmt = $this->pdo->prepare(
            'UPDATE doc_files
             SET is_deleted = 1, revision = LAST_INSERT_ID(revision + 1)
             WHERE bit_id = :bit_id'
        );
        $stmt->execute(['bit_id' => $bitId]);
        $revision = (int) $this->pdo->query('SELECT LAST_INSERT_ID() AS revision')->fetch()['revision'];

        $this->clearFolderMemberships($bitId);

        return ['ok' => true, 'revision' => $revision];
    }

    /**
     * Upsert a doc from the sync engine (create bit if missing, else update).
     * Revision is always bumped; the returned revision is the new one.
     *
     * $mtime (optional, ISO 8601) is the local file's modification time sent
     * by the desktop engine: it becomes the doc's updated_at so files that
     * were never modified in the app keep their real filesystem date. When
     * absent (e.g. web edits), the server time is used.
     */
    public function syncUpsert(int $userId, int $workspaceId, string $relativePath, string $content, ?string $mtime = null): array
    {
        if (!$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Workspace not found');
        }

        $path = $this->normalizePath($relativePath);
        if ($path === '') {
            throw new DomainException('A relative path is required');
        }

        $mtimeSql = $this->mtimeToMysql($mtime);
        $existing = $this->workspaces->docFile($workspaceId, $path);

        if ($existing === null) {
            $bitId = $this->insertBit($userId, $this->titleFromPath($path), $content, $mtimeSql);
            $this->insertNote($bitId, $content);
            $this->upsertFile($workspaceId, $bitId, $path, hash('sha256', $content), $mtimeSql);

            return ['bit_id' => $bitId, 'revision' => 1];
        }

        $bitId = $existing['bit_id'];
        $this->writeDoc($bitId, $this->titleFromPath($path), $content, $mtimeSql);
        $revision = $this->upsertFile($workspaceId, $bitId, $path, hash('sha256', $content), $mtimeSql);

        return ['bit_id' => $bitId, 'revision' => $revision];
    }

    public function syncRemove(int $userId, int $workspaceId, string $relativePath): array
    {
        if (!$this->workspaces->belongsToUser($userId, $workspaceId)) {
            throw new DomainException('Workspace not found');
        }

        $existing = $this->workspaces->docFile($workspaceId, $this->normalizePath($relativePath));

        if ($existing === null || $existing['is_deleted']) {
            return ['ok' => false];
        }

        $stmt = $this->pdo->prepare(
            'UPDATE doc_files
             SET is_deleted = 1, revision = LAST_INSERT_ID(revision + 1)
             WHERE bit_id = :bit_id'
        );
        $stmt->execute(['bit_id' => $existing['bit_id']]);
        $revision = (int) $this->pdo->query('SELECT LAST_INSERT_ID() AS revision')->fetch()['revision'];

        $this->clearFolderMemberships($existing['bit_id']);

        return ['ok' => true, 'revision' => $revision];
    }

    // ------------------------------------------------------------------ //
    // Helpers
    // ------------------------------------------------------------------ //

    private function insertBit(int $userId, string $title, string $content, ?string $mtimeSql = null): int
    {
        $withMtime = $mtimeSql !== null;
        $stmt = $this->pdo->prepare(
            'INSERT INTO bits (owner_user_id, bit_type, title, content_preview'
            . ($withMtime ? ', updated_at' : '')
            . ') VALUES (:owner_user_id, :bit_type, :title, :content_preview'
            . ($withMtime ? ', :updated_at' : '') . ')'
        );
        $params = [
            'owner_user_id' => $userId,
            'bit_type' => 'doc',
            'title' => $title !== '' ? $title : 'Untitled',
            'content_preview' => $this->preview($content),
        ];
        if ($withMtime) {
            $params['updated_at'] = $mtimeSql;
        }
        $stmt->execute($params);

        return (int) $this->pdo->lastInsertId();
    }

    private function insertNote(int $bitId, string $content): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO bit_notes (bit_id, body) VALUES (:bit_id, :body)'
        );
        $stmt->execute(['bit_id' => $bitId, 'body' => $content]);
    }

    private function writeDoc(int $bitId, string $title, string $content, ?string $mtimeSql = null): void
    {
        // The mtime (from the sync engine) becomes updated_at so the doc's
        // date reflects the real file date; otherwise server time is used.
        $withMtime = $mtimeSql !== null;
        $stmt = $this->pdo->prepare(
            'UPDATE bits
             SET title = :title, content_preview = :content_preview, updated_at = '
            . ($withMtime ? ':updated_at' : 'UTC_TIMESTAMP()')
            . ' WHERE id = :id'
        );
        $params = [
            'title' => $title !== '' ? $title : 'Untitled',
            'content_preview' => $this->preview($content),
            'id' => $bitId,
        ];
        if ($withMtime) {
            $params['updated_at'] = $mtimeSql;
        }
        $stmt->execute($params);

        $noteStmt = $this->pdo->prepare(
            'UPDATE bit_notes SET body = :body WHERE bit_id = :bit_id'
        );
        $noteStmt->execute(['body' => $content, 'bit_id' => $bitId]);
    }

    /**
     * Create or update the doc_files row. Updates bump the revision atomically
     * on the SQL side (LAST_INSERT_ID) so concurrent pushes can't collide.
     * Returns the revision of the row after the write.
     */
    private function upsertFile(int $workspaceId, int $bitId, string $path, string $hash, ?string $mtimeSql = null, ?string $localPath = null): int
    {
        // updated_at tracks the latest write: the engine's mtime when given,
        // otherwise the server time — so the manifest's updated_at always
        // reflects the doc's real last-modified time (used for date sorting
        // and last-write-wins comparisons on the desktop side).
        //
        // local_path is ONLY written when explicitly provided (create of a
        // linked-in-place doc): sync pushes must never clear an existing
        // local_path, or the link would silently break.
        $withMtime = $mtimeSql !== null;
        $withLocal = $localPath !== null;
        $existsStmt = $this->pdo->prepare('SELECT id FROM doc_files WHERE bit_id = :bit_id');
        $existsStmt->execute(['bit_id' => $bitId]);

        if ($existsStmt->fetch()) {
            $stmt = $this->pdo->prepare(
                'UPDATE doc_files
                 SET workspace_id = :workspace_id,
                     relative_path = :relative_path,
                     content_hash = :content_hash,
                     revision = LAST_INSERT_ID(revision + 1),
                     is_deleted = 0,
                     updated_at = '
                . ($withMtime ? ':updated_at' : 'UTC_TIMESTAMP()')
                . ($withLocal ? ', local_path = :local_path' : '')
                . ' WHERE bit_id = :bit_id'
            );
            $params = [
                'workspace_id' => $workspaceId,
                'relative_path' => $path,
                'content_hash' => $hash,
                'bit_id' => $bitId,
            ];
            if ($withMtime) {
                $params['updated_at'] = $mtimeSql;
            }
            if ($withLocal) {
                $params['local_path'] = $localPath;
            }
            $stmt->execute($params);

            return (int) $this->pdo->query('SELECT LAST_INSERT_ID() AS revision')->fetch()['revision'];
        }

        $stmt = $this->pdo->prepare(
            'INSERT INTO doc_files (workspace_id, bit_id, relative_path, content_hash, revision'
            . ($withMtime ? ', updated_at' : '')
            . ($withLocal ? ', local_path' : '')
            . ') VALUES (:workspace_id, :bit_id, :relative_path, :content_hash, 1'
            . ($withMtime ? ', :updated_at' : '') . ($withLocal ? ', :local_path' : '') . ')'
        );
        $params = [
            'workspace_id' => $workspaceId,
            'relative_path' => $path,
            'content_hash' => $hash,
            'bit_id' => $bitId,
        ];
        if ($withMtime) {
            $params['updated_at'] = $mtimeSql;
        }
        if ($withLocal) {
            $params['local_path'] = $localPath;
        }
        $stmt->execute($params);

        return 1;
    }

    /**
     * Convert an ISO 8601 mtime (UTC, from the desktop engine) into a MySQL
     * UTC timestamp string. Returns null when absent or unparseable so the
     * caller falls back to the server time.
     */
    private function mtimeToMysql(?string $mtime): ?string
    {
        if ($mtime === null || trim($mtime) === '') {
            return null;
        }
        $timestamp = strtotime($mtime);
        if ($timestamp === false) {
            return null;
        }

        return gmdate('Y-m-d H:i:s', $timestamp);
    }

    public function normalizePath(string $path): string
    {
        $path = str_replace('\\', '/', trim($path));
        $parts = [];

        foreach (explode('/', $path) as $segment) {
            if ($segment === '' || $segment === '.') {
                continue;
            }
            if ($segment === '..') {
                array_pop($parts);
                continue;
            }
            $parts[] = $segment;
        }

        return implode('/', $parts);
    }

    private function clearFolderMemberships(int $bitId): void
    {
        $stmt = $this->pdo->prepare(
            "DELETE FROM bit_relations
             WHERE child_bit_id = :child AND relation_type = 'member'"
        );
        $stmt->execute(['child' => $bitId]);
    }

    private function titleFromPath(string $path): string
    {
        $base = basename($path);
        $base = preg_replace('/\.(md|markdown|txt)$/i', '', $base) ?? $base;

        return trim($base) !== '' ? trim($base) : 'Untitled';
    }

    private function preview(string $content): string
    {
        $content = preg_replace('/\s+/u', ' ', trim($content)) ?? '';
        $content = trim($content);

        return mb_substr($content, 0, 180);
    }
}
