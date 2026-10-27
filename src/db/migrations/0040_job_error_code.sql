-- The stable code of the failure that ended a job (`lease_expired`, `execute_timeout`...), written by the same statement that sets `failed` (plan 2026,
-- race of 2026-10-27). Forward only.
--   Why: two paths close the same input after a job fails: its handler (`onFailure`, which knows the code of the error it was given) and the sweeps
--   that find a failed job whose handler never ran (a restart, a slow machine). The sweeps only had the text of `last_error`, so they invented
--   `job_failed_unseen` and, when they arrived first, the author read that instead of the real cause: the order of two timers decided the answer.
--   With the code in the row, every path that settles the input reads the cause from the job and the order stops mattering.
--   NULL: a job that failed before this migration, or one whose error carried no code; the sweeps keep `job_failed_unseen` for those.
ALTER TABLE jobs ADD COLUMN error_code TEXT;
