-- The review of a held delivery (UD-275). Forward only.
--   execute_runs.delivery_hold_reason    the reason the delivery command printed with exit 76, one plain sentence (NULL when it was not held)
--   execute_runs.delivery_discarded_at   when a person discarded the held branch: it is never delivered and the review stops being pending
--   execute_runs.delivery_discarded_by   the person who discarded it
ALTER TABLE execute_runs ADD COLUMN delivery_hold_reason TEXT;
ALTER TABLE execute_runs ADD COLUMN delivery_discarded_at INTEGER;
ALTER TABLE execute_runs ADD COLUMN delivery_discarded_by INTEGER REFERENCES members (id);
