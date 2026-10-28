-- UD-253 (Martín): "lo reversible ofrece Deshacer", and the sends are listed, so deleting one is reversible like deleting a message (UD-240, migration 0010).
-- Forward only.
--   inputs.deleted_at       When the send was deleted (ms); NULL while it is alive. Every read of the team's sends ignores a deleted one.
--   inputs.deleted_status   The status it had when it was deleted. A send that was in flight is left `cancelled` (its jobs are cancelled), and restoring
--                           it brings it back to `proposed` or `failed` like undoing a discard does.
--   messages.unlinked_input_id  The send a message was published from, kept while the send is deleted: the message shows no send (`input_id` is NULL, as
--                           when the send was removed for good) and restoring the send links it again. A message deleted together with its send carries the
--                           same `deleted_at` as the send, so restoring brings back exactly those.
ALTER TABLE inputs ADD COLUMN deleted_at INTEGER;
ALTER TABLE inputs ADD COLUMN deleted_status TEXT;
ALTER TABLE messages ADD COLUMN unlinked_input_id INTEGER;
CREATE INDEX messages_unlinked_input ON messages (unlinked_input_id) WHERE unlinked_input_id IS NOT NULL;
