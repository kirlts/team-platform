// Interface telemetry, the server side (UD-091, MASTER-SPEC §7.10 ter): turns the batches the panel sends into
// OpenTelemetry spans (they land in the `spans` table through the exporter that already exists) and reads them back
// as a summary. The contract of the events is `ui-spec.js`; here there is no schema, only what is done with it.
import { SpanKind, SpanStatusCode, TRACER_NAME } from './api.js';
import { trace } from '@opentelemetry/api';
import { ERROR_KINDS, SCREENS, SPAN_PREFIX, TASKS, TASK_OUTCOMES, attributeName } from './ui-spec.js';

const MS = 1000000n; // nanoseconds per millisecond: a unit conversion, not a choice

// The field that says how long the event lasted, by kind. The span starts that long before it ends.
const DURATION_FIELD = Object.freeze({ navigation: 'render_ms', screen_usage: 'dwell_ms', task: 'duration_ms' });

const spanName = (type) => `${SPAN_PREFIX}${type}`;

/**
 * Records a validated batch: one span per event, each its own root (a trace per event: the events of a visit are
 * grouped by `ui.session`, not by a parent, because a visit has no single operation that contains them).
 * Without the SDK the tracer is a no-op and nothing is stored, which is also what «telemetry off» looks like.
 * @returns {number} the events turned into spans
 */
export function recordUiBatch (batch, { now = Date.now(), tracer = trace.getTracer(TRACER_NAME) } = {}) {
  for (const ev of batch.events) {
    const end = now - ev.age_ms; // the client's clock is not read: only how long ago the event ended
    const start = end - (ev[DURATION_FIELD[ev.type]] ?? 0);
    const attributes = { [attributeName('event')]: ev.type, [attributeName('session')]: batch.session };
    for (const [field, value] of Object.entries(ev)) {
      if (field === 'type' || field === 'age_ms' || value === null || value === undefined) continue;
      attributes[attributeName(field)] = value;
    }
    const failed = ev.type === 'error' || (ev.type === 'task' && ev.outcome === 'failed');
    const span = tracer.startSpan(spanName(ev.type), { root: true, kind: SpanKind.INTERNAL, startTime: start, attributes });
    if (failed) {
      span.setAttribute('error.type', ev.type === 'error' ? ev.kind : 'task_failed');
      span.setStatus({ code: SpanStatusCode.ERROR }); // no message: nothing of free text is stored
    }
    span.end(end);
  }
  return batch.events.length;
}

// ---- Reading

/** Nearest-rank percentile of a list of numbers (no interpolation: every value shown was observed). */
export function percentile (values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const spread = (values) => ({ n: values.length, p50: percentile(values, 50), p75: percentile(values, 75), p95: percentile(values, 95) });
const round = (n, digits = 3) => (n === null ? null : Number(n.toFixed(digits)));

// Core Web Vitals thresholds, assessed at the 75th percentile (web.dev/articles/vitals, consulted 2026-10-21,
// report 09): good up to the first number, poor beyond the second.
export const VITALS_THRESHOLDS = Object.freeze({
  cls: { good: 0.1, poor: 0.25 },
  inp_ms: { good: 200, poor: 500 },
  lcp_ms: { good: 2500, poor: 4000 }
});

function rate (value, metric) {
  const t = VITALS_THRESHOLDS[metric];
  if (value === null) return null;
  if (value <= t.good) return 'good';
  return value <= t.poor ? 'needs-improvement' : 'poor';
}

// Width classes of the panel: the Tailwind 4 default breakpoints sm, md, lg, xl and 2xl in pixels
// (tailwindcss.com/docs/responsive-design, consulted 2026-10-21); the panel uses no custom ones.
const BREAKPOINTS = Object.freeze([['<640', 640], ['640-767', 768], ['768-1023', 1024], ['1024-1279', 1280], ['1280-1535', 1536], ['>=1536', Infinity]]);
const widthClass = (w) => BREAKPOINTS.find(([, upTo]) => w < upTo)[0];

const sum = (values) => values.reduce((a, b) => a + b, 0);

/**
 * The summary an active person reads (`GET /telemetry/ui-summary`). `sinceMs` and `untilMs` are Unix milliseconds.
 * The volume is bounded by retention (7 days) and by the ingestion limits, so every row is read; there is no sampling.
 */
export function uiSummary (db, { sinceMs, untilMs, worstJourneys = 10 }) {
  const rows = db.prepare(
    `SELECT name, attributes_json, CAST(start_ns / ${MS} AS INTEGER) AS at_ms
       FROM spans WHERE name LIKE ? AND start_ns >= ? AND start_ns < ? ORDER BY start_ns`
  ).all(`${SPAN_PREFIX}%`, BigInt(sinceMs) * MS, BigInt(untilMs) * MS);

  const events = rows.map((r) => ({ at_ms: r.at_ms, ...JSON.parse(r.attributes_json) }));
  const by = (type) => events.filter((e) => e[attributeName('event')] === type);
  const f = (e, field) => e[attributeName(field)];

  // ---- Screens
  const screens = {};
  for (const id of SCREENS) {
    const nav = by('navigation').filter((e) => f(e, 'screen') === id);
    const usage = by('screen_usage').filter((e) => f(e, 'screen') === id);
    const vit = by('vitals').filter((e) => f(e, 'screen') === id);
    const errs = by('error').filter((e) => f(e, 'screen') === id);
    if (nav.length + usage.length + vit.length + errs.length === 0) continue;
    const keys = sum(usage.map((e) => f(e, 'key_presses')));
    const pointers = sum(usage.map((e) => f(e, 'pointer_presses')));
    const metric = (field) => vit.map((e) => f(e, field)).filter((v) => v !== undefined);
    const cls = percentile(metric('cls'), 75);
    const inp = percentile(metric('inp_ms'), 75);
    const lcp = percentile(metric('lcp_ms'), 75);
    screens[id] = {
      visits: nav.length || usage.length,
      render_ms: spread(nav.map((e) => f(e, 'render_ms'))),
      dwell_ms: spread(usage.map((e) => f(e, 'dwell_ms'))),
      clicks_per_visit: spread(usage.map((e) => f(e, 'clicks'))),
      scroll_events_per_visit: spread(usage.map((e) => f(e, 'scroll_events'))),
      keyboard_share: keys + pointers === 0 ? null : round(keys / (keys + pointers)),
      vitals: {
        cls_p75: round(cls), cls_rating: rate(cls, 'cls'),
        inp_ms_p75: inp, inp_rating: rate(inp, 'inp_ms'),
        lcp_ms_p75: lcp, lcp_rating: rate(lcp, 'lcp_ms'),
        interactive_ms: spread(metric('interactive_ms')),
        long_tasks: sum(metric('long_tasks')),
        long_task_ms: sum(metric('long_task_ms'))
      },
      errors: errs.length,
      errors_per_100_visits: round((errs.length / Math.max(1, nav.length || usage.length)) * 100, 1)
    };
  }

  // ---- Tasks
  const taskEvents = by('task');
  const tasks = {};
  for (const id of TASKS) {
    const all = taskEvents.filter((e) => f(e, 'task') === id);
    if (all.length === 0) continue;
    const done = all.filter((e) => f(e, 'outcome') === 'completed');
    const count = (outcome) => all.filter((e) => f(e, 'outcome') === outcome).length;
    const of = (list, field) => list.map((e) => f(e, field)).filter((v) => v !== undefined);
    tasks[id] = {
      started: all.length,
      ...Object.fromEntries(TASK_OUTCOMES.map((o) => [o, count(o)])),
      abandon_rate: round(count('abandoned') / all.length),
      failure_rate: round(count('failed') / all.length),
      duration_ms: spread(of(done, 'duration_ms')),
      clicks: spread(of(done, 'clicks')),
      scroll_events: spread(of(done, 'scroll_events')),
      key_presses: spread(of(done, 'key_presses')),
      ...(id === 'send_publish'
        ? { stages_ms: { feedback: spread(of(done, 'stage_feedback_ms')), analysis: spread(of(done, 'stage_analysis_ms')), publish: spread(of(done, 'stage_publish_ms')) } }
        : {})
    };
  }

  // ---- Errors
  const errorEvents = by('error');
  const endpointCounts = new Map();
  for (const e of errorEvents) {
    const ep = f(e, 'endpoint');
    if (ep) endpointCounts.set(ep, (endpointCounts.get(ep) ?? 0) + 1);
  }
  const navTotal = by('navigation').length;
  const errors = {
    total: errorEvents.length,
    per_100_navigations: round((errorEvents.length / Math.max(1, navTotal)) * 100, 1),
    by_kind: Object.fromEntries(ERROR_KINDS.map((k) => [k, errorEvents.filter((e) => f(e, 'kind') === k).length]).filter(([, n]) => n > 0)),
    top_endpoints: [...endpointCounts].sort((a, b) => b[1] - a[1]).slice(0, worstJourneys).map(([endpoint, n]) => ({ endpoint, errors: n }))
  };

  // ---- Windows and input
  const usage = by('screen_usage');
  const keys = sum(usage.map((e) => f(e, 'key_presses')));
  const pointers = sum(usage.map((e) => f(e, 'pointer_presses')));
  const widths = new Map();
  for (const e of usage) widths.set(widthClass(f(e, 'viewport_w')), (widths.get(widthClass(f(e, 'viewport_w'))) ?? 0) + 1);

  // ---- The worst journeys: completed tasks that took the most clicks (ties: more scrolling, then more time).
  const worst = taskEvents
    .filter((e) => f(e, 'outcome') === 'completed')
    .sort((a, b) => f(b, 'clicks') - f(a, 'clicks') || f(b, 'scroll_events') - f(a, 'scroll_events') || f(b, 'duration_ms') - f(a, 'duration_ms'))
    .slice(0, worstJourneys)
    .map((e) => ({
      task: f(e, 'task'), clicks: f(e, 'clicks'), scroll_events: f(e, 'scroll_events'), key_presses: f(e, 'key_presses'),
      duration_ms: f(e, 'duration_ms'), screens: f(e, 'screens'), at: new Date(e.at_ms).toISOString(), session: f(e, 'session')
    }));

  return {
    window: { since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString() },
    sessions: new Set(events.map((e) => f(e, 'session'))).size,
    events: events.length,
    screens,
    tasks,
    errors,
    input: { keyboard_share: keys + pointers === 0 ? null : round(keys / (keys + pointers)), key_presses: keys, pointer_presses: pointers },
    viewports: BREAKPOINTS.map(([label]) => ({ width: label, visits: widths.get(label) ?? 0 })),
    worst_journeys: worst,
    thresholds: VITALS_THRESHOLDS
  };
}
