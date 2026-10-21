// UD-061: the panel reports how it is used (counts and durations), the Editor reads a summary, and no text of a
// person ever reaches the database. Telemetry is process-global, so one environment with the SDK serves the file.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all } from '../db/index.js'
import { percentile } from '../telemetry/ui.js'
import { ERROR_KINDS, MAX_EVENT_BYTES, SCREENS, TASKS, TASK_OUTCOMES } from '../telemetry/ui-spec.js'
import { addMember, login, makeEnv, postInput } from '../testing/helpers.js'

const SESSION = '0123456789abcdef'
const noIpLimit = { identity: { login: { ipMax: 1000 } } }

const EVENTS = {
  navigation: { type: 'navigation', age_ms: 10, screen: 'messages', from: 'home', render_ms: 120 },
  screen_usage: { type: 'screen_usage', age_ms: 10, screen: 'home', dwell_ms: 4000, clicks: 3, scroll_events: 5, scroll_px: 900, key_presses: 12, pointer_presses: 3, viewport_w: 1440, viewport_h: 900 },
  task: { type: 'task', age_ms: 10, task: 'send_publish', outcome: 'completed', duration_ms: 9000, clicks: 4, scroll_events: 2, scroll_px: 300, key_presses: 30, screens: 2, stage_feedback_ms: 80, stage_analysis_ms: 6000, stage_publish_ms: 400 },
  error: { type: 'error', age_ms: 10, kind: 'http', screen: 'home', status: 500, endpoint: '/inputs/:id/publish' },
  vitals: { type: 'vitals', age_ms: 10, screen: 'home', cls: 0.05, long_tasks: 2, long_task_ms: 180, inp_ms: 120, lcp_ms: 900, interactive_ms: 300 }
}

async function team (opts = {}) {
  const env = await makeEnv({ config: noIpLimit, ...opts })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana Pérez' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org') }
  env.api = (method, url, cookie, payload, headers = {}) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel', ...headers }, payload })
  return env
}

const send = (env, cookie, events, session = SESSION) => env.api('POST', '/telemetry/ui', cookie, { session, events })
const uiSpans = (env) => all(env.db, "SELECT name, attributes_json, status FROM spans WHERE name LIKE 'ui.%' ORDER BY start_ns").map((r) => ({ name: r.name, status: r.status, attrs: JSON.parse(r.attributes_json) }))

test('the contract: events become ui.* spans, errors are marked, and the summary computes what it promises', async () => {
  const env = await team({ telemetry: true })
  try {
    // Every kind of event is accepted (204) and stored as a span with ui.* attributes.
    const r = await send(env, env.c.ana, Object.values(EVENTS))
    assert.equal(r.statusCode, 204, r.body)
    await env.telemetry.flush()
    const spans = uiSpans(env)
    assert.deepEqual(spans.map((s) => s.name).sort(), ['ui.error', 'ui.navigation', 'ui.screen_usage', 'ui.task', 'ui.vitals'])
    const task = spans.find((s) => s.name === 'ui.task')
    assert.equal(task.attrs['ui.task'], 'send_publish')
    assert.equal(task.attrs['ui.stage_analysis_ms'], 6000)
    assert.equal(task.attrs['ui.session'], SESSION)
    assert.equal(spans.find((s) => s.name === 'ui.error').status, 'error')
    assert.equal(spans.find((s) => s.name === 'ui.error').attrs['error.type'], 'http')

    // A known set of tasks: the summary has to give back exactly its percentiles, rates and worst journeys.
    const tasks = [
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 40].map((clicks, i) => ({ ...EVENTS.task, clicks, duration_ms: 1000 * (i + 1), scroll_events: i })),
      { ...EVENTS.task, outcome: 'abandoned', clicks: 1, duration_ms: 500 },
      { ...EVENTS.task, outcome: 'failed', clicks: 1, duration_ms: 700 },
      { ...EVENTS.task, task: 'reply', clicks: 2, duration_ms: 2000 }
    ]
    assert.equal((await send(env, env.c.ana, tasks.slice(0, 7), 'aaaaaaaaaaaaaaaa')).statusCode, 204)
    assert.equal((await send(env, env.c.ana, tasks.slice(7), 'bbbbbbbbbbbbbbbb')).statusCode, 204)

    assert.equal((await env.api('GET', '/telemetry/ui-summary', env.c.ana)).statusCode, 403) // Editor only
    const sum = (await env.api('GET', '/telemetry/ui-summary', env.c.ed)).json()
    const sp = sum.tasks.send_publish
    assert.equal(sp.started, 1 + 10 + 2) // the first batch had one, plus ten completed, one abandoned and one failed
    assert.equal(sp.completed, 11)
    assert.equal(sp.abandoned, 1)
    assert.equal(sp.failed, 1)
    assert.equal(sp.abandon_rate, Number((1 / 13).toFixed(3)))
    const clicks = [4, 2, 3, 4, 5, 6, 7, 8, 9, 10, 40]
    assert.equal(sp.clicks.p50, percentile(clicks, 50))
    assert.equal(sp.clicks.p95, percentile(clicks, 95))
    assert.equal(sp.clicks.p95, 40)
    assert.equal(sum.worst_journeys.length, 10)
    assert.equal(sum.worst_journeys[0].clicks, 40)
    assert.ok(sum.worst_journeys.every((w, i, a) => i === 0 || a[i - 1].clicks >= w.clicks))
    assert.deepEqual(sp.stages_ms.analysis.p50, 6000)
    assert.equal(sum.tasks.reply.started, 1)
    assert.equal(sum.screens.home.vitals.cls_rating, 'good')
    assert.equal(sum.screens.home.vitals.inp_rating, 'good')
    assert.equal(sum.screens.home.keyboard_share, Number((12 / 15).toFixed(3)))
    assert.equal(sum.errors.by_kind.http, 1)
    assert.deepEqual(sum.errors.top_endpoints, [{ endpoint: '/inputs/:id/publish', errors: 1 }])
    assert.equal(sum.sessions, 3)
    assert.equal(sum.viewports.find((v) => v.width === '>=1536').visits, 0) // 1440 falls in 1280-1535
    assert.equal(sum.viewports.find((v) => v.width === '1280-1535').visits, 1)
  } finally { await env.close() }
})

test('the shape is validated strictly: nothing but the declared fields, with the declared types', async () => {
  const env = await team()
  try {
    const bad = {
      'unknown event kind': [{ type: 'keystrokes', age_ms: 1 }],
      'extra field with text': [{ ...EVENTS.navigation, label: 'Enviar a Ana' }],
      'free text in a screen': [{ ...EVENTS.navigation, screen: 'Mensajes de Ana' }],
      'a number as text': [{ ...EVENTS.navigation, render_ms: '120' }],
      'a negative duration': [{ ...EVENTS.navigation, render_ms: -1 }],
      'a duration longer than a session': [{ ...EVENTS.navigation, render_ms: 9 * 3600000 }],
      'an endpoint with an id': [{ ...EVENTS.error, endpoint: '/messages/1234/replies' }],
      'an endpoint with prose': [{ ...EVENTS.error, endpoint: '/Hola Ana' }],
      'an error kind off the list': [{ ...EVENTS.error, kind: 'Se cayó el botón' }],
      'a component with spaces': [{ ...EVENTS.task, component: 'Enviar mensaje' }],
      'no events': []
    }
    for (const [name, events] of Object.entries(bad)) {
      const r = await send(env, env.c.ana, events)
      assert.equal(r.statusCode, 400, `${name}: ${r.statusCode} ${r.body}`)
    }
    const badSessions = ['', 'ana@x.org', 'ABCDEF0123456789', '0123456789abcdef0']
    for (const s of badSessions) assert.equal((await send(env, env.c.ana, [EVENTS.navigation], s)).statusCode, 400, `session ${s}`)
    // The batch is capped.
    const many = Array.from({ length: env.config.uiTelemetry.maxEvents + 1 }, () => EVENTS.navigation)
    assert.equal((await send(env, env.c.ana, many)).statusCode, 400)
    assert.equal((await send(env, env.c.ana, many.slice(1))).statusCode, 204)
    // So is the body.
    const big = Array.from({ length: env.config.uiTelemetry.maxEvents }, () => ({ ...EVENTS.screen_usage }))
    const filler = { session: SESSION, events: big, note: 'x'.repeat(env.config.uiTelemetry.maxBodyBytes) }
    assert.equal((await env.api('POST', '/telemetry/ui', env.c.ana, filler)).statusCode, 413)
    // A session is required, and the CSRF header too.
    assert.equal((await env.app.inject({ method: 'POST', url: '/api/telemetry/ui', payload: { session: SESSION, events: [EVENTS.navigation] } })).statusCode, 401)
    assert.equal((await env.app.inject({ method: 'POST', url: '/api/telemetry/ui', headers: { cookie: env.c.ana }, payload: { session: SESSION, events: [EVENTS.navigation] } })).statusCode, 403)
  } finally { await env.close() }
})

test('the frequency is capped per address', async () => {
  const env = await team({ config: { ...noIpLimit, uiTelemetry: { rateMax: 3 } } })
  try {
    const codes = []
    for (let i = 0; i < 5; i++) codes.push((await send(env, env.c.ana, [EVENTS.navigation])).statusCode)
    assert.deepEqual(codes, [204, 204, 204, 429, 429])
  } finally { await env.close() }
})

test('privacy: after using the system with names and texts, no span of the interface holds any of them', async () => {
  const env = await team({ telemetry: true })
  try {
    const sentinel = 'SENTINELA-texto-privado-9917'
    await postInput(env, env.c.ana, { text: `${sentinel} Ana Pérez ana@x.org` })
    // Everything the interface can send, at its largest.
    await send(env, env.c.ana, Object.values(EVENTS))
    await send(env, env.c.ed, Object.values(EVENTS), 'fedcba9876543210')
    await env.telemetry.flush()
    const spans = uiSpans(env)
    assert.ok(spans.length >= 10)
    const dump = JSON.stringify(spans)
    for (const forbidden of [sentinel, 'Ana', 'Pérez', 'ana@x.org', 'ed@x.org', 'Ed', '.txt', '.png']) {
      assert.ok(!dump.includes(forbidden), `the spans of the interface hold «${forbidden}»`)
    }
    // Every attribute is a number or a string from a closed vocabulary: there is no place where prose fits.
    const allowed = new Set([...SCREENS, ...TASKS, ...TASK_OUTCOMES, ...ERROR_KINDS, 'navigation', 'screen_usage', 'task', 'error', 'vitals', 'task_failed', SESSION, 'fedcba9876543210'])
    for (const s of spans) {
      for (const [key, value] of Object.entries(s.attrs)) {
        assert.ok(key.startsWith('ui.') || key === 'error.type', `unexpected attribute ${key}`)
        if (typeof value === 'string') assert.ok(allowed.has(value) || /^\/[a-z:/-]+$/.test(value), `${key} holds a string out of the vocabulary: ${value}`)
        else assert.equal(typeof value, 'number', key)
      }
    }
    // No member is recorded: not on the span and not on a column.
    assert.ok(all(env.db, "SELECT attributes_json FROM spans WHERE name LIKE 'ui.%'").every((r) => !/member|email|name/i.test(Object.keys(JSON.parse(r.attributes_json)).join())))
  } finally { await env.close() }
})

test('the switch: with telemetry off the batch is answered and discarded, and only the Editor moves the switch', async () => {
  const env = await team({ telemetry: true })
  try {
    assert.equal((await env.api('GET', '/me', env.c.ana)).json().ui_telemetry.enabled, true)
    assert.equal((await env.api('PATCH', '/settings/telemetry', env.c.ana, { ui_enabled: false })).statusCode, 403)
    const off = await env.api('PATCH', '/settings/telemetry', env.c.ed, { ui_enabled: false })
    assert.deepEqual(off.json(), { ui_enabled: false })
    assert.equal((await env.api('GET', '/me', env.c.ana)).json().ui_telemetry.enabled, false)
    assert.equal((await send(env, env.c.ana, [EVENTS.navigation])).statusCode, 204)
    await env.telemetry.flush()
    assert.equal(uiSpans(env).length, 0)
    await env.api('PATCH', '/settings/telemetry', env.c.ed, { ui_enabled: true })
    await send(env, env.c.ana, [EVENTS.navigation])
    await env.telemetry.flush()
    assert.equal(uiSpans(env).length, 1)
    assert.ok(all(env.db, "SELECT 1 FROM audit_log WHERE action = 'settings.telemetry'").length >= 2)
  } finally { await env.close() }
})

test('the OpenAPI contract documents the three routes and the event kinds', async () => {
  const env = await team()
  try {
    const doc = (await env.app.inject({ url: '/api/openapi.json' })).json()
    assert.ok(doc.paths['/api/telemetry/ui'].post)
    assert.ok(doc.paths['/api/telemetry/ui-summary'].get)
    assert.ok(doc.paths['/api/settings/telemetry'].patch)
    const body = doc.paths['/api/telemetry/ui'].post.requestBody.content['application/json'].schema
    assert.equal(body.additionalProperties, false)
    assert.equal(body.properties.events.items.oneOf.length, 5)
  } finally { await env.close() }
})

test('the batch limit derives from the longest possible event, and a full batch of them is accepted', async () => {
  const env = await team()
  try {
    const big = 2147483647
    const sessionMs = env.config.identity.session.absoluteHours * 3600000
    const longest = {
      navigation: { type: 'navigation', age_ms: big, screen: 'message-detail', from: 'message-detail', render_ms: sessionMs },
      screen_usage: { ...EVENTS.screen_usage, age_ms: big, screen: 'message-detail', dwell_ms: sessionMs, clicks: big, scroll_events: big, scroll_px: big, key_presses: big, pointer_presses: big, viewport_w: big, viewport_h: big },
      task: { type: 'task', age_ms: big, task: 'send_publish', outcome: 'abandoned', duration_ms: sessionMs, clicks: big, scroll_events: big, scroll_px: big, key_presses: big, screens: big, stage_feedback_ms: sessionMs, stage_analysis_ms: sessionMs, stage_publish_ms: sessionMs, component: 'a'.repeat(40) },
      error: { type: 'error', age_ms: big, kind: 'promise', screen: 'message-detail', status: 599, endpoint: '/' + Array.from({ length: 6 }, () => 'a'.repeat(9)).join('/'), component: 'a'.repeat(40) },
      vitals: { type: 'vitals', age_ms: big, screen: 'message-detail', cls: 999.9999, long_tasks: big, long_task_ms: sessionMs, inp_ms: sessionMs, lcp_ms: sessionMs, interactive_ms: sessionMs }
    }
    const sizes = Object.fromEntries(Object.entries(longest).map(([k, e]) => [k, JSON.stringify(e).length]))
    const max = Math.max(...Object.values(sizes))
    assert.ok(max <= MAX_EVENT_BYTES, `an event can weigh ${max} bytes and MAX_EVENT_BYTES says ${MAX_EVENT_BYTES}: ${JSON.stringify(sizes)}`)
    assert.ok(MAX_EVENT_BYTES - max < 16, 'MAX_EVENT_BYTES must stay close to the measured longest event')
    const { maxEvents, maxBodyBytes } = env.config.uiTelemetry
    const body = { session: SESSION, events: Array.from({ length: maxEvents }, () => longest.task) }
    assert.ok(JSON.stringify(body).length <= maxBodyBytes * 0.8, 'a full batch of the longest events uses at most 80 % of the body')
    assert.equal((await env.api('POST', '/telemetry/ui', env.c.ana, body)).statusCode, 204)
  } finally { await env.close() }
})
