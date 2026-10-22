-- What a video frame shows and nobody says (`observed`, the analyzer's «Observado, no dicho»): an array of strings
-- that travels outside the body of the message, from the proposal to the published message. NULL when the message
-- has none, which is every message published before this column. Forward only; the runner opens the transaction.

ALTER TABLE messages ADD COLUMN observed_json TEXT;
