<?php

declare(strict_types=1);

namespace App\Services;

use DomainException;
use PDO;

/**
 * Endpoints used by the desktop folder-sync engine.
 * The sync model is manifest + revision:
 *   - manifest  -> every path with its content hash, revision and deleted flag
 *   - push      -> batch upsert of changed local files (revision bumps server-side)
 *   - remove    -> soft-delete a path (bumps revision so other clients pull the deletion)
 *   - file      -> download a single doc's markdown content
 * Divergences are resolved client-side by modification time (last-write-wins,
 * no .conflicted copies) — the manifest's updated_at is the remote timestamp used.
 */
final class SyncService
{
    public function __construct(private PDO $pdo, private WorkspaceService $workspaces)
    {
    }

    public function manifest(int $userId, int $workspaceId): array
    {
        if (!$this->workspaces->belongsToUser($userId, $workspaceId)) {
            return ['entries' => []];
        }

        $stmt = $this->pdo->prepare(
            'SELECT relative_path, local_path, content_hash, revision, is_deleted, bit_id, updated_at
             FROM doc_files
             WHERE workspace_id = :workspace_id
             ORDER BY relative_path ASC'
        );
        $stmt->execute(['workspace_id' => $workspaceId]);

        return ['entries' => $stmt->fetchAll()];
    }

    /**
     * Linked-in-place files for the desktop engine: every doc_files row with
     * a local_path (across all of the user's workspaces). Returns the hidden
     * external workspace id too, so the engine can push updates to the right
     * workspace without knowing it ahead of time.
     */
    public function external(int $userId): array
    {
        $workspaceId = $this->workspaces->ensureExternalWorkspace($userId);
        $service = new DocService($this->pdo, $this->workspaces);

        return [
            'workspace_id' => $workspaceId,
            'entries' => $service->linkedFiles($userId),
        ];
    }

    public function push(int $userId, int $workspaceId, array $files): array
    {
        if (!$this->workspaces->belongsToUser($userId, $workspaceId)) {
            return ['results' => []];
        }

        $service = new DocService($this->pdo, $this->workspaces);
        $results = [];

        foreach ($files as $file) {
            $path = $service->normalizePath((string) ($file['relative_path'] ?? ''));

            if ($path === '') {
                $results[] = ['relative_path' => (string) ($file['relative_path'] ?? ''), 'status' => 'invalid'];
                continue;
            }

            try {
                $result = $service->syncUpsert(
                    $userId,
                    $workspaceId,
                    $path,
                    (string) ($file['content'] ?? ''),
                    isset($file['mtime']) ? (string) $file['mtime'] : null
                );
                $results[] = [
                    'relative_path' => $path,
                    'status' => 'ok',
                    'bit_id' => $result['bit_id'],
                    'revision' => $result['revision'],
                ];
            } catch (DomainException $exception) {
                $results[] = ['relative_path' => $path, 'status' => 'error', 'message' => $exception->getMessage()];
            }
        }

        return ['results' => $results];
    }

    public function remove(int $userId, int $workspaceId, string $relativePath): array
    {
        if (!$this->workspaces->belongsToUser($userId, $workspaceId)) {
            return ['ok' => false];
        }

        $service = new DocService($this->pdo, $this->workspaces);

        return $service->syncRemove($userId, $workspaceId, $relativePath);
    }

    public function file(int $userId, int $workspaceId, string $relativePath): ?array
    {
        if (!$this->workspaces->belongsToUser($userId, $workspaceId)) {
            return null;
        }

        $service = new DocService($this->pdo, $this->workspaces);
        $path = $service->normalizePath($relativePath);
        $existing = $this->workspaces->docFile($workspaceId, $path);

        if ($existing === null || $existing['is_deleted']) {
            return null;
        }

        $stmt = $this->pdo->prepare(
            'SELECT b.title, n.body AS content, b.updated_at
             FROM bits b
             LEFT JOIN bit_notes n ON n.bit_id = b.id
             WHERE b.id = :bit_id
             LIMIT 1'
        );
        $stmt->execute(['bit_id' => $existing['bit_id']]);
        $row = $stmt->fetch();

        if (!$row) {
            return null;
        }

        $row['revision'] = $existing['revision'];

        return $row;
    }
}
