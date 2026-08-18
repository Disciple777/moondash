<?php

declare(strict_types=1);

namespace App\Services;

use PDO;

final class BoardService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function bootstrap(int $userId, ?int $selectedBoardId = null): array
    {
        $userStmt = $this->pdo->prepare('SELECT id, email, home_board_id FROM users WHERE id = :id');
        $userStmt->execute(['id' => $userId]);
        $user = $userStmt->fetch();

        $boardsStmt = $this->pdo->prepare(
            'SELECT id, name, color_theme, board_type, created_at
             FROM boards
             WHERE owner_user_id = :user_id
             ORDER BY updated_at DESC, id DESC'
        );
        $boardsStmt->execute(['user_id' => $userId]);
        $boards = $boardsStmt->fetchAll();

        $activeBoardId = $selectedBoardId ?? (int) ($user['home_board_id'] ?? 0);
        if ($activeBoardId === 0 && !empty($boards)) {
            $activeBoardId = (int) $boards[0]['id'];
        }

        $boardIds = array_map(static fn (array $board): int => (int) $board['id'], $boards);
        if ($activeBoardId !== 0 && !in_array($activeBoardId, $boardIds, true)) {
            $activeBoardId = !empty($boards) ? (int) $boards[0]['id'] : 0;
        }

        return [
            'user' => $user,
            'boards' => $boards,
            'activeBoardId' => $activeBoardId ?: null,
            'homeBoard' => $activeBoardId ? $this->boardPayload($activeBoardId, $userId) : null,
        ];
    }

    public function boardPayload(int $boardId, int $userId): array
    {
        $boardStmt = $this->pdo->prepare(
            'SELECT id, name, description, color_theme, board_type
             FROM boards
             WHERE id = :board_id AND owner_user_id = :user_id
             LIMIT 1'
        );
        $boardStmt->execute(['board_id' => $boardId, 'user_id' => $userId]);
        $board = $boardStmt->fetch();

        $listsStmt = $this->pdo->prepare(
            'SELECT id, board_id, name, position, is_hidden
             FROM board_lists
             WHERE board_id = :board_id
             ORDER BY position ASC, id ASC'
        );
        $listsStmt->execute(['board_id' => $boardId]);
        $lists = $listsStmt->fetchAll();

        $itemsStmt = $this->pdo->prepare(
            "SELECT
                bi.id AS instance_id,
                bi.board_list_id,
                bi.position,
                b.id AS bit_id,
                b.bit_type,
                b.title,
                b.content_preview,
                bc.due_at,
                bc.is_archived,
                bc.is_hidden,
                bc.published_on_tiktok,
                bc.published_on_youtube,
                bc.published_on_instagram,
                bc.has_scenes,
                (
                    SELECT COUNT(*)
                    FROM bit_relations relation
                    WHERE relation.parent_bit_id = b.id
                      AND relation.relation_type = 'checklist'
                ) AS checklist_count,
                (
                    SELECT COUNT(*)
                    FROM bit_relations relation
                    WHERE relation.parent_bit_id = b.id
                      AND relation.relation_type = 'attachment'
                ) AS attachment_count,
                (
                    SELECT COUNT(*)
                    FROM bit_relations relation
                    WHERE relation.parent_bit_id = b.id
                      AND relation.relation_type = 'linked_file'
                ) AS linked_file_count
             FROM board_bit_instances bi
             INNER JOIN bits b ON b.id = bi.bit_id
             LEFT JOIN bit_cards bc ON bc.bit_id = b.id
             WHERE bi.board_id = :board_id
             ORDER BY bi.position ASC, bi.id ASC"
        );
        $itemsStmt->execute(['board_id' => $boardId]);
        $items = $itemsStmt->fetchAll();

        return [
            'board' => $board,
            'lists' => $lists,
            'items' => $items,
        ];
    }

    public function createBoard(int $userId, string $name, string $description, string $theme, string $boardType = 'general'): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO boards (owner_user_id, name, description, color_theme, board_type)
             VALUES (:owner_user_id, :name, :description, :color_theme, :board_type)'
        );
        $stmt->execute([
            'owner_user_id' => $userId,
            'name' => $name,
            'description' => $description,
            'color_theme' => $theme,
            'board_type' => $boardType,
        ]);

        $boardId = (int) $this->pdo->lastInsertId();

        $homeBoardStmt = $this->pdo->prepare(
            'UPDATE users
             SET home_board_id = COALESCE(home_board_id, :board_id)
             WHERE id = :user_id'
        );
        $homeBoardStmt->execute([
            'board_id' => $boardId,
            'user_id' => $userId,
        ]);

        return $boardId;
    }

    public function updateBoardType(int $boardId, int $userId, string $boardType): void
    {
        if (!$this->boardBelongsToUser($userId, $boardId)) {
            return;
        }

        $stmt = $this->pdo->prepare(
            'UPDATE boards SET board_type = :board_type WHERE id = :id'
        );
        $stmt->execute([
            'board_type' => $boardType,
            'id' => $boardId,
        ]);
    }

    public function createList(int $boardId, string $name, bool $isHidden = false): int
    {
        $position = (int) $this->pdo->query(
            'SELECT COALESCE(MAX(position), 0) + 1 AS next_position FROM board_lists WHERE board_id = ' . (int) $boardId
        )->fetch()['next_position'];

        $stmt = $this->pdo->prepare(
            'INSERT INTO board_lists (board_id, name, position, is_hidden) VALUES (:board_id, :name, :position, :is_hidden)'
        );
        $stmt->execute([
            'board_id' => $boardId,
            'name' => $name,
            'position' => $position,
            'is_hidden' => $isHidden ? 1 : 0,
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    public function updateList(int $userId, int $listId, ?string $name = null, ?bool $isHidden = null): void
    {
        if (!$this->listBelongsToUser($userId, $listId)) {
            return;
        }

        $fields = [];
        $params = ['id' => $listId];

        if ($name !== null) {
            $fields[] = 'name = :name';
            $params['name'] = trim($name) !== '' ? trim($name) : 'Untitled list';
        }

        if ($isHidden !== null) {
            $fields[] = 'is_hidden = :is_hidden';
            $params['is_hidden'] = $isHidden ? 1 : 0;
        }

        if (empty($fields)) {
            return;
        }

        $stmt = $this->pdo->prepare(
            'UPDATE board_lists SET ' . implode(', ', $fields) . ', updated_at = UTC_TIMESTAMP() WHERE id = :id'
        );
        $stmt->execute($params);
    }

    public function deleteList(int $userId, int $listId): void
    {
        if (!$this->listBelongsToUser($userId, $listId)) {
            return;
        }

        $boardIdStmt = $this->pdo->prepare('SELECT board_id FROM board_lists WHERE id = :id LIMIT 1');
        $boardIdStmt->execute(['id' => $listId]);
        $boardId = (int) (($boardIdStmt->fetch()['board_id'] ?? 0));

        $stmt = $this->pdo->prepare('DELETE FROM board_lists WHERE id = :id');
        $stmt->execute(['id' => $listId]);

        if ($boardId !== 0) {
            $this->normalizeListPositions($boardId);
        }
    }

    public function setHomeBoard(int $userId, int $boardId): void
    {
        $ownershipStmt = $this->pdo->prepare(
            'SELECT id FROM boards WHERE id = :board_id AND owner_user_id = :user_id LIMIT 1'
        );
        $ownershipStmt->execute([
            'board_id' => $boardId,
            'user_id' => $userId,
        ]);

        if (!$ownershipStmt->fetch()) {
            return;
        }

        $stmt = $this->pdo->prepare(
            'UPDATE users SET home_board_id = :board_id WHERE id = :user_id'
        );
        $stmt->execute([
            'board_id' => $boardId,
            'user_id' => $userId,
        ]);
    }

    public function reorderLists(int $userId, int $boardId, array $lists): void
    {
        if (!$this->boardBelongsToUser($userId, $boardId)) {
            return;
        }

        $stmt = $this->pdo->prepare('UPDATE board_lists SET position = :position WHERE id = :id');

        foreach ($lists as $index => $listId) {
            $stmt->execute([
                'position' => $index + 1,
                'id' => (int) $listId,
            ]);
        }

        $this->normalizeListPositions($boardId);
    }

    public function placeBit(int $boardId, int $listId, int $bitId): int
    {
        $position = (int) $this->pdo->query(
            'SELECT COALESCE(MAX(position), 0) + 1 AS next_position
             FROM board_bit_instances
             WHERE board_list_id = ' . (int) $listId
        )->fetch()['next_position'];

        $stmt = $this->pdo->prepare(
            'INSERT INTO board_bit_instances (board_id, board_list_id, bit_id, position)
             VALUES (:board_id, :board_list_id, :bit_id, :position)'
        );
        $stmt->execute([
            'board_id' => $boardId,
            'board_list_id' => $listId,
            'bit_id' => $bitId,
            'position' => $position,
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    public function moveBitInstance(int $userId, int $instanceId, int $targetListId, int $targetPosition): void
    {
        $instanceStmt = $this->pdo->prepare(
            'SELECT bi.id, bi.board_id, bi.board_list_id
             FROM board_bit_instances bi
             INNER JOIN boards b ON b.id = bi.board_id
             WHERE bi.id = :id AND b.owner_user_id = :user_id
             LIMIT 1'
        );
        $instanceStmt->execute([
            'id' => $instanceId,
            'user_id' => $userId,
        ]);
        $instance = $instanceStmt->fetch();

        if (!$instance || !$this->listBelongsToUser($userId, $targetListId)) {
            return;
        }

        $sourceListId = (int) $instance['board_list_id'];

        $itemsStmt = $this->pdo->prepare(
            'SELECT id
             FROM board_bit_instances
             WHERE board_list_id = :board_list_id
             ORDER BY position ASC, id ASC'
        );

        $itemsStmt->execute(['board_list_id' => $targetListId]);
        $targetIds = array_map(static fn (array $row): int => (int) $row['id'], $itemsStmt->fetchAll());

        if ($sourceListId === $targetListId) {
            $targetIds = array_values(array_filter($targetIds, static fn (int $id): bool => $id !== $instanceId));
            $insertAt = max(0, min($targetPosition - 1, count($targetIds)));
            array_splice($targetIds, $insertAt, 0, [$instanceId]);
            $this->rewriteInstancePositions($targetListId, $targetIds);
            return;
        }

        $itemsStmt->execute(['board_list_id' => $sourceListId]);
        $sourceIds = array_values(array_filter(
            array_map(static fn (array $row): int => (int) $row['id'], $itemsStmt->fetchAll()),
            static fn (int $id): bool => $id !== $instanceId
        ));
        $this->rewriteInstancePositions($sourceListId, $sourceIds);

        $insertAt = max(0, min($targetPosition - 1, count($targetIds)));
        array_splice($targetIds, $insertAt, 0, [$instanceId]);

        $moveStmt = $this->pdo->prepare(
            'UPDATE board_bit_instances SET board_list_id = :board_list_id WHERE id = :id'
        );
        $moveStmt->execute([
            'board_list_id' => $targetListId,
            'id' => $instanceId,
        ]);

        $this->rewriteInstancePositions($targetListId, $targetIds);
    }

    public function boardBelongsToUser(int $userId, int $boardId): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT id FROM boards WHERE id = :board_id AND owner_user_id = :user_id LIMIT 1'
        );
        $stmt->execute([
            'board_id' => $boardId,
            'user_id' => $userId,
        ]);

        return (bool) $stmt->fetch();
    }

    public function listBelongsToUser(int $userId, int $listId): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT bl.id
             FROM board_lists bl
             INNER JOIN boards b ON b.id = bl.board_id
             WHERE bl.id = :list_id AND b.owner_user_id = :user_id
             LIMIT 1'
        );
        $stmt->execute([
            'list_id' => $listId,
            'user_id' => $userId,
        ]);

        return (bool) $stmt->fetch();
    }

    private function normalizeListPositions(int $boardId): void
    {
        $stmt = $this->pdo->prepare(
            'SELECT id FROM board_lists WHERE board_id = :board_id ORDER BY position ASC, id ASC'
        );
        $stmt->execute(['board_id' => $boardId]);
        $listIds = array_map(static fn (array $row): int => (int) $row['id'], $stmt->fetchAll());

        $updateStmt = $this->pdo->prepare('UPDATE board_lists SET position = :position WHERE id = :id');
        foreach ($listIds as $index => $listId) {
            $updateStmt->execute([
                'position' => $index + 1,
                'id' => $listId,
            ]);
        }
    }

    private function rewriteInstancePositions(int $listId, array $instanceIds): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE board_bit_instances SET position = :position WHERE id = :id AND board_list_id = :board_list_id'
        );

        foreach ($instanceIds as $index => $instanceId) {
            $stmt->execute([
                'position' => $index + 1,
                'id' => $instanceId,
                'board_list_id' => $listId,
            ]);
        }
    }
}
