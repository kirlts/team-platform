-- Why a run left no transcript. Forward only.
--   execute_runs.transcript_error  NULL when the transcript was copied (transcript_ref set) or no EXECUTE_MACHINE_COLLECT is configured;
--                                  otherwise «exit <code>: <first 500 characters of the command's stderr>», or «no output» when it
--                                  exited 0 and printed nothing. Measured 2026-10-24: job 144 had a null transcript_ref and no trace of why.
ALTER TABLE execute_runs ADD COLUMN transcript_error TEXT;
