-- Mentions in a reply (UD-275). Forward only; the runner opens the transaction.
--   reply_mentions   the members a reply mentions, chosen from the list the panel offers (never read from the text of the reply).
--     member_id      the mentioned member, a person or an agent.
--     pending        1 while an agent mention waits for its `execute` job: the agent was already working the message when it was mentioned, and the
--                    mention is attended when that work ends (a mention is never lost). 0 once a job carries it, and always 0 for a person.
--     job_id         the `execute` job that carries the mention (NULL for a person and while it is pending).

CREATE TABLE reply_mentions (
  reply_id  INTEGER NOT NULL REFERENCES replies (id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members (id),
  pending   INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1)),
  job_id    INTEGER,
  PRIMARY KEY (reply_id, member_id)
);
CREATE INDEX reply_mentions_pending ON reply_mentions (member_id) WHERE pending = 1;
