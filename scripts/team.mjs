#!/usr/bin/env node
// `team`: the command an unattended Claude Code session uses to talk to the Team Platform API with the credential of its
// agent member (UD-255, H-3724). It signs every request with the `signed-header` scheme of src/identity/delegated.js:
// X-Team-Sig = HMAC-SHA256(secret, `${ts}.${METHOD}.${path}.${email}`), `ts` in Unix seconds.
// Standalone on purpose: only Node built-ins, so the worker can copy this one file into a machine it creates.

import { createHmac } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export const HELP = `team: talks to the Team Platform API as the agent member of this session.

Environment: TEAM_URL (API address, e.g. http://127.0.0.1:3000), TEAM_AGENT_EMAIL, TEAM_AGENT_SECRET.
Optional: TEAM_API_PREFIX (default /api), TEAM_JOB_ID (default job of «team progress»).

Commands:
  team show <message_id>                          print the message with its fields and its thread, as JSON
  team reply <message_id> --body <text> [--kind answer|fix|clarification] [--captures <json|file>] [--zone <zone>]
                                                  add a reply to the thread (kind default: answer). --captures attaches the «before»
                                                  screenshots: a list of { path (in $TEAM_CAPTURES_DIR), alt, masked, place, as };
                                                  masked false needs --zone ninguna
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

/** The words that label a capture, by reply language: the file name «Antes - <alt>.png» is what the panel shows under the image. */
export const CAPTURE_LABELS = { 'es-419': { before: 'Antes', after: 'Después' }, en: { before: 'Before', after: 'After' } }
export const captureLabels = (language) => CAPTURE_LABELS[language] ?? CAPTURE_LABELS['es-419']

const IMAGE_TYPES = [
  { mime: 'image/png', ext: '.png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: '.jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: '.webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' }
]
const ALT_CHARS = 120 // declared courtesy: the alt text names the capture in the file name and in the panel, one line

/** The name a capture gets as an attachment: «<Label> - <alt>.<ext>», without path characters. */
export function captureName (label, alt, ext) {
  const clean = String(alt).replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  return `${label} - ${clean}${ext}`
}

/**
 * Checks the captures a session declares (UD-268). Each one is { path, alt, masked, place, as }; `path` is a file inside `dir`. Returns
 * { accepted, rejected }: `accepted` carries `file` (real path), `mime`, `ext` and `size`; `rejected` carries `index` and `reason`. Nothing here reads
 * the image: the type comes from the first bytes, and whether it shows people is what `masked` declares. `masked: false` is accepted only when
 * `zone` equals `openZone`; any other zone, or none declared, keeps it out.
 */
export async function checkCaptures (list, { dir, max, maxBytes, zone = null, openZone = 'ninguna' }) {
  const accepted = []
  const rejected = []
  const items = Array.isArray(list) ? list : []
  let root = null
  try { if (dir) root = await realpath(resolve(dir)) } catch { /* no directory: every path is rejected below */ }
  for (const [index, c] of items.entries()) {
    const no = (reason) => rejected.push({ index, reason })
    if (accepted.length >= max) { no('too_many'); continue }
    if (c === null || typeof c !== 'object') { no('invalid'); continue }
    const text = (v) => typeof v === 'string' && v.trim() !== ''
    if (!text(c.path) || !text(c.alt) || !text(c.place) || !text(c.as) || typeof c.masked !== 'boolean' || /[\r\n]/.test(c.alt)) { no('invalid'); continue }
    if (c.masked === false && (zone === null || zone === undefined || zone !== openZone)) { no('unmasked_sensitive'); continue }
    let file
    try { file = await realpath(resolve(root ?? '/', c.path)) } catch { no('missing'); continue }
    const inside = root !== null && relative(root, file) !== '' && !relative(root, file).startsWith('..') && !relative(root, file).startsWith(sep)
    if (!inside) { no('outside'); continue }
    const info = await stat(file)
    if (!info.isFile()) { no('missing'); continue }
    if (info.size > maxBytes) { no('too_large'); continue }
    const bytes = await readFile(file)
    const type = IMAGE_TYPES.find((t) => t.test(bytes))
    if (!type) { no('not_image'); continue }
    accepted.push({ ...c, index, alt: c.alt.trim().slice(0, ALT_CHARS), file, mime: type.mime, ext: type.ext, size: info.size })
  }
  return { accepted, rejected }
}

/** A multipart/form-data body by hand: `FormData` turns the line breaks of a text field into CRLF, and the reply text keeps its own. */
function multipartBody (fields, files) {
  const boundary = `----team${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
  const parts = []
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name.replace(/["\r\n]/g, ' ')}"\r\nContent-Type: ${f.mime}\r\n\r\n`), f.bytes, Buffer.from('\r\n'))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { multipart: true, type: `multipart/form-data; boundary=${boundary}`, bytes: Buffer.concat(parts) }
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
    const multipart = body?.multipart === true
    if (body !== undefined) headers['content-type'] = multipart ? body.type : 'application/json'
    const res = await fetchImpl(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : (multipart ? body.bytes : JSON.stringify(body)) })
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
  const warnings = []
  try {
    if (command === 'show') r = await call('GET', `/messages/${id(rest[0], 'message_id')}`)
    else if (command === 'timing') {
      r = await call('GET', `/messages/${id(rest[0], 'message_id')}/timing`)
      if (r.ok && r.data && typeof r.data === 'object') { const { tree, ...figures } = r.data; r.data = figures } // the tree is for the panel
    }
    else if (command === 'reply') {
      if (typeof options.body !== 'string' || options.body.trim() === '') throw new Error('team reply: --body is required.')
      if (options.captures === undefined) r = await call('POST', `/messages/${id(rest[0], 'message_id')}/replies`, { body: options.body, ...(options.kind ? { kind: options.kind } : {}) })
      else {
        // The captures go in the same call as the reply: the session posts its first reply after looking, with the «before» in it.
        const labels = captureLabels(env.TEAM_LANGUAGE)
        let list
        try { list = JSON.parse(options.captures.trim().startsWith('[') ? options.captures : await readFile(options.captures, 'utf8')) } catch { throw new Error('team reply: --captures is a JSON list or the path of a file with it.') }
        const { accepted, rejected } = await checkCaptures(list, {
          dir: env.TEAM_CAPTURES_DIR ?? '', max: Number(env.TEAM_CAPTURES_MAX ?? 0), maxBytes: Number(env.TEAM_CAPTURES_MAX_BYTES ?? 0), zone: options.zone ?? null, openZone: env.TEAM_CAPTURES_OPEN_ZONE ?? 'ninguna'
        })
        for (const x of rejected) warnings.push(`team reply: capture ${x.index + 1} skipped (${x.reason}).`)
        let text = options.body
        const files = []
        for (const c of accepted) {
          files.push({ name: captureName(labels.before, c.alt, c.ext), mime: c.mime, bytes: await readFile(c.file) })
          text += `\n\n**${labels.before}**: ${c.alt}. ${c.place}, ${c.as}.`
        }
        r = await call('POST', `/messages/${id(rest[0], 'message_id')}/replies`, multipartBody({ body: text, ...(options.kind ? { kind: options.kind } : {}) }, files))
      }
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
  return { code: 0, out: command === 'show' || command === 'timing' ? JSON.stringify(r.data, null, 2) : `ok ${command}${r.data?.id ? ` ${r.data.id}` : ''}`, err: warnings.join('\n') }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const r = await runTeam(process.argv.slice(2))
  if (r.out) process.stdout.write(`${r.out}\n`)
  if (r.err) process.stderr.write(`${r.err}\n`)
  process.exitCode = r.code
}
