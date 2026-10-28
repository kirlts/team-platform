-- The Guards of the area that were on the table when a message was assessed (amendment of UD-313, 2026-10-27). Forward only.
--   Why: `messages.guards_json` says which Guards the analyzer found touched, and says nothing about the ones it was never asked about. A Guard installed in the area after
--   the message was assessed (the equipment adds a limit about money on Tuesday, the message was analyzed on Monday) was invisible to the delivery hold: `openPersonGuards` reads
--   `guards_json` and the new limit was not in it. With the ids the analyzer saw, the worker can tell which Guards a message was never judged against and judge only those, once,
--   when its job starts (`src/execute/guards-judge.js`), the same way the Guard of the idea is judged for a message that predates it (UD-307).
--   Written when the message is created (the ids of the Guards of its area at that moment: a draft that waited for its sender may have been analyzed a little earlier, so the
--   column can claim a Guard seen that the draft did not list; the window is the time between analysis and publication) and when a person sets the Guards by hand.
--   NULL: a message created before this migration; every Guard of its area counts as unseen and is judged once.
ALTER TABLE messages ADD COLUMN guards_seen_json TEXT;
