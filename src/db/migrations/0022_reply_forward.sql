-- Forwarding a message to a member (UD-272). Forward only; the runner opens the transaction.
--   replies.kind          adds 'forward': the notice in the thread that the message was forwarded, written by who forwards it. Its `body` is the
--                         reason they wrote.
--   replies.forwarded_to  the member the message was forwarded to (NULL in every other kind).
-- SQLite cannot alter a CHECK: `replies` is rebuilt with the same pattern as 0011 and 0019 (the rows of reply_attachments are kept aside, because DROP TABLE
-- fires ON DELETE CASCADE) and every column that 0010 and 0012 added.

CREATE TABLE replies_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id   INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  author_id    INTEGER NOT NULL REFERENCES members (id),
  body         TEXT    NOT NULL,
  kind         TEXT    NOT NULL DEFAULT 'answer' CHECK (kind IN ('answer', 'fix', 'clarification', 'forward')),
  created_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  version      INTEGER NOT NULL DEFAULT 1,
  edited_at    INTEGER,
  forwarded_to INTEGER REFERENCES members (id)
);
INSERT INTO replies_new (id, message_id, author_id, body, kind, created_at, deleted_at, version, edited_at)
  SELECT id, message_id, author_id, body, kind, created_at, deleted_at, version, edited_at FROM replies;

CREATE TEMP TABLE reply_attachments_keep AS SELECT * FROM reply_attachments;
DROP TABLE replies;
ALTER TABLE replies_new RENAME TO replies;
INSERT INTO reply_attachments (id, reply_id, kind, name, path, mime, size, sha256, position)
  SELECT id, reply_id, kind, name, path, mime, size, sha256, position FROM reply_attachments_keep;
DROP TABLE reply_attachments_keep;

CREATE INDEX replies_message ON replies (message_id, id);
CREATE INDEX replies_live_message ON replies (message_id, deleted_at, id);
