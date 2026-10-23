-- The delivery as a job of its own (UD-263). Forward only; the runner opens the transaction.
--   jobs.kind                   adds 'deliver': the host's delivery command runs after `execute`, with no AI and no machine.
--   execute_runs.deliver_job_id the `deliver` job that followed the run, and execute_runs.delivery_ref what its command printed
--                               as the last line of stdout (a commit, a URL or a label). `delivery_ms` and `delivered` already
--                               existed: until now the session filled them with `team mark delivery`; the `deliver` job fills them.
-- SQLite cannot alter a CHECK: `jobs` is rebuilt with the same pattern as 0013 (rows of job_events kept aside, because DROP TABLE
-- fires ON DELETE CASCADE) and every column that 0015, 0017 and 0018 added.

CREATE TABLE jobs_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  kind             TEXT    NOT NULL CHECK (kind IN ('extract', 'analyze', 'execute', 'deliver')),
  input_id         INTEGER REFERENCES inputs (id) ON DELETE CASCADE,
  message_id       INTEGER REFERENCES messages (id) ON DELETE CASCADE,
  payload_json     TEXT    NOT NULL DEFAULT '{}',
  status           TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  priority         INTEGER NOT NULL DEFAULT 0,
  attempts         INTEGER NOT NULL DEFAULT 0,
  max_attempts     INTEGER NOT NULL DEFAULT 3,
  run_at           INTEGER NOT NULL,
  lease_until      INTEGER,
  worker_id        TEXT,
  last_error       TEXT,
  created_at       INTEGER NOT NULL,
  finished_at      INTEGER,
  cost_usd         REAL,
  runner           TEXT,
  trace_id         TEXT,
  traceparent      TEXT,
  link_traceparent TEXT,
  last_span        TEXT,
  phase            TEXT,
  marks_json       TEXT
);
INSERT INTO jobs_new (id, kind, input_id, message_id, payload_json, status, priority, attempts, max_attempts, run_at, lease_until, worker_id, last_error, created_at, finished_at, cost_usd, runner, trace_id, traceparent, link_traceparent, last_span, phase, marks_json)
  SELECT id, kind, input_id, message_id, payload_json, status, priority, attempts, max_attempts, run_at, lease_until, worker_id, last_error, created_at, finished_at, cost_usd, runner, trace_id, traceparent, link_traceparent, last_span, phase, marks_json FROM jobs;

CREATE TEMP TABLE job_events_keep AS SELECT * FROM job_events WHERE job_id IS NOT NULL;
DROP TABLE jobs;
ALTER TABLE jobs_new RENAME TO jobs;
INSERT INTO job_events SELECT * FROM job_events_keep;
DROP TABLE job_events_keep;

CREATE INDEX jobs_claim ON jobs (status, priority DESC, run_at, id);
CREATE INDEX jobs_input ON jobs (input_id);
CREATE INDEX jobs_message ON jobs (message_id);

ALTER TABLE execute_runs ADD COLUMN deliver_job_id INTEGER;
ALTER TABLE execute_runs ADD COLUMN delivery_ref TEXT;
