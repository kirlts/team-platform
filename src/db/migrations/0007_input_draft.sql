-- A send can ask to stay as a draft (UD-072). Forward only; the runner opens the transaction.
--   inputs.keep_draft   1 when the sender asked, at creation, that this input is NOT published by itself: its
--                       proposal waits as `proposed` even with `auto_publish` on. 0 follows the project knob.
ALTER TABLE inputs ADD COLUMN keep_draft INTEGER NOT NULL DEFAULT 0 CHECK (keep_draft IN (0, 1));
