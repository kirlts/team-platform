-- Progress notices while Claude works (UD-293). Forward only; the runner opens the transaction.
--   templates.progress_interval_min  minutes between two notices in the thread while a session of a message of this template runs.
--                                    0 turns them off. The 20 is Martín's (2026-10-25 02:31) and applies to the rows that exist.
--   progress_notes                   one row per notice. Not a reply: a reply counts as an answer (status, reply count, last reply, first reply of
--                                    the agent, anchors of the auto-close and of the mentions), and a notice is none of those. The thread draws
--                                    it between the message and the final answer, by `created_at`.
--     job_id              the `execute` job whose session the notice is about.
--     data_json           the facts the body was written from: minutes, turns, tools, last step, last pushed commit.
--     session_started_at  when the worker started to follow the session; a second attempt that attaches to the same session keeps it.
ALTER TABLE templates ADD COLUMN progress_interval_min INTEGER NOT NULL DEFAULT 20 CHECK (progress_interval_min >= 0);

CREATE TABLE progress_notes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id         INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  job_id             INTEGER NOT NULL,
  author_id          INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  body               TEXT    NOT NULL,
  data_json          TEXT    NOT NULL,
  session_started_at INTEGER NOT NULL,
  created_at         INTEGER NOT NULL
);
CREATE INDEX progress_notes_message ON progress_notes (message_id, id);
CREATE INDEX progress_notes_job ON progress_notes (job_id);
