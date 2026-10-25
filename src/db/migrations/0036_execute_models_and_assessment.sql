-- The models of the unattended session per area, the Guards of an area, what the analyzer estimates about each message and the judgement of each job (UD-295). Forward only; the runner opens the transaction.
--   areas.execute_model          the larger model: the one the light model's work escalates to and the one of a message with no estimates; NULL reads as EXECUTE_MODEL (what every area ran with until now).
--   areas.execute_model_light    the light model: the one of a message whose estimates stay within the limits; NULL reads as EXECUTE_LIGHT_MODEL (Haiku 5.5).
--   areas.guards_json            the Guards of the area, `[{ id, text, mechanism, person }]`: the walls, each with the mechanism that holds it. The Editor writes them (a configured text).
--   messages.expectation         what the analyzer says is expected of Claude, in natural words; '' when nothing.
--   messages.guards_json         ids of the area's Guards that the message touches.
--   messages.estimates_json      `{ understand_vs_create, irreversibility, value_holder, certainty, reason }`; NULL for a message published before they existed.
--   messages.assessed_by         the person who changed the assessment by hand; NULL while it is the analyzer's.
--   jobs.model                   the model an `execute` job ran with, written when its session starts.
--   execute_judgments            the IMK judgement of a finished job: 4 axes, 12 KPI from -2 to +2 with quote and reason, by a cheap judge model.
ALTER TABLE areas ADD COLUMN execute_model TEXT;
ALTER TABLE areas ADD COLUMN execute_model_light TEXT;
ALTER TABLE areas ADD COLUMN guards_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE messages ADD COLUMN expectation TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN guards_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE messages ADD COLUMN estimates_json TEXT;
ALTER TABLE messages ADD COLUMN assessed_by INTEGER REFERENCES members (id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN model TEXT;

CREATE TABLE execute_judgments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL,
  message_id  INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  judge_model TEXT NOT NULL,
  worked_with TEXT,
  quadrant    TEXT,
  scores_json TEXT NOT NULL,
  summary     TEXT NOT NULL DEFAULT '',
  cost_usd    REAL,
  created_at  INTEGER NOT NULL,
  UNIQUE (job_id)
);
CREATE INDEX execute_judgments_message ON execute_judgments (message_id);
