-- Author edits of published messages (UD-071). Forward only; the runner opens the transaction.
--   messages.version     starts at 1 and grows by one with every edit; PATCH /messages/:id sends the version it
--                        read and a stale one is a 409 (optimistic concurrency, so two edits never overwrite each other).
--   messages.edited_at   time of the last edit by the author; NULL while the message was never edited (the panel shows «editado»).
--   message_edits        who edited, when and which fields; the values are not stored (UD-017 rejects a version history).

ALTER TABLE messages ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE messages ADD COLUMN edited_at INTEGER;
UPDATE messages SET edited_at = updated_at WHERE updated_at IS NOT NULL AND updated_at <> created_at;

CREATE TABLE message_edits (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  member_id   INTEGER NOT NULL REFERENCES members (id),
  at          INTEGER NOT NULL,
  version     INTEGER NOT NULL, -- the version the message has after this edit
  fields_json TEXT    NOT NULL  -- JSON array with the names of the fields that changed
);
CREATE INDEX message_edits_message ON message_edits (message_id, id);
