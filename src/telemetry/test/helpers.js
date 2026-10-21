// Utilidades de prueba de la telemetría: una base SQLite en archivo efímero, con WAL y las mismas
// `PRAGMA` que usa el núcleo (MASTER-SPEC §3), y la migración de `migration.sql` aplicada.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '.tmp');
export const MIGRATION_SQL = readFileSync(join(HERE, '..', 'migration.sql'), 'utf8');

// Mismos valores que el núcleo: busy_timeout 5.000 ms y synchronous=FULL (MASTER-SPEC §3).
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
        // ya estaba cerrada
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Los spans guardados, con sus atributos y eventos ya leídos. Los tiempos van como texto: un
 * entero de 64 bits de época en nanosegundos no cabe en un número de JavaScript y `node:sqlite`
 * lo rechaza con ERR_OUT_OF_RANGE si se lo pide con `SELECT *`.
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
