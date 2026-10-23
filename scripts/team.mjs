#!/usr/bin/env node
// `team`: the command an unattended Claude Code session uses to talk to the Team Platform API with the credential of its
// agent member (UD-255, H-3724). It signs every request with the `signed-header` scheme of src/identity/delegated.js:
// X-Team-Sig = HMAC-SHA256(secret, `${ts}.${METHOD}.${path}.${email}`), `ts` in Unix seconds.
// Standalone on purpose: only Node built-ins, so the worker can copy this one file into a machine it creates.

import { createHmac } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const HELP = `team: talks to the Team Platform API as the agent member of this session.

Environment: TEAM_URL (API address, e.g. http://127.0.0.1:3000), TEAM_AGENT_EMAIL, TEAM_AGENT_SECRET.
Optional: TEAM_API_PREFIX (default /api), TEAM_JOB_ID (default job of «team progress»).

Commands:
  team show <message_id>                          print the message with its fields and its thread, as JSON
  team reply <message_id> --body <text> [--kind answer|fix|clarification]
                                                  add a reply to the thread (kind default: answer)
  team progress [<job_id>] --percent <0-100> --phrase <text>
                                                  report what the session is doing; shown on the message card
  team mark <judge|delivery|wait> --ms <milliseconds> [--ok true|false]
                                                  report the time this session spent in the judge, in the delivery or waiting; added up per job.
                                                  With «delivery», --ok says whether the delivery reached production
  team timing <message_id>                        where the time of the message's execution went, as JSON (without the span tree)
  team close <message_id>                         close the message
  team --help                                     this text

Exit code 0 on success; 1 with the API's code and message on stderr otherwise.`

export function sign (secret, { ts, method, pathname, email }) {
  return createHmac('sha256', secret).update(`${ts}.${method}.${pathname}.${email}`).digest('hex')
}

function parseArgs (argv) {
  const positional = []
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (key === 'help') { options.help = true; continue }
      options[key] = argv[i + 1]
      i++
    } else positional.push(a)
  }
  return { positional, options }
}

/** Runs one command. Returns { code, out, err } instead of exiting, so it can be tested in process. */
export async function runTeam (argv, env = process.env, fetchImpl = fetch) {
  const { positional, options } = parseArgs(argv)
  const [command, ...rest] = positional
  if (options.help || !command || command === 'help') return { code: command && command !== 'help' ? 1 : 0, out: HELP, err: '' }
  const base = String(env.TEAM_URL ?? '').replace(/\/$/, '')
  const email = env.TEAM_AGENT_EMAIL
  const secret = env.TEAM_AGENT_SECRET
  if (!base || !email || !secret) return { code: 1, out: '', err: 'team: TEAM_URL, TEAM_AGENT_EMAIL and TEAM_AGENT_SECRET are required.' }
  const prefix = env.TEAM_API_PREFIX ?? '/api'

  const call = async (method, path, body) => {
    const pathname = `${prefix}${path}`
    const ts = String(Math.floor(Date.now() / 1000))
    const headers = { 'x-team-user': email, 'x-team-ts': ts, 'x-team-sig': sign(secret, { ts, method, pathname, email }) }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetchImpl(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { ok: res.ok, status: res.status, data }
  }
  const id = (v, what) => {
    if (!/^[0-9]+$/.test(String(v ?? ''))) throw new Error(`team ${command}: missing or invalid ${what}.`)
    return String(v)
  }

  let r
  try {
    if (command === 'show') r = await call('GET', `/messages/${id(rest[0], 'message_id')}`)
    else if (command === 'timing') {
      r = await call('GET', `/messages/${id(rest[0], 'message_id')}/timing`)
      if (r.ok && r.data && typeof r.data === 'object') { const { tree, ...figures } = r.data; r.data = figures } // the tree is for the panel
    }
    else if (command === 'reply') {
      if (typeof options.body !== 'string' || options.body.trim() === '') throw new Error('team reply: --body is required.')
      r = await call('POST', `/messages/${id(rest[0], 'message_id')}/replies`, { body: options.body, ...(options.kind ? { kind: options.kind } : {}) })
    } else if (command === 'close') r = await call('POST', `/messages/${id(rest[0], 'message_id')}/close`)
    else if (command === 'mark') {
      const name = rest[0]
      const ms = Number(options.ms)
      if (!['judge', 'delivery', 'wait'].includes(name) || !Number.isInteger(ms) || ms < 0) throw new Error('team mark: use «team mark <judge|delivery|wait> --ms <milliseconds>».')
      if (options.ok !== undefined && !['true', 'false'].includes(options.ok)) throw new Error('team mark: --ok is true or false.')
      r = await call('POST', `/jobs/${id(env.TEAM_JOB_ID, 'TEAM_JOB_ID')}/marks`, { name, ms, ...(options.ok !== undefined ? { ok: options.ok === 'true' } : {}) })
    } else if (command === 'progress') {
      const percent = Number(options.percent)
      if (!Number.isFinite(percent) || typeof options.phrase !== 'string') throw new Error('team progress: --percent and --phrase are required.')
      r = await call('POST', `/jobs/${id(rest[0] ?? env.TEAM_JOB_ID, 'job_id')}/progress`, { percent, phrase: options.phrase })
    } else return { code: 1, out: '', err: `team: unknown command «${command}».\n\n${HELP}` }
  } catch (error) {
    return { code: 1, out: '', err: error.message }
  }
  if (!r.ok) return { code: 1, out: '', err: `team ${command}: HTTP ${r.status} ${r.data?.code ?? ''} ${r.data?.message ?? ''}`.trim() }
  return { code: 0, out: command === 'show' || command === 'timing' ? JSON.stringify(r.data, null, 2) : `ok ${command}${r.data?.id ? ` ${r.data.id}` : ''}`, err: '' }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await runTeam(process.argv.slice(2))
  if (r.out) process.stdout.write(`${r.out}\n`)
  if (r.err) process.stderr.write(`${r.err}\n`)
  process.exitCode = r.code
}
