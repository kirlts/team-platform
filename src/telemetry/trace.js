// Lectura de los spans de un trabajo para `GET /jobs/:id/trace` y para el banco (MASTER-SPEC §7.10 bis).
//
// Un trabajo puede dejar más de un árbol: cada intento de la cola (§7.3) abre su propio trace. Se
// devuelven todos, uno por raíz. Los nanosegundos viajan como texto decimal porque un entero de
// 64 bits no cabe en un número de JavaScript sin perder precisión.
import { NS_PER_MS } from './config.js';

const SPAN_COLUMNS = `trace_id, span_id, parent_id, name, kind, status, status_message,
  CAST(start_ns AS TEXT) AS start_ns, CAST(end_ns AS TEXT) AS end_ns,
  start_ns / ${NS_PER_MS} AS start_ms, (end_ns - start_ns) / ${NS_PER_MS}.0 AS duration_ms,
  attributes_json, events_json`;

function toNode(row) {
  return {
    trace_id: row.trace_id,
    span_id: row.span_id,
    parent_id: row.parent_id,
    name: row.name,
    kind: row.kind,
    status: row.status,
    status_message: row.status_message,
    start_ns: row.start_ns,
    end_ns: row.end_ns,
    start_ms: row.start_ms,
    duration_ms: row.duration_ms,
    attributes: JSON.parse(row.attributes_json),
    events: JSON.parse(row.events_json),
    children: [],
  };
}

/**
 * El árbol de spans de un trabajo, o `null` si no hay ninguno.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string|number} jobId
 */
export function traceOfJob(db, jobId) {
  const traceIds = db
    .prepare('SELECT DISTINCT trace_id FROM spans WHERE job_id = ?')
    .all(String(jobId))
    .map((r) => r.trace_id);
  if (traceIds.length === 0) return null;
  const marks = traceIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT ${SPAN_COLUMNS} FROM spans WHERE trace_id IN (${marks}) ORDER BY start_ns, span_id`).all(...traceIds);
  const nodes = rows.map(toNode);
  const byId = new Map(nodes.map((n) => [`${n.trace_id}/${n.span_id}`, n]));
  const roots = [];
  for (const node of nodes) {
    const parent = node.parent_id ? byId.get(`${node.trace_id}/${node.parent_id}`) : null;
    // Sin padre guardado (raíz de verdad, o padre aún sin exportar) el nodo abre un árbol.
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS llm_calls, COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM llm_calls WHERE trace_id IN (${marks})`,
    )
    .get(...traceIds);
  return { job_id: String(jobId), trace_ids: traceIds, span_count: nodes.length, totals: { ...totals }, roots };
}
