-- The author of a reply edits its text in place (UD-253, H-3714), with the same optimistic concurrency as a message
-- (UD-071). Forward only; the runner opens the transaction.
--   replies.version     starts at 1 and grows by one with every edit; PATCH /messages/:id/replies/:replyId sends the
--                       version it read and a stale one is a 409.
--   replies.edited_at   time of the last edit; NULL while the reply was never edited (the panel shows «editada»).

ALTER TABLE replies ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE replies ADD COLUMN edited_at INTEGER;
