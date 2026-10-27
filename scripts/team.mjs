#!/usr/bin/env node
// `team`: the command an unattended Claude Code session uses to talk to the Team Platform API with the credential of its
// agent member (UD-255, H-3724). It signs every request with the `signed-header` scheme of src/identity/delegated.js:
// X-Team-Sig = HMAC-SHA256(secret, `${ts}.${METHOD}.${path}.${email}`), `ts` in Unix seconds.
// Standalone on purpose: only Node built-ins, so the worker can copy this one file into a machine it creates.

import { createHmac } from 'node:crypto'
import { mkdir, open, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// `{masked}` is the one line of the text that depends on the host: with screenshots that show people allowed (UD-270, TEAM_CAPTURES_UNMASKED) an unmasked capture needs no open zone.
const HELP_TEMPLATE = `team: talks to the Team Platform API as the agent member of this session.

Environment: TEAM_URL (API address, e.g. http://127.0.0.1:3000), TEAM_AGENT_EMAIL, TEAM_AGENT_SECRET.
Optional: TEAM_API_PREFIX (default /api), TEAM_JOB_ID (default job of «team progress»).

Commands:
  team show <message_id>                          print the message with its fields and its thread, as JSON
  team reply <message_id> --body <text> [--kind answer|fix|clarification] [--captures <json|file>] [--zone <zone>]
                                                  add a reply to the thread (kind default: answer). --captures attaches the «before»
                                                  screenshots: a list of { path (in $TEAM_CAPTURES_DIR), alt, masked, place, as };
                                                  {masked}
                                                  If none is accepted nothing is posted and the exit code is 1
  team progress [<job_id>] --percent <0-100> --phrase <text>
                                                  report what the session is doing; shown on the message card
  team mark <judge|delivery|wait> --ms <milliseconds> [--ok true|false]
                                                  report the time this session spent in the judge, in the delivery or waiting; added up per job.
                                                  With «delivery», --ok says whether the delivery reached production
  team guard                                      PreToolUse hook (event on stdin): refuses a push to main or a forced push (UD-295)
  team map [--brief]                              short map of the repository: folders, where screens, API, migrations and tests live, files most touched in 30 days
  team mentions [<job_id>]                        for the hook of the session (UD-285): takes the replies that mentioned the agent while it works and prints them as the
                                                  JSON of a Claude Code hook (additionalContext); their files are left in $TEAM_THREAD_DIR. Prints nothing when there is nothing new
  team timing <message_id>                        where the time of the message's execution went, as JSON (without the span tree)
  team close <message_id>                         close the message
  team walkthrough --url <address> --steps <json|file> --place <route> --as <role> [--profile desktop|phone|both] [--masked true|false] [--out <dir>]
                                                  records the numbered route through the view of the branch: a WebM video (1280x720 desktop,
                                                  390x844 phone), one screenshot per step, a label «Paso N» and the touched element outlined.
                                                  A step is { label, click?, fill?: [selector, text], press?, goto?, target? }. Writes steps.json and
                                                  captures.json in $TEAM_CAPTURES_DIR; prints the captures list for the final output. If it
                                                  cannot record it says so in one line and the screenshots of the steps that ran stay
  team --help                                     this text

Exit code 0 on success; 1 with the API's code and message on stderr otherwise.`

/** The text of `team --help`. `unmasked`: the host lets screenshots show people (TEAM_CAPTURES_UNMASKED allowed), so `masked false` needs no open zone. */
export const helpText = ({ unmasked = false } = {}) => HELP_TEMPLATE.replace('{masked}', unmasked ? 'masked false is accepted as it is.' : 'masked false needs --zone ninguna.')
export const HELP = helpText()
const unmaskedAllowed = (env) => ['allowed', '1'].includes(env?.TEAM_CAPTURES_UNMASKED)

export function sign (secret, { ts, method, pathname, email }) {
  return createHmac('sha256', secret).update(`${ts}.${method}.${pathname}.${email}`).digest('hex')
}

/** The words that label a capture, by reply language: the file name «Antes - <alt>.png» is what the panel shows under the image. */
export const CAPTURE_LABELS = { 'es-419': { before: 'Antes', after: 'Después', proposal: 'Propuesta' }, en: { before: 'Before', after: 'After', proposal: 'Proposal' } }
export const captureLabels = (language) => CAPTURE_LABELS[language] ?? CAPTURE_LABELS['es-419']

const IMAGE_TYPES = [
  { mime: 'image/png', ext: '.png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: '.jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: '.webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' }
]
// UD-275: the walkthrough video of a proposal (WebM or MP4, by its first bytes). A video is accepted only when the caller gives it a size limit.
const VIDEO_TYPES = [
  { mime: 'video/webm', ext: '.webm', test: (b) => b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: 'video/mp4', ext: '.mp4', test: (b) => b.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp' }
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
 * With `unmasked: true` (the host allows screenshots that show personal data, UD-270) the zone is not looked at.
 */
export async function checkCaptures (list, { dir, max, maxBytes, maxVideoBytes = 0, zone = null, openZone = 'ninguna', unmasked = false }) {
  const accepted = []
  const rejected = []
  const items = Array.isArray(list) ? list : []
  let root = null
  try { if (dir) root = await realpath(resolve(dir)) } catch { /* no directory: every path is rejected below */ }
  for (const [index, c] of items.entries()) {
    const no = (reason) => rejected.push({ index, reason })
    if (c === null || typeof c !== 'object') { no('invalid'); continue }
    const text = (v) => typeof v === 'string' && v.trim() !== ''
    if (!text(c.path) || !text(c.alt) || !text(c.place) || !text(c.as) || typeof c.masked !== 'boolean' || /[\r\n]/.test(c.alt)) { no('invalid'); continue }
    if (c.masked === false && !unmasked && (zone === null || zone === undefined || zone !== openZone)) { no('unmasked_sensitive'); continue }
    let file
    try { file = await realpath(resolve(root ?? '/', c.path)) } catch { no('missing'); continue }
    const inside = root !== null && relative(root, file) !== '' && !relative(root, file).startsWith('..') && !relative(root, file).startsWith(sep)
    if (!inside) { no('outside'); continue }
    const info = await stat(file)
    if (!info.isFile()) { no('missing'); continue }
    // Only the head of the file is read: the type comes from the first bytes, and a video can be large.
    const handle = await open(file, 'r')
    const bytes = Buffer.alloc(32)
    let read = 0
    try { read = (await handle.read(bytes, 0, 32, 0)).bytesRead } finally { await handle.close() }
    const head = bytes.subarray(0, read)
    const image = IMAGE_TYPES.find((t) => t.test(head))
    const video = image ? null : (maxVideoBytes > 0 ? VIDEO_TYPES.find((t) => t.test(head)) : null)
    const type = image ?? video
    if (!type) { no('not_image'); continue }
    // The count cap is for screenshots; the walkthrough video is one, apart (UD-275).
    if (image ? accepted.filter((a) => a.kind === 'image').length >= max : accepted.some((a) => a.kind === 'video')) { no('too_many'); continue }
    if (info.size > (image ? maxBytes : maxVideoBytes)) { no('too_large'); continue }
    accepted.push({ ...c, index, alt: c.alt.trim().slice(0, ALT_CHARS), file, mime: type.mime, ext: type.ext, size: info.size, kind: image ? 'image' : 'video' })
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
      if (key === 'help' || key === 'hook' || key === 'brief') { options[key] = true; continue }
      options[key] = argv[i + 1]
      i++
    } else positional.push(a)
  }
  return { positional, options }
}

/** Runs one command. Returns { code, out, err } instead of exiting, so it can be tested in process. */
// Claude Code caps each `additionalContext` string of a hook at 10,000 characters and saves a longer one to a file with a 2,000-character preview
// (https://code.claude.com/docs/en/hooks, read 2026-10-24). The context is cut here, before that, and the whole text is left in a file the session opens.
export const HOOK_CONTEXT_MAX_CHARS = 10000

const safeName = (name, fallback) => String(name ?? '').replace(/[\\/\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() || fallback

/**
 * What the session reads when replies mention it while it works (UD-285): who wrote each, when, the text, the attachments as files under `dir`
 * (links with their address) and, for audio and video, what was said. `list` is what `POST /jobs/:id/mentions/take` returned. A file that cannot be
 * downloaded is said in the text and in `warnings`; the reply still arrives.
 */
export async function liveMentionsContext (list, { dir, jobId, messageId, download, warnings = [] }) {
  const out = []
  for (const m of list) {
    const lines = [`NEW REPLY THAT MENTIONS YOU, received while you work (job ${jobId}${messageId ? `, message ${messageId}` : ''}).`, `reply ${m.reply_id} by ${m.by}, ${m.at}:`, '', m.body || '(no text)']
    const taken = new Set()
    for (const a of m.attachments ?? []) {
      if (a.kind === 'link') { lines.push('', `- link: ${a.link}`); continue }
      let rel = `reply-${m.reply_id}/${safeName(a.name, `file-${a.id}`)}`
      for (let n = 2; taken.has(rel); n++) rel = `reply-${m.reply_id}/${n}-${safeName(a.name, `file-${a.id}`)}`
      taken.add(rel)
      const bits = [a.kind, a.mime, `${a.size} bytes`].filter(Boolean).join(', ')
      let saved = `${join(dir, rel)}`
      try {
        const r = await download(a.id)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        await mkdir(dirname(join(dir, rel)), { recursive: true })
        await writeFile(join(dir, rel), r.data)
      } catch (error) {
        saved = `could not be downloaded (${error.message})`
        warnings.push(`team mentions: ${a.name}: ${saved}`)
      }
      lines.push('', `- ${safeName(a.name, 'file')} (${bits}): ${saved}`)
      if (a.transcript) lines.push(`  transcript of ${safeName(a.name, 'file')}:`, a.transcript.split('\n').map((l) => `  ${l}`).join('\n'))
    }
    out.push(lines.join('\n'))
  }
  const names = [...new Set(list.map((m) => m.by))].join(', ')
  out.push(`Take ${list.length === 1 ? 'it' : 'them'} into account from your next step: ${list.length === 1 ? 'it' : 'they'} may correct, narrow or add to what you are doing. Do not start another job and do not send a «Recibido»: the system already posted it in the thread. Your final \`summary\` answers ${list.length === 1 ? 'it' : 'them'} too, addressed to ${names}.`)
  let text = out.join('\n\n---\n\n')
  if (text.length > HOOK_CONTEXT_MAX_CHARS) {
    const file = join(dir, `live-mentions-${list[0].reply_id}.md`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, text)
    const note = `\n\n[cut: the whole text, with the transcripts, is in ${file}]`
    text = `${text.slice(0, HOOK_CONTEXT_MAX_CHARS - note.length)}${note}`
  }
  return text
}

/** Why a Bash command of the session is refused, or null: a push to `main`/`master` (also `HEAD:main`) and a forced push (UD-295). The branch of the job is the only one a session pushes. */
export function refuseCommand (command) {
  for (const segment of command.split(/&&|\|\||;|\n/)) {
    const words = segment.trim().split(/\s+/)
    const at = words.findIndex((w, i) => w === 'push' && words.slice(0, i).includes('git'))
    if (at === -1) continue
    const args = words.slice(at + 1)
    if (args.some((a) => a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || a === '--mirror' || a === '--delete')) return 'team guard: a forced or destructive push is not allowed; push your own branch (tp/<message id>) without force.'
    if (args.some((a) => /(^|:|\/)(main|master)$/.test(a))) return 'team guard: never push main or master; push the branch of the job (tp/<message id>).'
  }
  return null
}

export async function runTeam (argv, env = process.env, fetchImpl = fetch) {
  const { positional, options } = parseArgs(argv)
  const [command, ...rest] = positional
  if (options.help || !command || command === 'help') return { code: command && command !== 'help' ? 1 : 0, out: helpText({ unmasked: unmaskedAllowed(env) }), err: '' }
  if (command === 'map') {
    // UD-295: the short map of the repository the session starts in; `--hook` wraps it as the context of a SessionStart hook.
    try {
      const { buildRepoMap, readNotes, MAP_NOTES_FILE } = await import('./repo-map.mjs')
      const paths = String(env.TEAM_MAP_PATHS ?? '').split(',').map((p) => p.trim()).filter(Boolean)
      const notes = await readNotes(process.cwd(), env.TEAM_MAP_NOTES || MAP_NOTES_FILE) // the host's own lines about its repository: a file in it, `.team/map-notes.txt` unless TEAM_MAP_NOTES says another
      const map = await buildRepoMap({ cwd: process.cwd(), paths, brief: options.brief === true, notes })
      return { code: 0, out: options.hook ? JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: map.text } }) : map.text, err: '' }
    } catch (error) { return { code: 0, out: '', err: `team map: ${error.message}` } } // the map is a help: a repository without git starts the session without it
  }
  if (command === 'guard') {
    // UD-295: PreToolUse hook of a direct fix on a light model. A rule that must hold is enforced here and not asked in the prompt: the session never pushes `main`
    // nor forces a push, whatever it was told or forgot. It reads the event as JSON on stdin; exit 2 with the reason on stderr refuses the tool call.
    const raw = await new Promise((done) => { let t = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { t += c }); process.stdin.on('end', () => done(t)); if (process.stdin.isTTY) done('') })
    let event = {}
    try { event = JSON.parse(raw) } catch { /* no event: nothing to refuse */ }
    const refusal = refuseCommand(event?.tool_name === 'Bash' ? String(event?.tool_input?.command ?? '') : '')
    return refusal ? { code: 2, out: '', err: refusal } : { code: 0, out: '', err: '' }
  }
  if (command === 'walkthrough') {
    try {
      const { runWalkthrough } = await import('./walkthrough.mjs')
      const w = await runWalkthrough(options, env)
      return { code: 0, out: JSON.stringify({ captures: w.captures, steps: w.steps, videos: w.videos }, null, 2), err: w.failed.map((f) => `team walkthrough: ${f.profile}: ${f.reason}`).join('\n') }
    } catch (error) { return { code: 1, out: '', err: error.message } }
  }
  const base = String(env.TEAM_URL ?? '').replace(/\/$/, '')
  const email = env.TEAM_AGENT_EMAIL
  const secret = env.TEAM_AGENT_SECRET
  if (!base || !email || !secret) return { code: 1, out: '', err: 'team: TEAM_URL, TEAM_AGENT_EMAIL and TEAM_AGENT_SECRET are required.' }
  const prefix = env.TEAM_API_PREFIX ?? '/api'

  const call = async (method, path, body, { binary = false } = {}) => {
    const pathname = `${prefix}${path}`
    const ts = String(Math.floor(Date.now() / 1000))
    const headers = { 'x-team-user': email, 'x-team-ts': ts, 'x-team-sig': sign(secret, { ts, method, pathname, email }) }
    const multipart = body?.multipart === true
    if (body !== undefined) headers['content-type'] = multipart ? body.type : 'application/json'
    const res = await fetchImpl(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : (multipart ? body.bytes : JSON.stringify(body)) })
    if (binary) return { ok: res.ok, status: res.status, data: Buffer.from(await res.arrayBuffer()) }
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
          dir: env.TEAM_CAPTURES_DIR ?? '', max: Number(env.TEAM_CAPTURES_MAX ?? 0), maxBytes: Number(env.TEAM_CAPTURES_MAX_BYTES ?? 0), zone: options.zone ?? null, openZone: env.TEAM_CAPTURES_OPEN_ZONE ?? 'ninguna', unmasked: ['allowed', '1'].includes(env.TEAM_CAPTURES_UNMASKED)
        })
        // No capture accepted: nothing is posted. A session that believes it sent the «before» would lose everything that depends on it.
        if (accepted.length === 0) {
          const lines = rejected.map((x) => `  capture ${x.index + 1}: ${x.reason}`)
          if (lines.length === 0) lines.push('  --captures carried an empty list')
          throw new Error(`team reply: no capture was accepted, so the reply was NOT posted.\n${lines.join('\n')}\nFix the captures and call «team reply» again: take the screenshot again inside $TEAM_CAPTURES_DIR as a PNG, JPEG or WebP, declare \`masked\` truthfully (true only when the tool hid the personal data), or pass --zone with the open zone when \`masked\` is false.`)
        }
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
    } else if (command === 'mentions') {
      const jobId = id(rest[0] ?? env.TEAM_JOB_ID, 'job_id')
      const taken = await call('POST', `/jobs/${jobId}/mentions/take`)
      if (!taken.ok) return { code: 1, out: '', err: `team mentions: HTTP ${taken.status} ${taken.data?.code ?? ''} ${taken.data?.message ?? ''}`.trim() }
      const list = taken.data?.mentions ?? []
      if (list.length === 0) return { code: 0, out: '', err: '' }
      const dir = env.TEAM_THREAD_DIR || join(tmpdir(), `team-thread-${jobId}`)
      const text = await liveMentionsContext(list, { dir, jobId, messageId: env.TEAM_MESSAGE_ID, download: (attachmentId) => call('GET', `/replies/attachments/${attachmentId}`, undefined, { binary: true }), warnings })
      return { code: 0, out: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolBatch', additionalContext: text } }), err: warnings.join('\n') }
    } else if (command === 'progress') {
      const percent = Number(options.percent)
      if (!Number.isFinite(percent) || typeof options.phrase !== 'string') throw new Error('team progress: --percent and --phrase are required.')
      r = await call('POST', `/jobs/${id(rest[0] ?? env.TEAM_JOB_ID, 'job_id')}/progress`, { percent, phrase: options.phrase })
    } else return { code: 1, out: '', err: `team: unknown command «${command}».\n\n${helpText({ unmasked: unmaskedAllowed(env) })}` }
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
