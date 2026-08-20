-- Migration: add position column to bit_folders for folder ordering
ALTER TABLE bit_folders ADD COLUMN `position` INT NOT NULL DEFAULT 0;

-- Add index for workspace + position queries
ALTER TABLE bit_folders ADD INDEX idx_folders_ws_pos (workspace_id, `position`);
