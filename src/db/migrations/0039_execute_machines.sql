-- The machines that the `execute` job created and whose destruction is not yet recorded (plan 2026, piece B4). Forward only.
--   execute_machines   one row per machine, written BEFORE the CREATE order runs (a worker that dies half way still leaves the row) and closed when
--                      DESTROY exits 0. A row with `destroyed_at` NULL whose job is not running under a live lease is an orphan: the worker destroys it
--                      when it starts and when a lease expires. `destroy_attempts` and `destroy_error` keep the last failure of DESTROY (a permission, the
--                      network): a failure is never read as «no machine», it stays here until a DESTROY exits 0.
--   Why a table and not columns of `execute_runs`: that row is written when the attempt ends, so a worker killed in the middle leaves none.
--   `parked`  1 when an orderly shutdown left the machine and its session alive on purpose (EXECUTE_KEEP_SESSION_ON_SHUTDOWN) for the next attempt of the
--             job; that attempt adopts the row (it deletes it when CREATE names the same machine). A parked row whose job is not coming back is an orphan.
--   `machine` starts as the default name `team-job-<job_id>` and takes the name CREATE printed once it ends. `workdir` is the path that the orders
--   received as {workdir}; the directory is gone by the time an orphan is destroyed, the path is only what the order gets as its marker.
--   Retention: the rows destroyed go with the runs (EXECUTE_RUNS_RETENTION_DAYS).
CREATE TABLE execute_machines (
  id                INTEGER PRIMARY KEY,
  job_id            INTEGER NOT NULL,
  attempt           INTEGER NOT NULL,
  machine           TEXT NOT NULL,
  workdir           TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  destroyed_at      INTEGER,
  destroy_attempts  INTEGER NOT NULL DEFAULT 0,
  destroy_error     TEXT,
  parked            INTEGER NOT NULL DEFAULT 0 CHECK (parked IN (0, 1))
);
CREATE INDEX execute_machines_pending ON execute_machines (job_id) WHERE destroyed_at IS NULL;
