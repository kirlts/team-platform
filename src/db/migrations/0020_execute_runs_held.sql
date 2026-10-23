-- A delivery held for the review of a person (UD-266). Forward only.
--   execute_runs.delivery_held  1 when the delivery command exited with 76; such a run keeps delivered = 0 and the summaries count it
--                               apart from «delivered» and «failed». NULL = no delivery decided yet (or an older row).
ALTER TABLE execute_runs ADD COLUMN delivery_held INTEGER CHECK (delivery_held IN (0, 1));
