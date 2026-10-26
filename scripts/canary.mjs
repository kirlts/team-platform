// The canary of an unattended session: a real message to an agent member, through the whole path, and a green exit only when the agent answers «OK».
//
//   TEAM_URL=https://team.example.org TEAM_EMAIL=… TEAM_PASSWORD=… CANARY_AREA="Canary" node scripts/canary.mjs
//
// The path (every wait is on the event stream, GET /api/events; the only clock is the deadline of each leg):
//   identity -> agent -> area -> send (POST /inputs, auto_publish=false, the agent as recipient) -> analysis (event `done` of the input)
//   -> publish in the declared area (POST /inputs/:id/publish) -> `execute` job (events `progress` and `done` of the message) -> reply in the thread.
// It exists because tests with doubles do not see a machine without a tool, a delivery that answers 127 or a session that never starts: only a
// session that runs for real does. It spends one session of the agent (a few cents with a light model); the host decides when to run it
// (after a deploy that touches the execute chain is the usual place).
//
// Exit 0: the agent replied with «OK» in the thread. Exit 3: red, and the last line of stderr names the leg where it stopped. Exit 2: bad usage.
// The test message is always closed; on green it is deleted too when CANARY_DELETE=1 (trash, restorable); on red it stays closed for diagnosis.
//
// Settings (environment):
//   TEAM_URL                  base address of the instance, no trailing slash (required)
//   TEAM_EMAIL, TEAM_PASSWORD login of a person with the editor role           } one of the two identities
//   CANARY_DELEGATED_SECRET   with CANARY_USER_EMAIL: identity by signed header (DELEGATED_MODE=signed-header; role editor) }
//   CANARY_AREA               title or id of the area that receives the message (required; the host creates it: it chooses its profile and model)
//   CANARY_AGENT              email or name of the agent member (default: the only active agent; several without this setting is a usage error)
//   CANARY_ANALYSIS_TIMEOUT_MS  deadline of the analysis leg (default QUEUE_MAX_RUNTIME_MS, or 900000, the cap of any job: src/config.js)
//   CANARY_SESSION_TIMEOUT_MS   deadline of the session leg (default EXECUTE_TIMEOUT_MS, or 3600000, the cap of an `execute` job: src/config.js)
//   CANARY_MAX_COST_USD       optional: red when the session costs more (the cost of the run is the host's to declare; there is no default)
//   CANARY_STATE              optional: file where the result is written as one line of JSON (what a watcher reads)
//   CANARY_DELETE             `1` deletes the message after a green run
import { createHmac } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RED = 3
export const USAGE = 2
export const DEFAULT_ANALYSIS_TIMEOUT_MS = 900_000 // QUEUE_MAX_RUNTIME_MS of src/config.js: no analysis outlives its job
export const DEFAULT_SESSION_TIMEOUT_MS = 3_600_000 // EXECUTE_TIMEOUT_MS of src/config.js: no session outlives its job

/** A failure of one leg of the path. `leg` is what the exit message names. */
export class Red extends Error {
  constructor (leg, cause, extra = {}) { super(`${leg}: ${cause}`); this.leg = leg; this.cause_ = cause; this.extra = extra }
}

/** The signature of the delegated identity (src/identity/delegated.js `signHeader`, with the request bound): one per call, it covers method and path. */
const sign = (secret, { ts, method, pathname, email, role, name }) =>
  createHmac('sha256', secret).update(`${ts}.${method}.${pathname}.${email}\n${role}\n${name}`).digest('hex')

/** The API client. `identity` is { email, password } or { secret, email }. */
export function createClient ({ base, identity, fetchFn = fetch, now = Date.now }) {
  let cookie = null
  const headersFor = async (method, pathname, extra) => {
    if (identity.secret) {
      const role = 'editor'
      const name = encodeURIComponent('Canary')
      const ts = Math.floor(now() / 1000)
      return { 'x-team-user': identity.email, 'x-team-ts': String(ts), 'x-team-role': role, 'x-team-name': name, 'x-team-sig': sign(identity.secret, { ts, method, pathname, email: identity.email, role, name }), ...extra }
    }
    if (!cookie) {
      const r = await fetchFn(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: identity.email, password: identity.password }) })
      if (!r.ok) throw new Red('identity', `login answered ${r.status}`)
      cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    }
    return { cookie, 'x-team-request': 'panel', ...extra }
  }
  const request = async (method, path, body, { signal } = {}) => {
    const pathname = `/api${path.split('?')[0]}`
    return fetchFn(`${base}/api${path}`, {
      method, signal,
      headers: await headersFor(method, pathname, body === undefined ? {} : { 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  }
  const json = async (method, path, body, leg) => {
    let r
    try { r = await request(method, path, body) } catch (e) { if (e instanceof Red) throw e; throw new Red(leg, `the API did not answer: ${e.message}`) }
    const text = await r.text()
    if (!r.ok) throw new Red(leg, `${method} /api${path} answered ${r.status}: ${text.slice(0, 200)}`)
    return text === '' ? null : JSON.parse(text)
  }
  return { request, json }
}

/** Reads the event stream and hands every event to `onEvent(kind, data)`; returns when it closes or aborts. */
async function readEvents (response, onEvent) {
  const decoder = new TextDecoder()
  let rest = ''
  for await (const chunk of response.body) {
    rest += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    let cut
    while ((cut = /\r?\n\r?\n/.exec(rest)) !== null) {
      const block = rest.slice(0, cut.index)
      rest = rest.slice(cut.index + cut[0].length)
      let kind = 'message'
      const data = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) kind = line.slice(6).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
      }
      if (data.length === 0) continue
      try { onEvent(kind, JSON.parse(data.join('\n'))) } catch { /* a comment or a line that is not JSON */ }
    }
  }
}

/**
 * Runs the path. Resolves { ok: true, ... } or throws `Red`. `deadlines` ({ analysis, session }) narrows the waits in tests.
 */
export async function runCanary ({ base, identity, area: areaRef, agent: agentRef = null, fetchFn = fetch, now = Date.now, deadlines = {}, log = () => {}, maxCostUsd = null, text = null }) {
  const analysisMs = deadlines.analysis ?? DEFAULT_ANALYSIS_TIMEOUT_MS
  const sessionMs = deadlines.session ?? DEFAULT_SESSION_TIMEOUT_MS
  const api = createClient({ base, identity, fetchFn, now })
  const t0 = now()
  const marks = {}
  let leg = 'identity'
  const enter = (name) => { leg = name; log(`-> ${name}`) }

  enter('identity')
  await api.json('GET', '/me', undefined, leg)

  enter('agent')
  const members = await api.json('GET', '/members', undefined, leg)
  const list = Array.isArray(members) ? members : (members?.items ?? [])
  const agents = list.filter((m) => m.kind === 'agent' && m.active !== false)
  const wanted = agentRef === null ? null : String(agentRef).toLowerCase()
  const candidates = wanted === null ? agents : agents.filter((m) => String(m.email).toLowerCase() === wanted || String(m.name).toLowerCase() === wanted || String(m.id) === wanted)
  if (candidates.length === 0) throw new Red(leg, wanted === null ? 'the team has no active agent member' : `no active agent member matches «${agentRef}»`)
  if (candidates.length > 1) throw new Red(leg, `${candidates.length} active agents and CANARY_AGENT does not say which one`)
  const agentMember = candidates[0]

  enter('area')
  const areas = await api.json('GET', '/areas', undefined, leg)
  const area = (Array.isArray(areas) ? areas : (areas?.items ?? [])).find((a) => a.title === areaRef || String(a.id) === String(areaRef))
  if (!area) throw new Red(leg, `no area titled or numbered «${areaRef}»`)

  // The stream is opened before anything is sent: an event that arrives before the send is never confused with one after it.
  const abort = new AbortController()
  const events = []
  const waiting = new Set()
  let stream
  try { stream = await api.request('GET', '/events', undefined, { signal: abort.signal }) } catch (e) { throw new Red('events', `the event stream did not open: ${e.message}`) }
  if (!stream.ok) throw new Red('events', `GET /api/events answered ${stream.status}`)
  const reading = readEvents(stream, (kind, data) => { events.push({ kind, data, at: now() }); for (const check of [...waiting]) check() }).catch(() => {})

  const waitFor = (name, ms, find) => new Promise((resolve, reject) => {
    const check = () => { const hit = find(); if (hit) { clear(); resolve(hit) } }
    const timer = setTimeout(() => { clear(); reject(new Red(name, `no answer in ${Math.round(ms / 1000)} s`)) }, ms)
    const clear = () => { clearTimeout(timer); waiting.delete(check) }
    waiting.add(check)
    check()
  })

  let messageId = null
  try {
    enter('send')
    const body = text ?? `Deploy canary (${new Date(now()).toISOString()}). Reply OK and the time. Change no code, open no branches, deliver nothing.`
    const sent = await api.json('POST', '/inputs', { text: body, auto_publish: false, recipient_ids: [Number(agentMember.id)] }, leg)
    const inputId = String(sent.input_id)

    enter('analysis')
    const analysis = await waitFor(leg, analysisMs, () => events.find((e) => e.kind === 'done' && String(e.data.input_id) === inputId))
    if (analysis.data.error || analysis.data.status === 'failed') throw new Red(leg, `the analysis failed (${analysis.data.error_code ?? analysis.data.error ?? 'no code'})`)
    marks.analysis_ms = analysis.at - t0

    enter('publish')
    const input = await api.json('GET', `/inputs/${inputId}`, undefined, leg)
    const units = (input.units ?? []).map((u) => Number(u.id))
    // What the analyzer judged about the message (level, irreversibility, the idea guard) travels as it is: without it the job asks for that judgement
    // apart, the path of a message older than the guard. Only the area, the title, the text and the assignee change.
    const { guards_touched: _guards, fields: _fields, attachment_ids: _attachments, ...judgement } = (input.proposal?.messages ?? [])[0] ?? {}
    const published = await api.json('POST', `/inputs/${inputId}/publish`, { messages: [{ ...judgement, area_id: Number(area.id), template_id: null, title: 'Canary', body, assignee_ids: [Number(agentMember.id)], unit_ids: units }] }, leg)
    messageId = String(published.message_ids[0])
    const publishedAt = now()

    enter('session')
    const ofMessage = (e) => String(e.data.message_id ?? '') === messageId
    const lastPhrase = () => { const p = events.filter((e) => e.kind === 'progress' && ofMessage(e)).at(-1); return p ? String(p.data.phrase ?? '') : null }
    let finished
    try {
      finished = await waitFor(leg, sessionMs, () => events.find((e) => e.kind === 'done' && ofMessage(e)))
    } catch (e) {
      if (e instanceof Red) throw new Red(leg, `no answer in ${Math.round(sessionMs / 1000)} s; ${lastPhrase() ? `the last notice of the job was «${lastPhrase()}»` : 'the job gave no notice'}`)
      throw e
    }
    marks.session_ms = finished.at - publishedAt
    if (finished.data.status === 'failed') throw new Red(leg, `the job failed (${finished.data.error_code ?? finished.data.error ?? 'no code'}); last notice «${lastPhrase() ?? 'none'}»`)
    const cost = Number(finished.data.cost_usd ?? 0)

    enter('reply')
    const message = await api.json('GET', `/messages/${messageId}`, undefined, leg)
    const reply = (message.replies ?? []).filter((r) => String(r.author_id) === String(agentMember.id)).at(-1)
    if (!reply) throw new Red(leg, 'the job ended but the agent left no reply in the thread')
    if (!/\bOK\b/i.test(String(reply.body ?? ''))) throw new Red(leg, `the agent's reply does not say OK: «${String(reply.body).slice(0, 120)}»`)
    if (maxCostUsd !== null && cost > maxCostUsd) throw new Red('cost', `the run cost ${cost} USD and the declared maximum is ${maxCostUsd}`, { cost_usd: cost })

    return { ok: true, message_id: messageId, cost_usd: cost, ...marks, total_ms: now() - t0, session_id: finished.data.session_id ?? null }
  } catch (e) {
    const red = e instanceof Red ? e : new Red(leg, `unexpected error: ${e.message}`)
    red.extra = { ...red.extra, message_id: messageId }
    throw red
  } finally {
    abort.abort()
    await reading
    if (messageId) {
      try {
        const m = await api.json('GET', `/messages/${messageId}`, undefined, 'cleanup')
        if (m.status !== 'closed') await api.json('POST', `/messages/${messageId}/close`, undefined, 'cleanup')
      } catch (e) { log(`the test message ${messageId} could not be closed: ${e.message}`) }
    }
  }
}

const save = (file, state) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(state)}\n`) }

/** The command line: reads the environment, runs the path, prints one line, returns the exit code. */
export async function main (env = process.env, { fetchFn = fetch, now = Date.now, out = console.log, err = console.error, deadlines = null } = {}) {
  const base = String(env.TEAM_URL ?? '').replace(/\/$/, '')
  const identity = env.CANARY_DELEGATED_SECRET
    ? { secret: env.CANARY_DELEGATED_SECRET, email: env.CANARY_USER_EMAIL }
    : { email: env.TEAM_EMAIL, password: env.TEAM_PASSWORD }
  if (!base || !env.CANARY_AREA || !identity.email || !(identity.secret || identity.password)) {
    err('usage: TEAM_URL=… CANARY_AREA=… (TEAM_EMAIL=… TEAM_PASSWORD=… | CANARY_DELEGATED_SECRET=… CANARY_USER_EMAIL=…) node scripts/canary.mjs')
    return USAGE
  }
  const at = now()
  const number = (name, fallback) => { const v = env[name]; return v === undefined || v === '' ? fallback : Number(v) }
  const bad = ['CANARY_ANALYSIS_TIMEOUT_MS', 'CANARY_SESSION_TIMEOUT_MS', 'CANARY_MAX_COST_USD'].find((n) => env[n] !== undefined && env[n] !== '' && !(Number(env[n]) > 0))
  if (bad) { err(`${bad} must be a number greater than 0`); return USAGE }
  const limits = deadlines ?? {
    analysis: number('CANARY_ANALYSIS_TIMEOUT_MS', number('QUEUE_MAX_RUNTIME_MS', DEFAULT_ANALYSIS_TIMEOUT_MS)),
    session: number('CANARY_SESSION_TIMEOUT_MS', number('EXECUTE_TIMEOUT_MS', DEFAULT_SESSION_TIMEOUT_MS))
  }
  try {
    const r = await runCanary({ base, identity, area: env.CANARY_AREA, agent: env.CANARY_AGENT ?? null, fetchFn, now, deadlines: limits, log: (l) => err(l), maxCostUsd: number('CANARY_MAX_COST_USD', null) })
    if (env.CANARY_DELETE === '1') {
      const api = createClient({ base, identity, fetchFn, now })
      try { await api.json('DELETE', `/messages/${r.message_id}?confirm=true`, undefined, 'cleanup') } catch (e) { err(`the test message ${r.message_id} could not be deleted: ${e.message}`) }
    }
    if (env.CANARY_STATE) save(env.CANARY_STATE, { ...r, at })
    out(`CANARY OK: the agent replied in ${(r.total_ms / 1000).toFixed(1)} s (analysis ${(r.analysis_ms / 1000).toFixed(1)} s, session ${(r.session_ms / 1000).toFixed(1)} s), ${r.cost_usd} USD`)
    return 0
  } catch (e) {
    const red = e instanceof Red ? e : new Red('canary', e.message)
    if (env.CANARY_STATE) save(env.CANARY_STATE, { ok: false, at, leg: red.leg, cause: red.cause_, ...red.extra, total_ms: now() - at })
    err(`CANARY FAILED at «${red.leg}»: ${red.cause_}${red.extra?.message_id ? ` (message ${red.extra.message_id} stays closed for diagnosis)` : ''}`)
    return RED
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then((code) => process.exit(code))
