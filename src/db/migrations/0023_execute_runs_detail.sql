-- The technical part of the structured output of a run (UD-273). Forward only.
--   execute_runs.detail_json  [label, text] pairs of everything the session returned besides its `summary` (result, zone, cause, verification,
--                             branch, files…), each with the label of the template. The reply shows only the summary; «Tiempos» shows these
--                             folded. NULL = a run that returned no output (or an older row).
ALTER TABLE execute_runs ADD COLUMN detail_json TEXT;
