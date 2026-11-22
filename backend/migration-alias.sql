-- Migration: add alias column to doc_files for a per-document display name.
--
-- The alias is a "second name": what the app shows for a document, without
-- touching its file name on disk. NULL means "no alias" and the file's own
-- title is shown instead. It lives on doc_files (not bits) so it belongs to
-- the document in its workspace, and so it travels with the cloud record —
-- the same alias shows up on web, desktop and phone.
ALTER TABLE `doc_files` ADD COLUMN `alias` VARCHAR(200) NULL DEFAULT NULL;
