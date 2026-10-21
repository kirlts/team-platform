-- UD-120 and UD-121: provider connections, with the API key sealed at rest.
-- One row per provider the Editor configured from Configuración: a custom OpenAI-compatible one (name and base
-- address), or a known one (anthropic, groq-speech, deepseek, groq, openrouter, gemini) that got a key. The key is
-- stored only as `sealed_value` (AES-256-GCM, src/domain/vault.js) and its last four characters for display; the
-- environment variables remain the value a fresh installation starts with. Forward only; the runner opens the transaction.
-- `updated_at` changes with every write: the process that builds the providers compares it to know when to rebuild.

CREATE TABLE provider_connections (
  name TEXT PRIMARY KEY CHECK (name GLOB '[a-z0-9]*' AND length(name) BETWEEN 2 AND 40 AND name NOT GLOB '*[^a-z0-9-]*'),
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('anthropic', 'openai-compatible', 'groq-speech')),
  custom INTEGER NOT NULL DEFAULT 0 CHECK (custom IN (0, 1)),
  base_url TEXT,
  structured TEXT CHECK (structured IS NULL OR structured IN ('json_schema', 'tool', 'json_object')),
  sealed_value TEXT,
  last4 TEXT CHECK (last4 IS NULL OR length(last4) <= 4),
  key_updated_at INTEGER,
  check_at INTEGER,
  check_ok INTEGER CHECK (check_ok IS NULL OR check_ok IN (0, 1)),
  check_cause TEXT,
  check_ms INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
