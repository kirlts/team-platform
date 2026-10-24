-- A mention that reaches the session while it works (UD-285). Forward only; the runner opens the transaction.
--   reply_mentions.live_at           when the running session of the agent took the mention (NULL when a job carried it from its start, or while it waits). A mention taken
--                                    live has `pending = 0` and `job_id` = the running job, so the end of that job does not enqueue it again.
--   reply_mentions.live_ack_reply_id the reply the system wrote in the agent's name when the session took it (a fixed line, never the model's): the thread shows that Claude
--                                    received it. It does not count as the answer of the guarantee of UD-278.
ALTER TABLE reply_mentions ADD COLUMN live_at INTEGER;
ALTER TABLE reply_mentions ADD COLUMN live_ack_reply_id INTEGER;
