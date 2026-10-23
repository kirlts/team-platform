-- One row per run of the `execute` job (UD-262): who ran, how long each part took, what it cost and where the session
-- transcript was left. It outlives the 7 days of `spans` and `jobs` (EXECUTE_RUNS_RETENTION_DAYS, 365 by default), so it
-- has no foreign keys. Times are milliseconds; NULL means unknown. `instance` tells apart the rows of a restored copy.
-- `jobs.marks_json` keeps what the session reported with `team mark` during the attempt. Forward only.
CREATE TABLE execute_runs (
  id                  INTEGER PRIMARY KEY,
  job_id              INTEGER NOT NULL,
  attempt             INTEGER NOT NULL,
  message_id          INTEGER,
  instance            TEXT NOT NULL DEFAULT '',
  trace_id            TEXT,
  session_id          TEXT,
  model               TEXT,
  runner              TEXT,
  machine             TEXT,
  started_at          INTEGER NOT NULL,
  finished_at         INTEGER NOT NULL,
  queue_wait_ms       INTEGER,
  first_reply_ms      INTEGER,
  final_reply_ms      INTEGER,
  total_ms            INTEGER,
  create_ms           INTEGER,
  run_ms              INTEGER,
  destroy_ms          INTEGER,
  tools_ms            INTEGER,
  judge_ms            INTEGER,
  delivery_ms         INTEGER,
  wait_ms             INTEGER,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  cache_read_tokens   INTEGER,
  cache_write_tokens  INTEGER,
  cost_usd            REAL,
  turns               INTEGER,
  tool_count          INTEGER,
  subagent_count      INTEGER,
  outcome             TEXT,
  error_code          TEXT,
  delivered           INTEGER CHECK (delivered IN (0, 1)),
  transcript_ref      TEXT,
  slowest_tools_json  TEXT NOT NULL DEFAULT '[]',
  UNIQUE (job_id, attempt)
);
CREATE INDEX execute_runs_started ON execute_runs (started_at);
CREATE INDEX execute_runs_message ON execute_runs (message_id);

ALTER TABLE jobs ADD COLUMN marks_json TEXT;
