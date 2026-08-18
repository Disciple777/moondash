<?php

declare(strict_types=1);

namespace App\Services;

use DomainException;
use PDO;

final class IdeaService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function createIdea(int $userId, int $boardId, string $title, string $content): int
    {
        $boardService = new BoardService($this->pdo);
        if (!$boardService->boardBelongsToUser($userId, $boardId)) {
            throw new DomainException('Board not found');
        }

        $bitStmt = $this->pdo->prepare(
            'INSERT INTO bits (owner_user_id, bit_type, title, content_preview)
             VALUES (:owner_user_id, :bit_type, :title, :content_preview)'
        );
        $bitStmt->execute([
            'owner_user_id' => $userId,
            'bit_type' => 'idea',
            'title' => trim($title) !== '' ? trim($title) : 'Untitled idea',
            'content_preview' => trim($content),
        ]);
        $bitId = (int) $this->pdo->lastInsertId();

        $ideaStmt = $this->pdo->prepare(
            'INSERT INTO board_ideas (board_id, bit_id) VALUES (:board_id, :bit_id)'
        );
        $ideaStmt->execute([
            'board_id' => $boardId,
            'bit_id' => $bitId,
        ]);

        return $bitId;
    }

    public function listIdeas(int $userId, int $boardId): array
    {
        $boardService = new BoardService($this->pdo);
        if (!$boardService->boardBelongsToUser($userId, $boardId)) {
            throw new DomainException('Board not found');
        }

        $stmt = $this->pdo->prepare(
            "SELECT
                b.id AS bit_id,
                b.title,
                b.content_preview,
                b.created_at,
                (
                    SELECT COUNT(*)
                    FROM board_bit_instances bi
                    WHERE bi.board_id = :placed_board_id AND bi.bit_id = b.id
                ) AS is_on_board
             FROM board_ideas idea
             INNER JOIN bits b ON b.id = idea.bit_id
             WHERE idea.board_id = :board_id
               AND b.owner_user_id = :user_id
             ORDER BY idea.created_at DESC, b.id DESC"
        );
        $stmt->execute([
            'board_id' => $boardId,
            'placed_board_id' => $boardId,
            'user_id' => $userId,
        ]);

        return $stmt->fetchAll();
    }

    public function deleteIdea(int $userId, int $ideaBitId): void
    {
        $ownerStmt = $this->pdo->prepare(
            'SELECT b.id
             FROM bits b
             INNER JOIN board_ideas idea ON idea.bit_id = b.id
             WHERE b.id = :idea_id AND b.owner_user_id = :user_id
             LIMIT 1'
        );
        $ownerStmt->execute([
            'idea_id' => $ideaBitId,
            'user_id' => $userId,
        ]);
        if (!$ownerStmt->fetch()) {
            return;
        }

        $instanceStmt = $this->pdo->prepare(
            'SELECT COUNT(*) AS total FROM board_bit_instances WHERE bit_id = :bit_id'
        );
        $instanceStmt->execute(['bit_id' => $ideaBitId]);
        $instanceCount = (int) ($instanceStmt->fetch()['total'] ?? 0);

        if ($instanceCount > 0) {
            // The idea became a card somewhere — keep the bit, just unlink the idea entry.
            $unlinkStmt = $this->pdo->prepare('DELETE FROM board_ideas WHERE bit_id = :bit_id');
            $unlinkStmt->execute(['bit_id' => $ideaBitId]);
            return;
        }

        $deleteStmt = $this->pdo->prepare(
            'DELETE FROM bits WHERE id = :id AND owner_user_id = :user_id'
        );
        $deleteStmt->execute([
            'id' => $ideaBitId,
            'user_id' => $userId,
        ]);
    }

    public function convertIdea(int $userId, int $boardId, int $ideaBitId, int $boardListId): void
    {
        $boardService = new BoardService($this->pdo);
        if (!$boardService->boardBelongsToUser($userId, $boardId)) {
            throw new DomainException('Board not found');
        }

        $ideaStmt = $this->pdo->prepare(
            'SELECT b.id
             FROM board_ideas idea
             INNER JOIN bits b ON b.id = idea.bit_id
             WHERE idea.board_id = :board_id
               AND idea.bit_id = :idea_id
               AND b.owner_user_id = :user_id
             LIMIT 1'
        );
        $ideaStmt->execute([
            'board_id' => $boardId,
            'idea_id' => $ideaBitId,
            'user_id' => $userId,
        ]);
        if (!$ideaStmt->fetch()) {
            throw new DomainException('Idea not found on this board');
        }

        $listStmt = $this->pdo->prepare(
            'SELECT bl.id
             FROM board_lists bl
             WHERE bl.id = :list_id AND bl.board_id = :board_id
             LIMIT 1'
        );
        $listStmt->execute([
            'list_id' => $boardListId,
            'board_id' => $boardId,
        ]);
        if (!$listStmt->fetch()) {
            throw new DomainException('List not found on this board');
        }

        // The idea's content already is the card's content — just re-type the bit.
        $cardStmt = $this->pdo->prepare(
            'INSERT IGNORE INTO bit_cards (bit_id, due_at, is_archived, is_hidden)
             VALUES (:bit_id, NULL, 0, 0)'
        );
        $cardStmt->execute(['bit_id' => $ideaBitId]);

        $updateStmt = $this->pdo->prepare(
            'UPDATE bits
             SET bit_type = :bit_type,
                 updated_at = UTC_TIMESTAMP()
             WHERE id = :bit_id'
        );
        $updateStmt->execute([
            'bit_type' => 'card',
            'bit_id' => $ideaBitId,
        ]);

        $placedStmt = $this->pdo->prepare(
            'SELECT COUNT(*) AS total
             FROM board_bit_instances
             WHERE board_id = :board_id AND bit_id = :bit_id'
        );
        $placedStmt->execute([
            'board_id' => $boardId,
            'bit_id' => $ideaBitId,
        ]);
        if ((int) ($placedStmt->fetch()['total'] ?? 0) > 0) {
            return;
        }

        $boardService->placeBit($boardId, $boardListId, $ideaBitId);
    }
}
