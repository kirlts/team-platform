-- «Enviar como» (UD-255, H-3726): a member sends an input in the name of another member. Forward only; the runner
-- opens the transaction.
--   inputs.sent_by_member_id   the member who had the session when the input was sent. NULL when it is the author
--                              (every input before this migration, and every input sent in one's own name). The
--                              author (`author_id`) is the member chosen in «Enviar como»; the input, its messages and
--                              the rules of «mine» follow the author, and the audit row keeps both.

ALTER TABLE inputs ADD COLUMN sent_by_member_id INTEGER REFERENCES members (id);
