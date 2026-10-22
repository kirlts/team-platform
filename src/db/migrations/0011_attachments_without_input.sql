-- Deleting an input for real (UD-240, H-3702). Forward only; the runner opens the transaction.
--   attachments.input_id   was NOT NULL with ON DELETE CASCADE: deleting the input row would also delete its
--                          attachment rows and, through message_attachments (ON DELETE CASCADE), the files of the
--                          messages published from that input. Now it is nullable with ON DELETE SET NULL: a
--                          message keeps its attachments after its input is gone (`input_id` NULL). The domain
--                          deletes by hand the rows no message references before deleting the input.
--   attachments_sha        index for the reference check by sha256 (storage.js), like reply_attachments_sha.
-- SQLite cannot alter a column: the table is rebuilt. The runner keeps foreign_keys ON inside the transaction and
-- DROP TABLE performs an implicit DELETE that fires ON DELETE CASCADE on message_attachments, so those rows are
-- copied to a temporary table first and put back once the new table exists under the old name.

CREATE TABLE attachments_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  input_id            INTEGER REFERENCES inputs (id) ON DELETE SET NULL,
  kind                TEXT    NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'document', 'link')),
  name                TEXT    NOT NULL DEFAULT '',
  path                TEXT    NOT NULL, -- file name in the volume (its sha256); for kind=link, the URL
  mime                TEXT    NOT NULL DEFAULT '',
  size                INTEGER NOT NULL DEFAULT 0,
  sha256              TEXT    NOT NULL,
  extracted_text      TEXT,
  extracted_at        INTEGER,
  extract_meta_json   TEXT
);
INSERT INTO attachments_new (id, input_id, kind, name, path, mime, size, sha256, extracted_text, extracted_at, extract_meta_json)
  SELECT id, input_id, kind, name, path, mime, size, sha256, extracted_text, extracted_at, extract_meta_json FROM attachments;

CREATE TEMP TABLE message_attachments_keep AS SELECT message_id, attachment_id, position FROM message_attachments;
DROP TABLE attachments;
ALTER TABLE attachments_new RENAME TO attachments;
INSERT INTO message_attachments (message_id, attachment_id, position) SELECT message_id, attachment_id, position FROM message_attachments_keep;
DROP TABLE message_attachments_keep;

CREATE INDEX attachments_input ON attachments (input_id);
CREATE INDEX attachments_sha ON attachments (sha256);
