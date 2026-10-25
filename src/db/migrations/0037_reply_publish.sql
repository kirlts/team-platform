-- The work of an idea that is shown and not published (UD-306). Forward only; the runner opens the transaction.
--   replies.publish_json   on the «Lista para ver» reply: `{ job_id, attempt, output }`, the `execute` job whose branch it offers and the structured output of that session, so that
--                          «Publicar» (a person's approval) runs the normal delivery with the summary the session wrote; NULL in every other reply.
ALTER TABLE replies ADD COLUMN publish_json TEXT;
