-- In-place editing (UD-017) and the account language (UD-018). Forward only; the runner opens the transaction.
--   messages.updated_at      last in-place edit (PATCH /messages/:id); equals created_at until the first edit.
--                            There is no version history table: UD-017 rejects it explicitly.
--   members.language         the account language (UD-018): 'es-419' (default, neutral Latin American Spanish) or 'en'.
--                            It selects the prompts, the language of the output and the panel language.

ALTER TABLE messages ADD COLUMN updated_at INTEGER;
UPDATE messages SET updated_at = created_at;

ALTER TABLE members ADD COLUMN language TEXT NOT NULL DEFAULT 'es-419' CHECK (language IN ('es-419', 'en'));
