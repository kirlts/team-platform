-- Esquema inicial de team-platform (MASTER-SPEC §7.2).
-- Las marcas de tiempo son enteros en milisegundos desde la época Unix (UTC); la API las expone en ISO 8601.
-- Las migraciones sólo avanzan: el ejecutor corre cada archivo dentro de una transacción y fija
-- PRAGMA user_version al número del archivo (informe 03 §6).
--
-- Columnas y tablas agregadas a §7.2, con su motivo:
--   jobs.input_id           permite saber a qué miembro pertenece el progreso sin leer payload_json.
--   job_events.kind/member_id/data_json
--                           un solo flujo con reposición por seq lleva progreso, fin de trabajo y avisos
--                           de mensajes (§7.10: «un flujo SSE por miembro»).
--   inputs.error/error_code motivo visible y código estable de un input fallido (§7.5).
--   attachments.name        nombre original, para mostrarlo y para elegir el extractor por extensión.
--   attachments.extract_*   metadatos de la extracción (`meta` del extractor).
--   credentials.failed_count/next_attempt_at
--                           espera exponencial por cuenta y tope duro (informe 04 §2.4).
--   sessions.created_at/last_seen_at
--                           vencimiento por inactividad (informe 04 §2.2).
--   settings, identity_links, sso_nonces
--                           proveedores configurables (§7.6), mapeo de identidad externa y nonce de uso
--                           único del modo sso-redirect (§7.7).

CREATE TABLE members (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  email            TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name             TEXT    NOT NULL,
  role             TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'editor')), -- UD-007
  responsibilities TEXT    NOT NULL DEFAULT '',
  domains          TEXT    NOT NULL DEFAULT '',
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
  id           TEXT    PRIMARY KEY, -- SHA-256 hexadecimal de la ficha; la ficha sólo vive en la cookie
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

CREATE TABLE areas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT    NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id       INTEGER NOT NULL REFERENCES areas (id) ON DELETE CASCADE, -- cada plantilla, de una sola área
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL,
  body_markdown TEXT    NOT NULL, -- el archivo completo, con su frontmatter (§7.9)
  updated_at    INTEGER NOT NULL
);
CREATE INDEX templates_area ON templates (area_id);

CREATE TABLE inputs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id    INTEGER NOT NULL REFERENCES members (id),
  text         TEXT    NOT NULL DEFAULT '',
  content_hash TEXT    NOT NULL UNIQUE, -- §1.3: mismo input, mismo trabajo
  status       TEXT    NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'extracting', 'analyzing', 'proposed', 'published', 'failed', 'cancelled')),
  error        TEXT,
  error_code   TEXT, -- código estable del fallo (p. ej. el de un ExtractError) para que el cliente lo muestre
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX inputs_author ON inputs (author_id, created_at DESC);

CREATE TABLE attachments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  input_id            INTEGER NOT NULL REFERENCES inputs (id) ON DELETE CASCADE,
  kind                TEXT    NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'document', 'link')),
  name                TEXT    NOT NULL DEFAULT '',
  path                TEXT    NOT NULL, -- nombre del archivo en el volumen (su sha256); para kind=link, la URL
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
-- §7.2: reclamo en 23 µs con este índice (informe 03).
CREATE INDEX jobs_claim ON jobs (status, priority DESC, run_at, id);
CREATE INDEX jobs_input ON jobs (input_id);

CREATE TABLE job_events (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT, -- id del evento SSE: Last-Event-ID (§7.10)
  job_id      INTEGER REFERENCES jobs (id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL CHECK (kind IN ('progress', 'done', 'message')),
  member_id   INTEGER REFERENCES members (id) ON DELETE CASCADE, -- destinatario; NULL = todo el equipo
  percent     INTEGER,
  phrase      TEXT,
  data_json   TEXT,
  at          INTEGER NOT NULL
);
CREATE INDEX job_events_job ON job_events (job_id, seq);
CREATE INDEX job_events_at ON job_events (at);

CREATE TABLE llm_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER REFERENCES jobs (id) ON DELETE SET NULL, -- el costo sobrevive a la retención del trabajo
  provider      TEXT    NOT NULL,
  model         TEXT    NOT NULL,
  modality      TEXT    NOT NULL CHECK (modality IN ('text', 'vision', 'speech')),
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cached_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL    NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  at            INTEGER NOT NULL
);
CREATE INDEX llm_calls_job ON llm_calls (job_id);

CREATE TABLE proposals (
  input_id      INTEGER PRIMARY KEY REFERENCES inputs (id) ON DELETE CASCADE, -- una propuesta por input
  area_id       INTEGER REFERENCES areas (id) ON DELETE SET NULL,
  template_id   INTEGER REFERENCES templates (id) ON DELETE SET NULL,
  payload_json  TEXT    NOT NULL,
  model_call_id INTEGER REFERENCES llm_calls (id) ON DELETE SET NULL,
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
  position      INTEGER NOT NULL DEFAULT 0, -- el primero es el adjunto principal de la tarjeta
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
