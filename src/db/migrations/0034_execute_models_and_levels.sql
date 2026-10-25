-- The model of the unattended session per area and the level of each message (UD-292). Forward only; the runner opens the transaction.
--   areas.execute_model          the Claude model the area's sessions run with; NULL reads as EXECUTE_MODEL (what every area ran with until now).
--   areas.execute_model_direct   the model for the messages whose level is a direct fix; NULL reads as the area's model.
--   messages.bloom_level         remember | understand | apply | analyze | evaluate | create | decide, from the analyzer; NULL for a message published before it existed.
--   messages.bloom_by            the person who set the level by hand; NULL while it is the analyzer's.
--   jobs.model                   the model an `execute` job ran with, written when its session starts.
ALTER TABLE areas ADD COLUMN execute_model TEXT;
ALTER TABLE areas ADD COLUMN execute_model_direct TEXT;
ALTER TABLE messages ADD COLUMN bloom_level TEXT CHECK (bloom_level IN ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create', 'decide'));
ALTER TABLE messages ADD COLUMN bloom_by INTEGER REFERENCES members (id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN model TEXT;
