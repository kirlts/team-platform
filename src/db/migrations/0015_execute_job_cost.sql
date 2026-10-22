-- The daily spend cap of `execute` (UD-256): each job keeps what it cost and the runner that ran it, so the day's
-- spend is one query over `jobs` and does not depend on the trace, which can be off or pruned.
ALTER TABLE jobs ADD COLUMN cost_usd REAL;
ALTER TABLE jobs ADD COLUMN runner TEXT;
