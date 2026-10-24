// Where the time of a message went (UD-262): reads the trace of its latest `execute` job and returns the figures the
// panel and `team timing` show. Times are milliseconds; `null` means the span or event does not exist (yet).
import { get } from '../db/index.js'
import { traceOfJob } from './trace.js'

const flatten = (nodes) => nodes.flatMap((n) => [n, ...flatten(n.children)])
const round = (ms) => (typeof ms === 'number' ? Math.round(ms) : null)
const eventMs = (node, name, key) => {
  const e = node?.events.find((x) => x.name === name)
  return e ? round(e.attributes?.[key]) : null
}

/** A tool or subagent span as a row. */
function toolRow(n) {
  return {
    kind: n.name === 'execute.subagent' ? 'subagent' : 'tool',
    name: n.attributes['gen_ai.tool.name'] ?? n.attributes['gen_ai.agent.name'] ?? n.name,
    summary: n.attributes['team.tool.summary'] ?? null,
    duration_ms: round(n.duration_ms),
    success: n.attributes['team.tool.success'] ?? null
  }
}

/** The technical part of the output of the latest run of a job (UD-276): [label, text] pairs and the reference of its delivery; `null` when the run returned none. */
function detailOfRun(db, jobId) {
  const run = get(db, 'SELECT detail_json, delivery_ref FROM execute_runs WHERE job_id = ? ORDER BY attempt DESC LIMIT 1', jobId);
  let entries = [];
  try { entries = JSON.parse(run?.detail_json ?? '[]'); } catch { /* a damaged cell shows no detail */ }
  entries = (Array.isArray(entries) ? entries : []).filter((e) => Array.isArray(e) && typeof e[0] === 'string').map(([label, value]) => ({ label, value: String(value ?? '') }));
  const deliveryRef = run?.delivery_ref ?? null;
  return entries.length || deliveryRef ? { entries, delivery_ref: deliveryRef } : null;
}

/**
 * @returns {null | object} `null` if the message has no `execute` job. With a job that left no spans (still running),
 * the figures come back `null` and `running` carries the phase.
 */
export function timingOfMessage(db, messageId, { now = Date.now } = {}) {
  const job = get(db, "SELECT * FROM jobs WHERE kind = 'execute' AND message_id = ? ORDER BY id DESC LIMIT 1", messageId);
  if (!job) return null;
  const base = {
    message_id: String(messageId), job_id: String(job.id), job_status: job.status, trace_id: job.trace_id ?? null,
    phase: job.phase ?? null, attempts: job.attempts,
    elapsed_ms: job.status === 'running' ? Math.max(0, now() - job.run_at) : null,
    first_reply_ms: null, final_reply_ms: null, first_reply_since_message_ms: null, final_reply_since_message_ms: null,
    total_ms: null, queue_wait_ms: null, phases: [], slowest: [], turns: [], tree: null,
    detail: detailOfRun(db, job.id)
  };
  // The delivery that follows the run (UD-263): while it waits or runs it is what the message is doing, and once it ends it is one more phase.
  const delivery = get(db, "SELECT * FROM jobs WHERE kind = 'deliver' AND message_id = ? AND id > ? ORDER BY id DESC LIMIT 1", messageId, job.id);
  if (delivery) {
    const live = delivery.status === 'queued' || delivery.status === 'running';
    base.deliver = { job_id: String(delivery.id), job_status: delivery.status, phase: delivery.phase ?? null, attempts: delivery.attempts };
    if (live) {
      Object.assign(base, { job_status: 'running', phase: delivery.phase ?? 'deliver', elapsed_ms: Math.max(0, now() - (delivery.status === 'running' ? delivery.run_at : delivery.created_at)) });
    }
  }
  const withDelivery = (timing) => {
    if (!delivery) return timing;
    const out = { ...timing };
    if (out.final_reply_ms === null) out.final_reply_ms = get(db, 'SELECT final_reply_ms FROM execute_runs WHERE job_id = ? ORDER BY attempt DESC LIMIT 1', job.id)?.final_reply_ms ?? null;
    if (delivery.finished_at && delivery.status !== 'cancelled') {
      out.phases = [...out.phases, { name: 'deliver', duration_ms: Math.max(0, delivery.finished_at - delivery.created_at), offset_ms: null, status: delivery.status === 'done' ? 'ok' : 'error' }];
    }
    return out;
  };
  const trace = traceOfJob(db, job.id);
  if (!trace) return withDelivery(base);
  const nodes = flatten(trace.roots);
  const attempts = nodes.filter((n) => n.name === 'job' && n.attributes['team.job_id'] === String(job.id));
  const jobSpan = attempts.sort((a, b) => a.attributes['team.attempt'] - b.attributes['team.attempt']).at(-1);
  if (!jobSpan) return withDelivery(base);
  const exec = jobSpan.children.find((c) => c.name === 'execute') ?? null;
  const inside = exec ? flatten(exec.children) : [];
  const phases = inside
    .filter((n) => /^execute\.(machine|local)\.(create|run|collect|destroy)$/.test(n.name))
    .map((n) => ({ name: n.name.split('.').at(-1), duration_ms: round(n.duration_ms), offset_ms: round(Number(BigInt(n.start_ns) - BigInt(jobSpan.start_ns)) / 1e6), status: n.status }));
  const slowest = inside.filter((n) => n.name === 'execute.tool' || n.name === 'execute.subagent').map(toolRow).sort((a, b) => b.duration_ms - a.duration_ms);
  const turns = flatten(exec ? [exec] : []).flatMap((n) => n.events.filter((e) => e.name === 'execute.turn')).map((e) => ({
    index: e.attributes['team.turn.index'], subagent: e.attributes['team.turn.subagent'],
    input_tokens: e.attributes['gen_ai.usage.input_tokens'], output_tokens: e.attributes['gen_ai.usage.output_tokens'],
    cache_read_tokens: e.attributes['gen_ai.usage.cache_read.input_tokens'] ?? 0, cost_usd: e.attributes['team.turn.cost_usd'] ?? null
  }));
  return withDelivery({
    ...base,
    first_reply_ms: eventMs(jobSpan, 'reply.start', 'team.ms_since_job_start'),
    final_reply_ms: eventMs(jobSpan, 'reply.final', 'team.ms_since_job_start'),
    first_reply_since_message_ms: eventMs(jobSpan, 'reply.start', 'team.ms_since_message'),
    final_reply_since_message_ms: eventMs(jobSpan, 'reply.final', 'team.ms_since_message'),
    total_ms: round(jobSpan.duration_ms),
    queue_wait_ms: round(exec?.attributes['team.queue_wait_ms']),
    phases, slowest, turns,
    tree: exec
  });
}
