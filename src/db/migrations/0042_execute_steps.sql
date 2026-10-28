-- The steps of an `execute` session: one row per call to a tool, in the order the stream reported them. Forward only.
--   execute_steps   `position` orders the steps of a job across its attempts; `action` is the class the panel names (read, edit, command, search,
--                   subagent, web, plan, capture, other); `tool` is the technical name of the tool; `detail` is the file, the command or the pattern, cut to
--                   a declared length. `ended_at` and `failed` come from the result of the call. A step that took a screenshot carries `capture_alt`
--                   from the line LOOK_CAPTURE of its output (known while the session runs); `capture_sha256`, `capture_kind` and `capture_mime` are
--                   written when the files are stored at the end of the session (the contract gives no earlier view of the file).
--   Why a table and not the spans: the spans last 7 days and are for timing; the history of what the session did outlives the job as long as the job does.
--   Retention: the rows go with their job (ON DELETE CASCADE), as `job_events` do. The count per job is capped by EXECUTE_STEPS_MAX.
CREATE TABLE execute_steps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id         INTEGER NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  attempt        INTEGER NOT NULL,
  position       INTEGER NOT NULL,
  at             INTEGER NOT NULL,
  ended_at       INTEGER,
  action         TEXT    NOT NULL,
  tool           TEXT    NOT NULL,
  detail         TEXT,
  failed         INTEGER NOT NULL DEFAULT 0,
  capture_alt    TEXT,
  capture_place  TEXT,
  capture_as     TEXT,
  capture_masked INTEGER,
  capture_sha256 TEXT,
  capture_kind   TEXT,
  capture_mime   TEXT,
  UNIQUE (job_id, position)
);
