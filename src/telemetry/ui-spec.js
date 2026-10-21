// Interface telemetry, the contract (UD-061, MASTER-SPEC §7.10 ter). Pure data: no I/O and no dependencies, so the
// route, the summary, the panel's tests and the privacy test read one and the same definition.
//
// What travels: counts, durations, screen identifiers and component identifiers. What never travels: the text of a
// person, the content of a message, a file name, a member id or an email. The guarantee is structural: every string
// that reaches `spans` comes from a closed list (`enum`) or from a pattern that cannot hold prose (an id of 16
// hexadecimal characters, a component name of lowercase letters and hyphens, a route template of lowercase segments
// and `:id`). There is no free-text field in any event, so there is nothing to sanitize afterwards.

/** Screens of the panel (panel/src/App.tsx). The panel's list must be equal to this one: `ui-telemetry.test.js` compares them. */
export const SCREENS = Object.freeze([
  'home', 'messages', 'message-detail', 'areas', 'connections', 'team', 'settings', 'login', 'not-found'
]);

/** Tasks the summary measures. */
export const TASKS = Object.freeze(['send_publish', 'reply', 'close']);
export const TASK_OUTCOMES = Object.freeze(['completed', 'abandoned', 'failed']);
export const ERROR_KINDS = Object.freeze(['js', 'promise', 'network', 'http', 'render']);

/** Attribute prefix of every span of the interface: the summary and the retention read `name LIKE 'ui.%'`. */
export const SPAN_PREFIX = 'ui.';

// Storage bound of a counter or a duration in a JSON attribute: the largest signed 32-bit integer. It is the size
// of the field, not an operating limit; the operating limits are the ones in `config.uiTelemetry`.
export const COUNTER_MAX = 2147483647;
// A layout-shift score (CLS) is a sum of unitless fractions; the browser reports no ceiling. 1000 is a storage
// bound far above any real page (the «poor» threshold of Core Web Vitals is 0.25, web.dev/articles/cls, report 09).
export const SCORE_MAX = 1000;

// A route template: lowercase segments joined by `/` and `:id` where an identifier was. 64 characters is the length of
// the longest route of the API with its `:id` segments, rounded up (src/api/routes).
export const ENDPOINT_PATTERN = '^(/[a-z][a-z0-9-]{0,31}|/:id){1,6}$';
export const ENDPOINT_MAX = 64;
export const SESSION_PATTERN = '^[0-9a-f]{16}$';

const int = (maximum = COUNTER_MAX) => ({ type: 'integer', minimum: 0, maximum });
const screen = { type: 'string', enum: SCREENS };

/** The fields every event carries: how long ago it ended (the client's clock is never trusted) and its kind. */
const base = (type) => ({ type: { type: 'string', const: type }, age_ms: int() });

const event = (type, required, properties) => ({
  type: 'object',
  additionalProperties: false,
  required: ['type', 'age_ms', ...required],
  properties: { ...base(type), ...properties }
});

/**
 * JSON Schema of one event, by kind. `maxDurationMs` is the longest span of time a duration may claim: the absolute
 * lifetime of a session, because nothing the interface measures can last longer than the session that measured it.
 */
export function eventSchemas ({ maxDurationMs }) {
  const duration = int(maxDurationMs);
  return {
    // A change of screen: how long the new one took to render, and where the person came from.
    navigation: event('navigation', ['screen', 'render_ms'], {
      screen, from: { oneOf: [screen, { type: 'null' }] }, render_ms: duration
    }),
    // What happened on a screen between entering and leaving it. `key_presses` and `pointer_presses` are counts of
    // events; no key is recorded, only that one was pressed.
    screen_usage: event('screen_usage', ['screen', 'dwell_ms', 'clicks', 'scroll_events', 'scroll_px', 'key_presses', 'pointer_presses', 'viewport_w', 'viewport_h'], {
      screen,
      dwell_ms: duration,
      clicks: int(),
      scroll_events: int(),
      scroll_px: int(),
      key_presses: int(),
      pointer_presses: int(),
      viewport_w: int(),
      viewport_h: int()
    }),
    // A task that ended: completed, abandoned (started and not finished) or failed. The stages belong to sending.
    task: event('task', ['task', 'outcome', 'duration_ms', 'clicks', 'scroll_events', 'scroll_px', 'key_presses', 'screens'], {
      task: { type: 'string', enum: TASKS },
      outcome: { type: 'string', enum: TASK_OUTCOMES },
      duration_ms: duration,
      clicks: int(),
      scroll_events: int(),
      scroll_px: int(),
      key_presses: int(),
      screens: int(),
      stage_feedback_ms: duration,
      stage_analysis_ms: duration,
      stage_publish_ms: duration,
      component: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' }
    }),
    // An error of the interface or of the network. `endpoint` is a route template, never an address with ids.
    error: event('error', ['kind', 'screen'], {
      kind: { type: 'string', enum: ERROR_KINDS },
      screen,
      status: int(599),
      endpoint: { type: 'string', maxLength: ENDPOINT_MAX, pattern: ENDPOINT_PATTERN },
      component: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' }
    }),
    // Experience of one screen: cumulative layout shift, long tasks, interaction latency and readiness.
    vitals: event('vitals', ['screen'], {
      screen,
      cls: { type: 'number', minimum: 0, maximum: SCORE_MAX },
      long_tasks: int(),
      long_task_ms: duration,
      inp_ms: duration,
      lcp_ms: duration,
      interactive_ms: duration
    })
  };
}

/** The body of `POST /telemetry/ui`. `maxEvents` is `config.uiTelemetry.maxEvents`. */
export function batchSchema ({ maxEvents, maxDurationMs }) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['session', 'events'],
    properties: {
      // Random per page load, kept in memory only: it groups the events of one visit and identifies no one.
      session: { type: 'string', pattern: SESSION_PATTERN },
      events: { type: 'array', minItems: 1, maxItems: maxEvents, items: { oneOf: Object.values(eventSchemas({ maxDurationMs })) } }
    }
  };
}

/** Attribute names of a span by event field: every field becomes `ui.<field>`, the kind goes in `ui.event`. */
export const attributeName = (field) => `${SPAN_PREFIX}${field}`;
