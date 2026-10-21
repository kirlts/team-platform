-- Initial schema of team-platform (MASTER-SPEC §7.2).
-- Timestamps are integers in milliseconds since the Unix epoch (UTC); the API exposes them as ISO 8601.
-- Migrations only move forward: the runner runs each file inside a transaction and sets
-- PRAGMA user_version to the file's number (report 03 §6).
--
-- Columns and tables added to §7.2, with the reason:
--   jobs.input_id           makes it possible to know which member the progress belongs to without reading payload_json.
--   job_events.kind/member_id/data_json
--                           a single stream with replay by seq carries progress, job completion and message
--                           notices (§7.10: «one SSE stream per member»).
--   inputs.error/error_code visible reason and stable code of a failed input (§7.5).
--   attachments.name        original name, to display it and to choose the extractor by extension.
--   attachments.extract_*   extraction metadata (the extractor's `meta`).
--   credentials.failed_count/next_attempt_at
--                           exponential wait per account and hard cap (report 04 §2.4).
--   sessions.created_at/last_seen_at
--                           expiry by inactivity (report 04 §2.2).
--   audit_log               log queryable by the editor (GET /audit).
--   (llm_calls is no longer a table: it is a view over `spans`, see 0002_telemetry.sql, UD-014)
--   settings, identity_links, sso_nonces
--                           configurable providers (§7.6), external identity mapping and single-use nonce
--                           of the sso-redirect mode (§7.7).

CREATE TABLE members (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT    NOT NULL,
  role             TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'editor')), -- UD-007
  responsibilities TEXT    NOT NULL DEFAULT '',
  domains          TEXT    NOT NULL DEFAULT '[]', -- list of domains as JSON; the API exposes it as an array
  created_at       INTEGER NOT NULL
);

CREATE TABLE credentials (
  member_id       INTEGER PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  password_hash   TEXT    NOT NULL,
  updated_at      INTEGER NOT NULL,
  failed_count    INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id           TEXT    PRIMARY KEY, -- hexadecimal SHA-256 of the token; the token only lives in the cookie
  member_id    INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX sessions_member ON sessions (member_id);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE identity_links (
  provider    TEXT    NOT NULL,
  external_id TEXT    NOT NULL,
  member_id   INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (provider, external_id)
);

CREATE TABLE sso_nonces (
  nonce      TEXT    PRIMARY KEY,
  created_at INTEGER NOT NULL,
  used_at    INTEGER
);

-- Areas and templates are soft-deleted (`deleted_at`): the messages that reference them are not lost and can
-- be restored. Uniqueness applies only among the current ones.
CREATE TABLE areas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL COLLATE NOCASE,
  description TEXT    NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  deleted_at  INTEGER
);
CREATE UNIQUE INDEX areas_title_vigente ON areas (title) WHERE deleted_at IS NULL;

CREATE TABLE templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id       INTEGER NOT NULL REFERENCES areas (id) ON DELETE CASCADE, -- each template belongs to a single area
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL,
  body_markdown TEXT    NOT NULL, -- the complete file, with its frontmatter (§7.9)
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX templates_area ON templates (area_id);
CREATE UNIQUE INDEX templates_nombre_vigente ON templates (area_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE inputs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id    INTEGER NOT NULL REFERENCES members (id),
  text         TEXT    NOT NULL DEFAULT '',
  content_hash TEXT    NOT NULL UNIQUE, -- §1.3: same input, same job
  status       TEXT    NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'extracting', 'analyzing', 'proposed', 'published', 'failed', 'cancelled')),
  error        TEXT,
  error_code   TEXT, -- stable failure code (e.g. that of an ExtractError) for the client to display
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX inputs_author ON inputs (author_id, created_at DESC);

CREATE TABLE attachments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  input_id            INTEGER NOT NULL REFERENCES inputs (id) ON DELETE CASCADE,
  kind                TEXT    NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'document', 'link')),
  name                TEXT    NOT NULL DEFAULT '',
  path                TEXT    NOT NULL, -- file name in the volume (its sha256); for kind=link, the URL
  mime                TEXT    NOT NULL DEFAULT '',
  size                INTEGER NOT NULL DEFAULT 0,
  sha256              TEXT    NOT NULL,
  extracted_text      TEXT,
  extracted_at        INTEGER,
  extract_meta_json   TEXT
);
CREATE INDEX attachments_input ON attachments (input_id);

CREATE TABLE jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT    NOT NULL CHECK (kind IN ('extract', 'analyze')),
  input_id     INTEGER REFERENCES inputs (id) ON DELETE CASCADE,
  payload_json TEXT    NOT NULL DEFAULT '{}',
  status       TEXT    NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  priority     INTEGER NOT NULL DEFAULT 0,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_at       INTEGER NOT NULL,
  lease_until  INTEGER,
  worker_id    TEXT,
  last_error   TEXT,
  created_at   INTEGER NOT NULL,
  finished_at  INTEGER
);
-- §7.2: claim in 23 µs with this index (report 03).
CREATE INDEX jobs_claim ON jobs (status, priority DESC, run_at, id);
CREATE INDEX jobs_input ON jobs (input_id);

CREATE TABLE job_events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT, -- SSE event id: Last-Event-ID (§7.10)
  job_id      INTEGER REFERENCES jobs (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('progress', 'done', 'message')),
  member_id   INTEGER REFERENCES members (id) ON DELETE CASCADE, -- recipient; NULL = the whole team
  percent     INTEGER,
  phrase      TEXT,
  data_json   TEXT,
  at          INTEGER NOT NULL
);
CREATE INDEX job_events_job ON job_events (job_id, seq);
CREATE INDEX job_events_at ON job_events (at);

CREATE TABLE proposals (
  input_id      INTEGER PRIMARY KEY REFERENCES inputs (id) ON DELETE CASCADE, -- one proposal per input
  payload_json  TEXT    NOT NULL, -- { messages: [{ area_id, template_id, … }], discarded }: the area and the template belong to each message
  units_json    TEXT, -- the numbered units of the input ({ id, text }): what each message covers and what was discarded
  created_at    INTEGER NOT NULL
);

CREATE TABLE messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  input_id    INTEGER REFERENCES inputs (id) ON DELETE SET NULL,
  area_id     INTEGER NOT NULL REFERENCES areas (id),
  template_id INTEGER REFERENCES templates (id) ON DELETE SET NULL,
  author_id   INTEGER NOT NULL REFERENCES members (id),
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  fields_json TEXT    NOT NULL DEFAULT '{}',
  status      TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER
);
CREATE INDEX messages_created ON messages (created_at DESC, id DESC);
CREATE INDEX messages_area_status ON messages (area_id, status);
CREATE INDEX messages_author ON messages (author_id);

CREATE TABLE message_assignees (
  message_id INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  member_id  INTEGER NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, member_id)
);
CREATE INDEX message_assignees_member ON message_assignees (member_id);

CREATE TABLE message_attachments (
  message_id    INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  attachment_id INTEGER NOT NULL REFERENCES attachments (id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0, -- the first one is the card's main attachment
  PRIMARY KEY (message_id, attachment_id)
);
CREATE INDEX message_attachments_attachment ON message_attachments (attachment_id);

CREATE TABLE replies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES members (id),
  body       TEXT    NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'answer' CHECK (kind IN ('answer', 'fix', 'clarification')),
  created_at INTEGER NOT NULL
);
CREATE INDEX replies_message ON replies (message_id, id);

CREATE TABLE settings (
  key        TEXT    PRIMARY KEY,
  value_json TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Log of what the team changes: who created, published, closed, reopened or edited areas and templates, and when.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  member_id   INTEGER REFERENCES members (id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,
  entity      TEXT    NOT NULL,
  entity_id   INTEGER,
  detail_json TEXT
);
CREATE INDEX audit_log_at ON audit_log (at DESC, id DESC);
