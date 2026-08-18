<?php

declare(strict_types=1);

namespace App\Services;

use PDO;

final class BitService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function createBit(int $userId, array $payload): int
    {
        $bitType = $payload['bit_type'] ?? 'card';
        $title = trim((string) ($payload['title'] ?? 'Untitled'));
        $content = trim((string) ($payload['content_preview'] ?? ''));

        $bitId = $this->createBaseBit($userId, $bitType, $title, $content);

        if ($bitType === 'card') {
            $cardStmt = $this->pdo->prepare(
                'INSERT INTO bit_cards (bit_id, due_at, is_archived, is_hidden)
                 VALUES (:bit_id, :due_at, 0, :is_hidden)'
            );
            $cardStmt->execute([
                'bit_id' => $bitId,
                'due_at' => $payload['due_at'] ?? null,
                'is_hidden' => !empty($payload['is_hidden']) ? 1 : 0,
            ]);
        }

        if (!empty($payload['board_id']) && !empty($payload['board_list_id'])) {
            (new BoardService($this->pdo))->placeBit(
                (int) $payload['board_id'],
                (int) $payload['board_list_id'],
                $bitId
            );
        }

        return $bitId;
    }

    public function updateBit(int $bitId, array $payload): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE bits
             SET title = :title, content_preview = :content_preview, updated_at = UTC_TIMESTAMP()
             WHERE id = :id'
        );
        $stmt->execute([
            'title' => trim((string) ($payload['title'] ?? 'Untitled')),
            'content_preview' => trim((string) ($payload['content_preview'] ?? '')),
            'id' => $bitId,
        ]);

        $cardStmt = $this->pdo->prepare(
            'UPDATE bit_cards
             SET due_at = :due_at,
                 is_archived = :is_archived,
                 is_hidden = :is_hidden,
                 published_on_tiktok = :published_on_tiktok,
                 published_on_youtube = :published_on_youtube,
                 published_on_instagram = :published_on_instagram,
                 has_scenes = :has_scenes
             WHERE bit_id = :bit_id'
        );
        $cardStmt->execute([
            'due_at' => $payload['due_at'] ?? null,
            'is_archived' => !empty($payload['is_archived']) ? 1 : 0,
            'is_hidden' => !empty($payload['is_hidden']) ? 1 : 0,
            'published_on_tiktok' => !empty($payload['published_on_tiktok']) ? 1 : 0,
            'published_on_youtube' => !empty($payload['published_on_youtube']) ? 1 : 0,
            'published_on_instagram' => !empty($payload['published_on_instagram']) ? 1 : 0,
            'has_scenes' => !empty($payload['has_scenes']) ? 1 : 0,
            'bit_id' => $bitId,
        ]);
    }

    public function deleteBit(int $userId, int $bitId): void
    {
        $stmt = $this->pdo->prepare(
            'DELETE FROM bits
             WHERE id = :bit_id
               AND owner_user_id = :user_id'
        );
        $stmt->execute([
            'bit_id' => $bitId,
            'user_id' => $userId,
        ]);
    }

    public function detail(int $bitId): array
    {
        $bitStmt = $this->pdo->prepare(
            'SELECT
                b.id,
                b.bit_type,
                b.title,
                b.content_preview,
                b.created_at,
                b.updated_at,
                bc.due_at,
                bc.is_archived,
                bc.is_hidden,
                bc.published_on_tiktok,
                bc.published_on_youtube,
                bc.published_on_instagram,
                bc.has_scenes
             FROM bits b
             LEFT JOIN bit_cards bc ON bc.bit_id = b.id
             WHERE b.id = :bit_id
             LIMIT 1'
        );
        $bitStmt->execute(['bit_id' => $bitId]);
        $bit = $bitStmt->fetch() ?: null;

        return [
            'bit' => $bit,
            'comments' => $this->commentBits($bitId),
            'checklists' => $this->checklistBits($bitId),
            'attachments' => $this->attachmentBits($bitId),
            'linked_files' => $this->linkedFileBits($bitId),
            'scenes' => $this->sceneBits($bitId),
        ];
    }

    public function addComment(int $bitId, int $userId, string $body): int
    {
        $commentId = $this->createBaseBit($userId, 'comment', 'Comment', trim($body));

        $commentStmt = $this->pdo->prepare(
            'INSERT INTO bit_comment_bits (bit_id, author_user_id, body)
             VALUES (:bit_id, :author_user_id, :body)'
        );
        $commentStmt->execute([
            'bit_id' => $commentId,
            'author_user_id' => $userId,
            'body' => trim($body),
        ]);

        $this->attachChildBit($bitId, $commentId, 'comment');

        return $commentId;
    }

    public function createChecklistItem(int $userId, int $bitId, string $content): int
    {
        $position = $this->nextRelationPosition($bitId, 'checklist');
        $checklistId = $this->createBaseBit($userId, 'checklist', trim($content), '');

        $stmt = $this->pdo->prepare(
            'INSERT INTO bit_checklists (bit_id) VALUES (:bit_id)'
        );
        $stmt->execute(['bit_id' => $checklistId]);

        $this->attachChildBit($bitId, $checklistId, 'checklist', $position);

        return $checklistId;
    }

    public function createChecklistEntry(int $userId, int $checklistBitId, string $content): int
    {
        $position = $this->nextRelationPosition($checklistBitId, 'checklist_item');
        $itemId = $this->createBaseBit($userId, 'checklist_item', trim($content), '');

        $stmt = $this->pdo->prepare(
            'INSERT INTO bit_checklist_item_bits (bit_id, is_done) VALUES (:bit_id, 0)'
        );
        $stmt->execute(['bit_id' => $itemId]);

        $this->attachChildBit($checklistBitId, $itemId, 'checklist_item', $position);

        return $itemId;
    }

    public function updateChecklist(int $checklistBitId, string $title): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE bits
             SET title = :title, updated_at = UTC_TIMESTAMP()
             WHERE id = :bit_id
               AND bit_type = :bit_type'
        );
        $stmt->execute([
            'title' => trim($title) !== '' ? trim($title) : 'Checklist',
            'bit_id' => $checklistBitId,
            'bit_type' => 'checklist',
        ]);
    }

    public function updateChecklistItem(int $itemId, bool $isDone, mixed $content = null): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE bit_checklist_item_bits SET is_done = :is_done WHERE bit_id = :bit_id'
        );
        $stmt->execute([
            'is_done' => $isDone ? 1 : 0,
            'bit_id' => $itemId,
        ]);

        if ($content !== null) {
            $titleStmt = $this->pdo->prepare(
                'UPDATE bits
                 SET title = :title, updated_at = UTC_TIMESTAMP()
                 WHERE id = :bit_id
                   AND bit_type = :bit_type'
            );
            $titleStmt->execute([
                'title' => trim((string) $content) !== '' ? trim((string) $content) : 'Checklist item',
                'bit_id' => $itemId,
                'bit_type' => 'checklist_item',
            ]);
        }
    }

    public function deleteChildBit(int $userId, int $bitId, string $bitType): void
    {
        $stmt = $this->pdo->prepare(
            'DELETE FROM bits
             WHERE id = :bit_id
               AND owner_user_id = :user_id
               AND bit_type = :bit_type'
        );
        $stmt->execute([
            'bit_id' => $bitId,
            'user_id' => $userId,
            'bit_type' => $bitType,
        ]);
    }

    public function reorderRelations(int $parentBitId, string $relationType, array $childBitIds): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE bit_relations
             SET position = :position
             WHERE parent_bit_id = :parent_bit_id
               AND child_bit_id = :child_bit_id
               AND relation_type = :relation_type'
        );

        foreach (array_values($childBitIds) as $index => $childBitId) {
            $stmt->execute([
                'position' => $index + 1,
                'parent_bit_id' => $parentBitId,
                'child_bit_id' => (int) $childBitId,
                'relation_type' => $relationType,
            ]);
        }
    }

    public function addAttachment(int $userId, int $bitId, array $storedFile): int
    {
        $attachmentId = $this->createBaseBit(
            $userId,
            'attachment',
            (string) ($storedFile['original_name'] ?? 'Attachment'),
            ''
        );

        $stmt = $this->pdo->prepare(
            'INSERT INTO bit_attachment_bits (
                bit_id,
                user_id,
                original_name,
                stored_name,
                relative_path,
                mime_type,
                size_bytes
             ) VALUES (
                :bit_id,
                :user_id,
                :original_name,
                :stored_name,
                :relative_path,
                :mime_type,
                :size_bytes
             )'
        );
        $stmt->execute([
            'bit_id' => $attachmentId,
            'user_id' => $userId,
            'original_name' => $storedFile['original_name'],
            'stored_name' => $storedFile['stored_name'],
            'relative_path' => $storedFile['relative_path'],
            'mime_type' => $storedFile['mime_type'],
            'size_bytes' => $storedFile['size_bytes'],
        ]);

        $this->attachChildBit($bitId, $attachmentId, 'attachment');

        return $attachmentId;
    }

    public function updateScene(int $sceneBitId, array $payload): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE bits
             SET title = :title, updated_at = UTC_TIMESTAMP()
             WHERE id = :id'
        );
        $stmt->execute([
            'title' => trim((string) ($payload['title'] ?? 'Scene')),
            'id' => $sceneBitId,
        ]);

        $stmt = $this->pdo->prepare(
            'UPDATE bit_scene_bits
             SET scene_number = :scene_number,
                 timestamp_in = :timestamp_in,
                 duration = :duration,
                 notes = :notes,
                 is_done = :is_done
             WHERE bit_id = :bit_id'
        );
        $stmt->execute([
            'scene_number' => (int) ($payload['scene_number'] ?? 1),
            'timestamp_in' => $payload['timestamp_in'] ?? null,
            'duration' => $payload['duration'] ?? null,
            'notes' => trim((string) ($payload['notes'] ?? '')),
            'is_done' => !empty($payload['is_done']) ? 1 : 0,
            'bit_id' => $sceneBitId,
        ]);
    }

    public function addScene(int $userId, int $bitId, array $payload): int
    {
        $sceneNumber = (int) ($payload['scene_number'] ?? 1);
        $title = 'Scene ' . $sceneNumber;

        $sceneId = $this->createBaseBit(
            $userId,
            'scene',
            $title,
            (string) ($payload['notes'] ?? '')
        );

        $stmt = $this->pdo->prepare(
            'INSERT INTO bit_scene_bits (
                bit_id,
                scene_number,
                timestamp_in,
                duration,
                notes
             ) VALUES (
                :bit_id,
                :scene_number,
                :timestamp_in,
                :duration,
                :notes
             )'
        );
        $stmt->execute([
            'bit_id' => $sceneId,
            'scene_number' => $sceneNumber,
            'timestamp_in' => $payload['timestamp_in'] ?? null,
            'duration' => $payload['duration'] ?? null,
            'notes' => trim((string) ($payload['notes'] ?? '')),
        ]);

        $this->attachChildBit($bitId, $sceneId, 'scene');

        return $sceneId;
    }

    public function addLinkedFile(int $userId, int $bitId, array $payload): int
    {
        $displayName = trim((string) ($payload['display_name'] ?? ''));
        $originalName = trim((string) ($payload['original_name'] ?? ''));
        $title = $displayName !== '' ? $displayName : ($originalName !== '' ? $originalName : 'Linked file');

        $linkedFileId = $this->createBaseBit(
            $userId,
            'linked_file',
            $title,
            trim((string) ($payload['description'] ?? ''))
        );

        $stmt = $this->pdo->prepare(
            'INSERT INTO bit_linked_file_bits (
                bit_id,
                user_id,
                display_name,
                description,
                original_name,
                locator,
                mime_type,
                size_bytes,
                source_label
             ) VALUES (
                :bit_id,
                :user_id,
                :display_name,
                :description,
                :original_name,
                :locator,
                :mime_type,
                :size_bytes,
                :source_label
             )'
        );
        $stmt->execute([
            'bit_id' => $linkedFileId,
            'user_id' => $userId,
            'display_name' => $displayName !== '' ? $displayName : $title,
            'description' => trim((string) ($payload['description'] ?? '')),
            'original_name' => $originalName !== '' ? $originalName : $title,
            'locator' => trim((string) ($payload['locator'] ?? '')),
            'mime_type' => trim((string) ($payload['mime_type'] ?? 'application/octet-stream')),
            'size_bytes' => max(0, (int) ($payload['size_bytes'] ?? 0)),
            'source_label' => trim((string) ($payload['source_label'] ?? 'Unknown device')),
        ]);

        $this->attachChildBit($bitId, $linkedFileId, 'linked_file');

        return $linkedFileId;
    }

    public function deleteLinkedFile(int $userId, int $linkedFileBitId): void
    {
        $stmt = $this->pdo->prepare(
            'DELETE FROM bits
             WHERE id = :bit_id
               AND owner_user_id = :user_id
               AND bit_type = :bit_type'
        );
        $stmt->execute([
            'bit_id' => $linkedFileBitId,
            'user_id' => $userId,
            'bit_type' => 'linked_file',
        ]);
    }

    private function createBaseBit(int $userId, string $bitType, string $title, string $contentPreview): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO bits (owner_user_id, bit_type, title, content_preview)
             VALUES (:owner_user_id, :bit_type, :title, :content_preview)'
        );
        $stmt->execute([
            'owner_user_id' => $userId,
            'bit_type' => $bitType,
            'title' => $title !== '' ? $title : 'Untitled',
            'content_preview' => $contentPreview,
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    private function attachChildBit(int $parentBitId, int $childBitId, string $relationType, ?int $position = null): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO bit_relations (parent_bit_id, child_bit_id, relation_type, position)
             VALUES (:parent_bit_id, :child_bit_id, :relation_type, :position)'
        );
        $stmt->execute([
            'parent_bit_id' => $parentBitId,
            'child_bit_id' => $childBitId,
            'relation_type' => $relationType,
            'position' => $position ?? $this->nextRelationPosition($parentBitId, $relationType),
        ]);
    }

    private function nextRelationPosition(int $parentBitId, string $relationType): int
    {
        $stmt = $this->pdo->prepare(
            'SELECT COALESCE(MAX(position), 0) + 1 AS next_position
             FROM bit_relations
             WHERE parent_bit_id = :parent_bit_id
               AND relation_type = :relation_type'
        );
        $stmt->execute([
            'parent_bit_id' => $parentBitId,
            'relation_type' => $relationType,
        ]);

        return (int) ($stmt->fetch()['next_position'] ?? 1);
    }

    private function commentBits(int $bitId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT
                child.id,
                child.title,
                child.content_preview,
                child.created_at,
                comment.author_user_id,
                comment.body
             FROM bit_relations relation
             INNER JOIN bits child ON child.id = relation.child_bit_id
             INNER JOIN bit_comment_bits comment ON comment.bit_id = child.id
             WHERE relation.parent_bit_id = :parent_bit_id
               AND relation.relation_type = :relation_type
             ORDER BY relation.position ASC, child.id ASC'
        );
        $stmt->execute([
            'parent_bit_id' => $bitId,
            'relation_type' => 'comment',
        ]);

        return $stmt->fetchAll();
    }

    private function checklistBits(int $bitId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT
                child.id,
                child.title,
                child.created_at,
                relation.position
             FROM bit_relations relation
             INNER JOIN bits child ON child.id = relation.child_bit_id
             INNER JOIN bit_checklists checklist ON checklist.bit_id = child.id
             WHERE relation.parent_bit_id = :parent_bit_id
               AND relation.relation_type = :relation_type
             ORDER BY relation.position ASC, child.id ASC'
        );
        $stmt->execute([
            'parent_bit_id' => $bitId,
            'relation_type' => 'checklist',
        ]);

        $checklists = $stmt->fetchAll();

        foreach ($checklists as &$checklist) {
            $checklist['items'] = $this->checklistEntries((int) $checklist['id']);
        }

        return $checklists;
    }

    private function checklistEntries(int $checklistBitId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT
                child.id,
                child.title,
                child.created_at,
                relation.position,
                item.is_done
             FROM bit_relations relation
             INNER JOIN bits child ON child.id = relation.child_bit_id
             INNER JOIN bit_checklist_item_bits item ON item.bit_id = child.id
             WHERE relation.parent_bit_id = :parent_bit_id
               AND relation.relation_type = :relation_type
             ORDER BY relation.position ASC, child.id ASC'
        );
        $stmt->execute([
            'parent_bit_id' => $checklistBitId,
            'relation_type' => 'checklist_item',
        ]);

        return $stmt->fetchAll();
    }

    private function attachmentBits(int $bitId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT
                child.id,
                child.title,
                attachment.original_name,
                attachment.relative_path,
                attachment.mime_type,
                attachment.size_bytes,
                child.created_at
             FROM bit_relations relation
             INNER JOIN bits child ON child.id = relation.child_bit_id
             INNER JOIN bit_attachment_bits attachment ON attachment.bit_id = child.id
             WHERE relation.parent_bit_id = :parent_bit_id
               AND relation.relation_type = :relation_type
             ORDER BY relation.position ASC, child.id ASC'
        );
        $stmt->execute([
            'parent_bit_id' => $bitId,
            'relation_type' => 'attachment',
        ]);

        return $stmt->fetchAll();
    }

    private function linkedFileBits(int $bitId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT
                child.id,
                child.title,
                linked_file.display_name,
                linked_file.description,
                linked_file.original_name,
                linked_file.locator,
                linked_file.mime_type,
                linked_file.size_bytes,
                linked_file.source_label,
                child.created_at
             FROM bit_relations relation
             INNER JOIN bits child ON child.id = relation.child_bit_id
             INNER JOIN bit_linked_file_bits linked_file ON linked_file.bit_id = child.id
             WHERE relation.parent_bit_id = :parent_bit_id
               AND relation.relation_type = :relation_type
             ORDER BY relation.position ASC, child.id ASC'
        );
        $stmt->execute([
            'parent_bit_id' => $bitId,
            'relation_type' => 'linked_file',
        ]);

        return $stmt->fetchAll();
    }

    private function sceneBits(int $bitId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT
                child.id,
                child.title,
                child.created_at,
                relation.position,
                scene.scene_number,
                scene.timestamp_in,
                scene.duration,
                scene.is_done,
                scene.notes
             FROM bit_relations relation
             INNER JOIN bits child ON child.id = relation.child_bit_id
             INNER JOIN bit_scene_bits scene ON scene.bit_id = child.id
             WHERE relation.parent_bit_id = :parent_bit_id
               AND relation.relation_type = :relation_type
             ORDER BY relation.position ASC, child.id ASC'
        );
        $stmt->execute([
            'parent_bit_id' => $bitId,
            'relation_type' => 'scene',
        ]);

        return $stmt->fetchAll();
    }
}
