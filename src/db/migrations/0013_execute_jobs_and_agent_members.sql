-- Agent members and the `execute` job (UD-254, UD-255, H-3724). Forward only; the runner opens the transaction.
--   members.kind                    'person' (default) or 'agent'. An agent has a profile like anyone (UD-023), never a
--                                   password, and enters by a signed header with a secret of its own.
--   members_agent_credentials       the agent's secret, sealed with the vault (AES-256-GCM, src/domain/vault.js). HMAC
--                                   needs the secret itself, so it is sealed rather than hashed; the API shows it once.
--   jobs.kind                       adds 'execute': an unattended Claude Code session works a message for an agent.
--   jobs.message_id                 the message an `execute` job works on (NULL for extract and analyze).
-- SQLite cannot alter a CHECK: `jobs` is rebuilt. The runner keeps foreign_keys ON inside the transaction and DROP TABLE
-- performs an implicit DELETE that fires ON DELETE CASCADE on job_events, so those rows are kept in a temporary table
-- and put back once the new table exists under the old name (the same pattern as 0011).

ALTER TABLE members ADD COLUMN kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'agent'));

CREATE TABLE members_agent_credentials (
  member_id     INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  sealed_value TEXT    NOT NULL,
  last4         TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  rotated_at    INTEGER
);

CREATE TABLE jobs_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT    NOT NULL CHECK (kind IN ('extract', 'analyze', 'execute')),
  input_id     INTEGER REFERENCES inputs (id) ON DELETE CASCADE,
  message_id   INTEGER REFERENCES messages (id) ON DELETE CASCADE,
  payload_json TEXT    NOT NULL DEFAULT '{}',
  status       TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  priority     INTEGER NOT NULL DEFAULT 0,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_at       INTEGER NOT NULL,
  lease_until  INTEGER,
  worker_id    TEXT,
  last_error   TEXT,
  created_at   INTEGER NOT NULL,
  finished_at  INTEGER
);
INSERT INTO jobs_new (id, kind, input_id, payload_json, status, priority, attempts, max_attempts, run_at, lease_until, worker_id, last_error, created_at, finished_at)
  SELECT id, kind, input_id, payload_json, status, priority, attempts, max_attempts, run_at, lease_until, worker_id, last_error, created_at, finished_at FROM jobs;

CREATE TEMP TABLE job_events_keep AS SELECT * FROM job_events WHERE job_id IS NOT NULL;
DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;
INSERT INTO job_events SELECT * FROM job_events_keep;
DROP TABLE job_events_keep;

CREATE INDEX jobs_claim ON jobs (status, priority DESC, run_at, id);
CREATE INDEX jobs_input ON jobs (input_id);
CREATE INDEX jobs_message ON jobs (message_id);
