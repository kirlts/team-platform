-- Replies with media and the member lifecycle. Forward only; the runner opens the transaction.
--   reply_attachments   files and links attached to a reply, stored like `attachments` (same volume, same limits,
--                       named by SHA-256; for kind = 'link' `path` holds the URL). A separate table because
--                       `attachments.input_id` is NOT NULL and rebuilding that table would cascade into
--                       `message_attachments`. A reply is never analyzed: it is stored and served only.
--   members.active      soft deactivation by an Editor: 1 active, 0 deactivated. A deactivated member cannot log in
--                       and keeps their history (messages, replies, audit rows).

CREATE TABLE reply_attachments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  reply_id  INTEGER NOT NULL REFERENCES replies (id) ON DELETE CASCADE,
  kind      TEXT    NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'document', 'link')),
  name      TEXT    NOT NULL DEFAULT '',
  path      TEXT    NOT NULL,
  mime      TEXT    NOT NULL DEFAULT '',
  size      INTEGER NOT NULL DEFAULT 0,
  sha256    TEXT    NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX reply_attachments_reply ON reply_attachments (reply_id, position, id);
CREATE INDEX reply_attachments_sha ON reply_attachments (sha256);

ALTER TABLE members ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
