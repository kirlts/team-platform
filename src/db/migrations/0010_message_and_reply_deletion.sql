-- UD-240: a published message and a reply are soft-deleted (`deleted_at`) and restored, like areas and templates.
-- Nothing that references them is lost: the rows stay, every read ignores them while `deleted_at` is set, and
-- `POST …/restore` clears it. The sender or an Editor deletes a message; the author of a reply or an Editor deletes
-- a reply. Forward only; the runner opens the transaction.
-- Indexes: the list orders live messages by date (messages_created already covers the order, this one lets the
-- planner skip deleted rows first) and the thread, the counts and the search read the live replies of a message.

ALTER TABLE messages ADD COLUMN deleted_at INTEGER;
ALTER TABLE replies ADD COLUMN deleted_at INTEGER;

CREATE INDEX messages_live_created ON messages (deleted_at, created_at DESC, id DESC);
CREATE INDEX replies_live_message ON replies (message_id, deleted_at, id);
