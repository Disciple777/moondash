-- =====================================================================
-- Moondash additions for database `u480328775_bits`
-- Run this on your Hostinger database (phpMyAdmin -> SQL tab).
-- It only ADDS new tables and columns (via guarded procedures); it never
-- drops or alters existing data, so the Board app and Stickly app keep
-- working untouched.
--
-- To update an existing installation, just re-run this file: the CREATE
-- TABLE IF NOT EXISTS statements and the guarded ALTERs are idempotent.
-- =====================================================================

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- --------------------------------------------------------
-- Workspaces: a synced folder root owned by a user.
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `workspaces` (
  `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `owner_user_id` bigint(20) UNSIGNED NOT NULL,
  `name` varchar(160) NOT NULL,
  `description` text DEFAULT NULL,
  `type` varchar(16) NOT NULL DEFAULT 'folder',
  `color_hex` char(7) NOT NULL DEFAULT '#5B5BD6',
  `icon_key` varchar(40) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `fk_workspaces_owner` (`owner_user_id`),
  CONSTRAINT `fk_workspaces_owner` FOREIGN KEY (`owner_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- workspace_doc_links: for multi-space workspaces (type='multi').
-- Each row links a doc bit (whose real home lives in another workspace's
-- doc_files row) into the multi-space. The multi-space is a cloud-only
-- aggregation space: it never maps 1:1 to a local folder, and the linked
-- docs keep living + syncing in their original workspaces.
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `workspace_doc_links` (
  `workspace_id` bigint(20) UNSIGNED NOT NULL,
  `bit_id` bigint(20) UNSIGNED NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`workspace_id`,`bit_id`),
  KEY `fk_wdl_bit` (`bit_id`),
  CONSTRAINT `fk_wdl_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_wdl_bit` FOREIGN KEY (`bit_id`) REFERENCES `bits` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- doc_files: maps each markdown doc (a bit with bit_type='doc',
-- body in bit_notes) to a workspace-relative file path and tracks
-- the content hash + revision used by the folder-sync engine.
-- --------------------------------------------------------
-- --------------------------------------------------------
-- bit_folders: organizational folders (database-only, not filesystem
-- directories). A folder is a bit (bit_type='folder'); this table holds its
-- workspace scope, color and icon. Membership (docs and nested folders)
-- lives in the existing bit_relations table with relation_type='member' —
-- so a doc bit can belong to many folders at once.
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bit_folders` (
  `bit_id` bigint(20) UNSIGNED NOT NULL,
  `workspace_id` bigint(20) UNSIGNED NOT NULL,
  `color_hex` char(7) NOT NULL DEFAULT '#5B5BD6',
  `icon_key` varchar(40) DEFAULT NULL,
  `position` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`bit_id`),
  KEY `fk_bit_folders_workspace` (`workspace_id`),
  CONSTRAINT `fk_bit_folders_bit` FOREIGN KEY (`bit_id`) REFERENCES `bits` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bit_folders_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `doc_files` (
  `id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
  `workspace_id` bigint(20) UNSIGNED NOT NULL,
  `bit_id` bigint(20) UNSIGNED NOT NULL,
  `relative_path` varchar(500) NOT NULL,
  `alias` varchar(200) DEFAULT NULL,
  `content_hash` char(64) NOT NULL,
  `revision` bigint(20) UNSIGNED NOT NULL DEFAULT 1,
  `is_deleted` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_doc_files_workspace_path` (`workspace_id`,`relative_path`),
  KEY `fk_doc_files_workspace` (`workspace_id`),
  KEY `fk_doc_files_bit` (`bit_id`),
  CONSTRAINT `fk_doc_files_workspace` FOREIGN KEY (`workspace_id`) REFERENCES `workspaces` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_doc_files_bit` FOREIGN KEY (`bit_id`) REFERENCES `bits` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------
-- Linked files: a doc whose doc_files.local_path is set lives at an absolute
-- path on the user's disk (outside any synced folder). The desktop app links
-- it in place: edits in the app are written straight to that file, and the
-- linked-file sync engine mirrors disk changes back to the cloud. The doc
-- still maps to a workspace (a hidden per-user 'external' workspace) so every
-- existing tree/link/relation query keeps working unchanged.
-- --------------------------------------------------------
DROP PROCEDURE IF EXISTS `moondash_add_doc_files_local_path`;
DELIMITER $$
CREATE PROCEDURE `moondash_add_doc_files_local_path`()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'doc_files'
          AND column_name = 'local_path'
    ) THEN
        ALTER TABLE `doc_files` ADD COLUMN `local_path` varchar(1000) DEFAULT NULL AFTER `relative_path`;
    END IF;
END$$
DELIMITER ;
CALL `moondash_add_doc_files_local_path`();
DROP PROCEDURE IF EXISTS `moondash_add_doc_files_local_path`;

-- --------------------------------------------------------
-- Workspaces created before the type/icon/color columns existed (i.e. an
-- existing installation re-running this file) get them added via a guarded
-- procedure — works on both MySQL and MariaDB.
-- --------------------------------------------------------
DROP PROCEDURE IF EXISTS `moondash_add_workspace_columns`;
DELIMITER $$
CREATE PROCEDURE `moondash_add_workspace_columns`()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'workspaces'
          AND column_name = 'type'
    ) THEN
        ALTER TABLE `workspaces` ADD COLUMN `type` varchar(16) NOT NULL DEFAULT 'folder' AFTER `description`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'workspaces'
          AND column_name = 'color_hex'
    ) THEN
        ALTER TABLE `workspaces` ADD COLUMN `color_hex` char(7) NOT NULL DEFAULT '#5B5BD6' AFTER `type`;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'workspaces'
          AND column_name = 'icon_key'
    ) THEN
        ALTER TABLE `workspaces` ADD COLUMN `icon_key` varchar(40) DEFAULT NULL AFTER `color_hex`;
    END IF;
END$$
DELIMITER ;
CALL `moondash_add_workspace_columns`();
DROP PROCEDURE IF EXISTS `moondash_add_workspace_columns`;

-- --------------------------------------------------------
-- The Board app created bit_relations without FKs on parent/child;
-- these indexes keep the folder tree queries fast (idempotent in
-- both MySQL and MariaDB via a guarded stored procedure).
-- --------------------------------------------------------
DROP PROCEDURE IF EXISTS `moondash_add_bit_relations_indexes`;
DELIMITER $$
CREATE PROCEDURE `moondash_add_bit_relations_indexes`()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'bit_relations'
          AND index_name = 'idx_bit_relations_parent_type'
    ) THEN
        ALTER TABLE `bit_relations`
            ADD KEY `idx_bit_relations_parent_type` (`parent_bit_id`,`relation_type`);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE() AND table_name = 'bit_relations'
          AND index_name = 'idx_bit_relations_child_type'
    ) THEN
        ALTER TABLE `bit_relations`
            ADD KEY `idx_bit_relations_child_type` (`child_bit_id`,`relation_type`);
    END IF;
END$$
DELIMITER ;
CALL `moondash_add_bit_relations_indexes`();
DROP PROCEDURE IF EXISTS `moondash_add_bit_relations_indexes`;
