// Telemetry test utilities: a SQLite database in an ephemeral file, with WAL and the same
// `PRAGMA`s the core uses (MASTER-SPEC §3), and the `migration.sql` migration applied.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '.tmp');
export const MIGRATION_SQL = readFileSync(join(HERE, '..', 'migration.sql'), 'utf8');

// Same values as the core: busy_timeout 5,000 ms and synchronous=FULL (MASTER-SPEC §3).
const BUSY_TIMEOUT_MS = 5000;

export function makeDb(name = 'telemetria') {
  mkdirSync(ROOT, { recursive: true });
  const dir = mkdtempSync(join(ROOT, `${name}-`));
  const db = new DatabaseSync(join(dir, 'team.db'), { timeout: BUSY_TIMEOUT_MS });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec(MIGRATION_SQL);
  return {
    db,
    dir,
    cleanup() {
      try {
        db.close();
      } catch {
        // it was already closed
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * The stored spans, with their attributes and events already parsed. Times go as text: a
 * 64-bit epoch integer in nanoseconds does not fit in a JavaScript number and `node:sqlite`
 * rejects it with ERR_OUT_OF_RANGE if asked for with `SELECT *`.
 */
export function readSpans(db, where = '1 = 1', ...params) {
  return db
    .prepare(
      `SELECT trace_id, span_id, parent_id, name, kind, status, status_message, job_id, operation,
              CAST(start_ns AS TEXT) AS start_ns, CAST(end_ns AS TEXT) AS end_ns, attributes_json, events_json
         FROM spans WHERE ${where} ORDER BY start_ns, span_id`,
    )
    .all(...params)
    .map((r) => ({ ...r, attributes: JSON.parse(r.attributes_json), events: JSON.parse(r.events_json) }));
}
