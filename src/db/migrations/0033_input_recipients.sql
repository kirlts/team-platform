-- The members a send is addressed to (UD-291). Forward only; the runner opens the transaction.
--   inputs.recipient_ids_json  JSON list of member ids chosen by the sender; '[]' means the automatic routing assigns, as before.
ALTER TABLE inputs ADD COLUMN recipient_ids_json TEXT NOT NULL DEFAULT '[]';
