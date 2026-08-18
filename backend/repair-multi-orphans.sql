-- repair-multi-orphans.sql
-- ------------------------------------------------------------------
-- Fixes: "A doc already exists at this path" + "no documents appear"
-- in a multi-space.
--
-- Why it happens: older app builds created new pages DIRECTLY inside
-- the multi-space (the multi-space is only an aggregation space and
-- never owns files). Those docs were written to doc_files with the
-- multi-space as their workspace, so the multi-space's tree (which
-- only shows linked docs) never displayed them — but they still
-- occupied the path, which is why re-creating the same name failed
-- with "A doc already exists at this path".
--
-- This is a SAFE, idempotent repair: it simply links every such
-- orphan doc into its own multi-space, so it becomes visible again.
-- Nothing is deleted. Run it in phpMyAdmin (SQL tab). It is safe to
-- re-run.
-- ------------------------------------------------------------------

INSERT IGNORE INTO workspace_doc_links (workspace_id, bit_id)
SELECT df.workspace_id, df.bit_id
FROM doc_files df
JOIN workspaces ws ON ws.id = df.workspace_id
WHERE ws.type = 'multi'
  AND df.is_deleted = 0
  AND NOT EXISTS (
    SELECT 1
    FROM workspace_doc_links wdl
    WHERE wdl.workspace_id = df.workspace_id
      AND wdl.bit_id = df.bit_id
  );

-- Sanity check afterwards (should return 0 rows once the repair has run):
-- SELECT COUNT(*) AS still_orphaned
-- FROM doc_files df
-- JOIN workspaces ws ON ws.id = df.workspace_id
-- WHERE ws.type = 'multi'
--   AND df.is_deleted = 0
--   AND NOT EXISTS (
--     SELECT 1 FROM workspace_doc_links wdl
--     WHERE wdl.workspace_id = df.workspace_id AND wdl.bit_id = df.bit_id
--   );
