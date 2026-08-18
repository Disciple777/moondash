<?php

declare(strict_types=1);

namespace App\Services;

use DomainException;
use PDO;
use Throwable;

final class SticklyService
{
    private const BUILT_IN_SURFACES = [
        ['name' => 'Fridge', 'surface_kind' => 'built_in', 'texture_key' => 'fridge'],
        ['name' => 'Board', 'surface_kind' => 'built_in', 'texture_key' => 'board'],
        ['name' => 'Wall', 'surface_kind' => 'built_in', 'texture_key' => 'wall'],
        ['name' => 'Desk', 'surface_kind' => 'built_in', 'texture_key' => 'desk'],
    ];

    public function __construct(private PDO $pdo)
    {
    }

    public function bootstrap(int $userId): array
    {
        $this->ensureUserSetup($userId);

        $userStmt = $this->pdo->prepare(
            'SELECT
                u.id,
                u.email,
                pref.home_surface_id
             FROM users u
             LEFT JOIN stickly_user_preferences pref ON pref.user_id = u.id
             WHERE u.id = :id
             LIMIT 1'
        );
        $userStmt->execute(['id' => $userId]);
        $user = $userStmt->fetch();

        $surfacesStmt = $this->pdo->prepare(
            'SELECT
                id,
                owner_user_id,
                name,
                surface_kind,
                texture_key,
                background_color,
                position,
                created_at,
                updated_at
             FROM stickly_surfaces
             WHERE owner_user_id = :user_id
             ORDER BY position ASC, id ASC'
        );
        $surfacesStmt->execute(['user_id' => $userId]);
        $surfaces = $surfacesStmt->fetchAll();

        $notesStmt = $this->pdo->prepare(
            'SELECT
                instance.id AS instance_id,
                instance.bit_id,
                instance.surface_id,
                instance.status,
                instance.color_hex,
                instance.size_code,
                instance.x,
                instance.y,
                instance.rotation,
                instance.expires_at,
                instance.won_at,
                instance.created_at AS instance_created_at,
                instance.updated_at AS instance_updated_at,
                bit.title,
                bit.content_preview,
                note.body
             FROM stickly_bit_instances instance
             INNER JOIN bits bit ON bit.id = instance.bit_id
             LEFT JOIN bit_notes note ON note.bit_id = bit.id
             WHERE instance.owner_user_id = :user_id
             ORDER BY instance.updated_at DESC, instance.id DESC'
        );
        $notesStmt->execute(['user_id' => $userId]);
        $notes = $notesStmt->fetchAll();

        $bitIds = array_values(array_unique(array_map(
            static fn (array $note): int => (int) $note['bit_id'],
            $notes
        )));
        $checklists = $this->checklistsForBits($bitIds);

        return [
            'user' => $user,
            'surfaces' => $surfaces,
            'notes' => array_map(
                fn (array $note): array => [
                    'instance_id' => (int) $note['instance_id'],
                    'bit_id' => (int) $note['bit_id'],
                    'surface_id' => (int) $note['surface_id'],
                    'status' => $note['status'],
                    'color_hex' => $note['color_hex'],
                    'size_code' => $note['size_code'],
                    'x' => (int) $note['x'],
                    'y' => (int) $note['y'],
                    'rotation' => (float) $note['rotation'],
                    'expires_at' => $note['expires_at'],
                    'won_at' => $note['won_at'],
                    'created_at' => $note['instance_created_at'],
                    'updated_at' => $note['instance_updated_at'],
                    'title' => $note['title'],
                    'content_preview' => $note['content_preview'],
                    'body' => $note['body'] ?? '',
                    'checklist_items' => $checklists[(int) $note['bit_id']] ?? [],
                ],
                $notes
            ),
        ];
    }

    public function createSurface(int $userId, array $payload): int
    {
        $positionStmt = $this->pdo->prepare(
            'SELECT COALESCE(MAX(position), 0) + 1 AS next_position
             FROM stickly_surfaces
             WHERE owner_user_id = :user_id'
        );
        $positionStmt->execute(['user_id' => $userId]);
        $position = (int) ($positionStmt->fetch()['next_position'] ?? 1);

        $stmt = $this->pdo->prepare(
            'INSERT INTO stickly_surfaces (
                owner_user_id,
                name,
                surface_kind,
                texture_key,
                background_color,
                position
             ) VALUES (
                :owner_user_id,
                :name,
                :surface_kind,
                :texture_key,
                :background_color,
                :position
             )'
        );
        $stmt->execute([
            'owner_user_id' => $userId,
            'name' => $this->surfaceName($payload['name'] ?? null),
            'surface_kind' => $this->surfaceKind($payload['surface_kind'] ?? null),
            'texture_key' => $payload['texture_key'] ?: null,
            'background_color' => $this->nullableColor($payload['background_color'] ?? null),
            'position' => $position,
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    public function updateSurface(int $userId, int $surfaceId, array $payload): void
    {
        if (!$this->surfaceBelongsToUser($userId, $surfaceId)) {
            return;
        }

        $fields = [];
        $params = ['surface_id' => $surfaceId, 'user_id' => $userId];

        if (array_key_exists('name', $payload) && $payload['name'] !== null) {
            $fields[] = 'name = :name';
            $params['name'] = $this->surfaceName($payload['name']);
        }

        if (array_key_exists('background_color', $payload)) {
            $fields[] = 'background_color = :background_color';
            $params['background_color'] = $this->nullableColor($payload['background_color']);
        }

        if (empty($fields)) {
            return;
        }

        $stmt = $this->pdo->prepare(
            'UPDATE stickly_surfaces
             SET ' . implode(', ', $fields) . ', updated_at = UTC_TIMESTAMP()
             WHERE id = :surface_id AND owner_user_id = :user_id'
        );
        $stmt->execute($params);
    }

    public function reorderSurfaces(int $userId, array $surfaceIds): void
    {
        if (empty($surfaceIds)) {
            return;
        }

        $normalizedIds = array_values(array_unique(array_map(static fn (mixed $id): int => (int) $id, $surfaceIds)));
        $ownedIds = $this->surfaceIdsForUser($userId);

        if (count($normalizedIds) !== count($ownedIds)) {
            return;
        }

        sort($normalizedIds);
        $sortedOwnedIds = $ownedIds;
        sort($sortedOwnedIds);

        if ($normalizedIds !== $sortedOwnedIds) {
            return;
        }

        $stmt = $this->pdo->prepare(
            'UPDATE stickly_surfaces SET position = :position, updated_at = UTC_TIMESTAMP() WHERE id = :id AND owner_user_id = :user_id'
        );

        foreach ($surfaceIds as $index => $surfaceId) {
            $stmt->execute([
                'position' => $index + 1,
                'id' => (int) $surfaceId,
                'user_id' => $userId,
            ]);
        }
    }

    public function setHomeSurface(int $userId, int $surfaceId): void
    {
        if (!$this->surfaceBelongsToUser($userId, $surfaceId)) {
            return;
        }

        $stmt = $this->pdo->prepare(
            'INSERT INTO stickly_user_preferences (user_id, home_surface_id)
             VALUES (:user_id, :home_surface_id)
             ON DUPLICATE KEY UPDATE
                home_surface_id = VALUES(home_surface_id),
                updated_at = UTC_TIMESTAMP()'
        );
        $stmt->execute([
            'user_id' => $userId,
            'home_surface_id' => $surfaceId,
        ]);
    }

    public function createNote(int $userId, array $payload): int
    {
        $this->pdo->beginTransaction();

        try {
            $surfaceId = (int) ($payload['surface_id'] ?? 0);

            if (!$this->surfaceBelongsToUser($userId, $surfaceId)) {
                throw new DomainException('Invalid surface');
            }

            $bitId = !empty($payload['bit_id'])
                ? (int) $payload['bit_id']
                : $this->createBaseBit($userId, $payload);

            if (!empty($payload['bit_id']) && !$this->bitBelongsToUser($userId, $bitId)) {
                throw new DomainException('Invalid bit');
            }

            if (empty($payload['bit_id'])) {
                $this->saveBitNote($bitId, (string) ($payload['body'] ?? ''));
                $this->replaceChecklistItems($bitId, (array) ($payload['checklist_items'] ?? []));
            }

            $stmt = $this->pdo->prepare(
                'INSERT INTO stickly_bit_instances (
                    bit_id,
                    owner_user_id,
                    surface_id,
                    status,
                    color_hex,
                    size_code,
                    x,
                    y,
                    rotation,
                    expires_at,
                    won_at
                 ) VALUES (
                    :bit_id,
                    :owner_user_id,
                    :surface_id,
                    :status,
                    :color_hex,
                    :size_code,
                    :x,
                    :y,
                    :rotation,
                    :expires_at,
                    :won_at
                 )'
            );
            $stmt->execute([
                'bit_id' => $bitId,
                'owner_user_id' => $userId,
                'surface_id' => $surfaceId,
                'status' => $this->instanceStatus($payload['status'] ?? null),
                'color_hex' => $this->requiredColor($payload['color_hex'] ?? null, '#F9D976'),
                'size_code' => $this->sizeCode($payload['size_code'] ?? null),
                'x' => (int) ($payload['x'] ?? 0),
                'y' => (int) ($payload['y'] ?? 0),
                'rotation' => (float) ($payload['rotation'] ?? 0),
                'expires_at' => $this->nullableDateTime($payload['expires_at'] ?? null),
                'won_at' => $this->nullableDateTime($payload['won_at'] ?? null),
            ]);

            $instanceId = (int) $this->pdo->lastInsertId();
            $this->pdo->commit();

            return $instanceId;
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $exception;
        }
    }

    public function updateNote(int $userId, int $instanceId, array $payload): void
    {
        $instance = $this->noteInstanceForUser($userId, $instanceId);

        if ($instance === null) {
            return;
        }

        $this->pdo->beginTransaction();

        try {
            $bitId = (int) $instance['bit_id'];
            if (
                array_key_exists('title', $payload) ||
                array_key_exists('body', $payload) ||
                array_key_exists('checklist_items', $payload)
            ) {
                $bitStmt = $this->pdo->prepare(
                    'SELECT title, content_preview FROM bits WHERE id = :bit_id AND owner_user_id = :user_id LIMIT 1'
                );
                $bitStmt->execute([
                    'bit_id' => $bitId,
                    'user_id' => $userId,
                ]);
                $currentBit = $bitStmt->fetch() ?: ['title' => 'Untitled note', 'content_preview' => ''];

                $resolvedBody = array_key_exists('body', $payload)
                    ? $payload['body']
                    : ($this->currentBitBody($bitId) ?? null);
                $resolvedChecklistItems = array_key_exists('checklist_items', $payload)
                    ? $payload['checklist_items']
                    : $this->currentChecklistItems($bitId);
                $resolvedTitle = array_key_exists('title', $payload)
                    ? $payload['title']
                    : $currentBit['title'];

                $updateBitStmt = $this->pdo->prepare(
                    'UPDATE bits
                     SET title = :title, content_preview = :content_preview, updated_at = UTC_TIMESTAMP()
                     WHERE id = :bit_id AND owner_user_id = :user_id'
                );
                $updateBitStmt->execute([
                    'title' => $this->noteTitle($resolvedTitle, $resolvedBody, $resolvedChecklistItems),
                    'content_preview' => $this->contentPreview($resolvedBody, $resolvedChecklistItems),
                    'bit_id' => $bitId,
                    'user_id' => $userId,
                ]);
            }

            if (array_key_exists('body', $payload)) {
                $this->saveBitNote($bitId, (string) ($payload['body'] ?? ''));
            }

            if (array_key_exists('checklist_items', $payload)) {
                $this->replaceChecklistItems($bitId, (array) $payload['checklist_items']);
            }

            $surfaceId = array_key_exists('surface_id', $payload)
                ? (int) $payload['surface_id']
                : (int) $instance['surface_id'];

            if (!$this->surfaceBelongsToUser($userId, $surfaceId)) {
                throw new DomainException('Invalid surface');
            }

            $instanceStmt = $this->pdo->prepare(
                'UPDATE stickly_bit_instances
                 SET surface_id = :surface_id,
                     status = :status,
                     color_hex = :color_hex,
                     size_code = :size_code,
                     x = :x,
                     y = :y,
                     rotation = :rotation,
                     expires_at = :expires_at,
                     won_at = :won_at,
                     updated_at = UTC_TIMESTAMP()
                 WHERE id = :instance_id AND owner_user_id = :user_id'
            );
            $instanceStmt->execute([
                'surface_id' => $surfaceId,
                'status' => $this->instanceStatus($payload['status'] ?? $instance['status']),
                'color_hex' => $this->requiredColor($payload['color_hex'] ?? $instance['color_hex'], '#F9D976'),
                'size_code' => $this->sizeCode($payload['size_code'] ?? $instance['size_code']),
                'x' => (int) ($payload['x'] ?? $instance['x']),
                'y' => (int) ($payload['y'] ?? $instance['y']),
                'rotation' => (float) ($payload['rotation'] ?? $instance['rotation']),
                'expires_at' => $this->nullableDateTime($payload['expires_at'] ?? $instance['expires_at']),
                'won_at' => $this->nullableDateTime($payload['won_at'] ?? $instance['won_at']),
                'instance_id' => $instanceId,
                'user_id' => $userId,
            ]);

            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $exception;
        }
    }

    public function deleteNote(int $userId, int $instanceId): void
    {
        $stmt = $this->pdo->prepare(
            'DELETE FROM stickly_bit_instances
             WHERE id = :instance_id AND owner_user_id = :user_id'
        );
        $stmt->execute([
            'instance_id' => $instanceId,
            'user_id' => $userId,
        ]);
    }

    private function ensureUserSetup(int $userId): void
    {
        $countStmt = $this->pdo->prepare(
            'SELECT COUNT(*) AS surface_count
             FROM stickly_surfaces
             WHERE owner_user_id = :user_id'
        );
        $countStmt->execute(['user_id' => $userId]);
        $count = (int) ($countStmt->fetch()['surface_count'] ?? 0);

        if ($count > 0) {
            return;
        }

        $this->pdo->beginTransaction();

        try {
            $insertStmt = $this->pdo->prepare(
                'INSERT INTO stickly_surfaces (
                    owner_user_id,
                    name,
                    surface_kind,
                    texture_key,
                    background_color,
                    position
                 ) VALUES (
                    :owner_user_id,
                    :name,
                    :surface_kind,
                    :texture_key,
                    NULL,
                    :position
                 )'
            );

            $homeSurfaceId = null;

            foreach (self::BUILT_IN_SURFACES as $index => $surface) {
                $insertStmt->execute([
                    'owner_user_id' => $userId,
                    'name' => $surface['name'],
                    'surface_kind' => $surface['surface_kind'],
                    'texture_key' => $surface['texture_key'],
                    'position' => $index + 1,
                ]);

                if ($index === 0) {
                    $homeSurfaceId = (int) $this->pdo->lastInsertId();
                }
            }

            $prefStmt = $this->pdo->prepare(
                'INSERT INTO stickly_user_preferences (user_id, home_surface_id)
                 VALUES (:user_id, :home_surface_id)
                 ON DUPLICATE KEY UPDATE
                    home_surface_id = COALESCE(stickly_user_preferences.home_surface_id, VALUES(home_surface_id)),
                    updated_at = UTC_TIMESTAMP()'
            );
            $prefStmt->execute([
                'user_id' => $userId,
                'home_surface_id' => $homeSurfaceId,
            ]);

            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }

            throw $exception;
        }
    }

    private function checklistsForBits(array $bitIds): array
    {
        if (empty($bitIds)) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($bitIds), '?'));
        $stmt = $this->pdo->prepare(
            'SELECT id, bit_id, content, is_done, position
             FROM bit_checklist_items
             WHERE bit_id IN (' . $placeholders . ')
             ORDER BY bit_id ASC, position ASC, id ASC'
        );
        $stmt->execute($bitIds);

        $grouped = [];

        foreach ($stmt->fetchAll() as $row) {
            $grouped[(int) $row['bit_id']][] = [
                'id' => (int) $row['id'],
                'content' => $row['content'],
                'is_done' => (bool) $row['is_done'],
                'position' => (int) $row['position'],
            ];
        }

        return $grouped;
    }

    private function createBaseBit(int $userId, array $payload): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO bits (owner_user_id, bit_type, title, content_preview)
             VALUES (:owner_user_id, :bit_type, :title, :content_preview)'
        );
        $stmt->execute([
            'owner_user_id' => $userId,
            'bit_type' => 'note',
            'title' => $this->noteTitle($payload['title'] ?? null, $payload['body'] ?? null, $payload['checklist_items'] ?? null),
            'content_preview' => $this->contentPreview($payload['body'] ?? null, $payload['checklist_items'] ?? null),
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    private function saveBitNote(int $bitId, string $body): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO bit_notes (bit_id, body)
             VALUES (:bit_id, :body)
             ON DUPLICATE KEY UPDATE body = VALUES(body)'
        );
        $stmt->execute([
            'bit_id' => $bitId,
            'body' => $body,
        ]);
    }

    private function replaceChecklistItems(int $bitId, array $items): void
    {
        $deleteStmt = $this->pdo->prepare('DELETE FROM bit_checklist_items WHERE bit_id = :bit_id');
        $deleteStmt->execute(['bit_id' => $bitId]);

        $insertStmt = $this->pdo->prepare(
            'INSERT INTO bit_checklist_items (bit_id, content, is_done, position)
             VALUES (:bit_id, :content, :is_done, :position)'
        );

        foreach ($items as $index => $item) {
            if (!is_array($item)) {
                continue;
            }

            $content = trim((string) ($item['content'] ?? $item['text'] ?? ''));

            if ($content === '') {
                continue;
            }

            $insertStmt->execute([
                'bit_id' => $bitId,
                'content' => $content,
                'is_done' => !empty($item['is_done']) || !empty($item['done']) ? 1 : 0,
                'position' => $index + 1,
            ]);
        }
    }

    private function noteInstanceForUser(int $userId, int $instanceId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, bit_id, surface_id, status, color_hex, size_code, x, y, rotation, expires_at, won_at
             FROM stickly_bit_instances
             WHERE id = :instance_id AND owner_user_id = :user_id
             LIMIT 1'
        );
        $stmt->execute([
            'instance_id' => $instanceId,
            'user_id' => $userId,
        ]);

        $row = $stmt->fetch();

        return $row ?: null;
    }

    private function bitBelongsToUser(int $userId, int $bitId): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT id
             FROM bits
             WHERE id = :bit_id AND owner_user_id = :user_id
             LIMIT 1'
        );
        $stmt->execute([
            'bit_id' => $bitId,
            'user_id' => $userId,
        ]);

        return (bool) $stmt->fetch();
    }

    private function currentBitBody(int $bitId): ?string
    {
        $stmt = $this->pdo->prepare(
            'SELECT body
             FROM bit_notes
             WHERE bit_id = :bit_id
             LIMIT 1'
        );
        $stmt->execute(['bit_id' => $bitId]);
        $row = $stmt->fetch();

        return $row ? (string) ($row['body'] ?? '') : null;
    }

    private function currentChecklistItems(int $bitId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT content, is_done
             FROM bit_checklist_items
             WHERE bit_id = :bit_id
             ORDER BY position ASC, id ASC'
        );
        $stmt->execute(['bit_id' => $bitId]);

        return array_map(
            static fn (array $row): array => [
                'content' => $row['content'],
                'is_done' => (bool) $row['is_done'],
            ],
            $stmt->fetchAll()
        );
    }

    private function surfaceBelongsToUser(int $userId, int $surfaceId): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT id
             FROM stickly_surfaces
             WHERE id = :surface_id AND owner_user_id = :user_id
             LIMIT 1'
        );
        $stmt->execute([
            'surface_id' => $surfaceId,
            'user_id' => $userId,
        ]);

        return (bool) $stmt->fetch();
    }

    private function surfaceIdsForUser(int $userId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id
             FROM stickly_surfaces
             WHERE owner_user_id = :user_id
             ORDER BY position ASC, id ASC'
        );
        $stmt->execute(['user_id' => $userId]);

        return array_map(static fn (array $row): int => (int) $row['id'], $stmt->fetchAll());
    }

    private function surfaceName(mixed $name): string
    {
        $value = trim((string) $name);

        return $value !== '' ? mb_substr($value, 0, 160) : 'Untitled surface';
    }

    private function surfaceKind(mixed $kind): string
    {
        $value = (string) $kind;

        return in_array($value, ['built_in', 'custom'], true) ? $value : 'custom';
    }

    private function sizeCode(mixed $size): string
    {
        $value = strtoupper(trim((string) $size));

        return match ($value) {
            'S', 'M', 'L' => $value,
            'TALL' => 'Tall',
            default => 'M',
        };
    }

    private function instanceStatus(mixed $status): string
    {
        $value = trim((string) $status);

        return in_array($value, ['active', 'drawer', 'win'], true) ? $value : 'active';
    }

    private function noteTitle(mixed $title, mixed $body, mixed $checklistItems): string
    {
        $provided = trim((string) $title);

        if ($provided !== '') {
            return mb_substr($provided, 0, 180);
        }

        $text = trim((string) ($body ?? ''));

        if ($text !== '') {
            $firstLine = trim((string) preg_split('/\R/u', $text)[0]);

            return mb_substr($firstLine !== '' ? $firstLine : $text, 0, 180);
        }

        if (is_array($checklistItems)) {
            foreach ($checklistItems as $item) {
                if (!is_array($item)) {
                    continue;
                }

                $content = trim((string) ($item['content'] ?? $item['text'] ?? ''));
                if ($content !== '') {
                    return mb_substr($content, 0, 180);
                }
            }
        }

        return 'Untitled note';
    }

    private function contentPreview(mixed $body, mixed $checklistItems): string
    {
        $text = trim((string) ($body ?? ''));

        if ($text !== '') {
            return mb_substr($text, 0, 500);
        }

        if (is_array($checklistItems)) {
            $lines = [];

            foreach ($checklistItems as $item) {
                if (!is_array($item)) {
                    continue;
                }

                $content = trim((string) ($item['content'] ?? $item['text'] ?? ''));
                if ($content !== '') {
                    $lines[] = $content;
                }
            }

            return mb_substr(implode("\n", $lines), 0, 500);
        }

        return '';
    }

    private function requiredColor(mixed $color, string $fallback): string
    {
        return $this->nullableColor($color) ?? $fallback;
    }

    private function nullableColor(mixed $color): ?string
    {
        $value = strtoupper(trim((string) $color));

        if ($value === '') {
            return null;
        }

        if (!preg_match('/^#[0-9A-F]{6}$/', $value)) {
            throw new DomainException('Invalid color value');
        }

        return $value;
    }

    private function nullableDateTime(mixed $value): ?string
    {
        $normalized = trim((string) $value);

        return $normalized !== '' ? $normalized : null;
    }
}
