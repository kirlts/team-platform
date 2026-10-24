-- The text of the audio and video attached to a reply (UD-278). Forward only; the runner opens the transaction.
-- It is what `attachments` already has for the files of a send: the transcript the extractor returns, when it was read and its meta.
ALTER TABLE reply_attachments ADD COLUMN extracted_text TEXT;
ALTER TABLE reply_attachments ADD COLUMN extracted_at INTEGER;
ALTER TABLE reply_attachments ADD COLUMN extract_meta_json TEXT;
