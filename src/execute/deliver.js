// The `deliver` job (UD-263, MASTER-SPEC §7.3 and §7.5 «Ejecución»): the delivery to production as a job of its own, without AI and without a
// machine. `execute` ends at the push of the branch `tp/<message_id>`; when it ends with `outcome: done` it enqueues this job (an Editor can
// enqueue it with `POST /messages/:id/deliver`). The job runs EXECUTE_DELIVER_COMMAND, a shell command of the host, in the host of the worker:
//
//   placeholders  {message_id} {job_id} {branch} {workdir}   (shell-quoted; {workdir} is an empty directory removed afterwards)
//   exit 0        it is in production; the last stdout line is the reference (a commit, a URL or a label)
//   exit 75       it cannot be delivered now (EX_TEMPFAIL): the job waits EXECUTE_CAPACITY_WAIT_MS and tries again without spending its attempt
//   TEAM_REVIEWED_BY  the member who launched this delivery by hand (any active person who approved: by hand, by reply, or in advance through `approved`, UD-275, UD-286); empty otherwise. A host that holds by zone must not
//                 hold again when it is set: a person already approved it, and exit 76 then counts as a failure of the command.
//   exit 76       it is not delivered by itself: it waits for the review of a person (UD-266). The last stdout line is the reason in plain
//                 words. No retry and no second pass: the job ends done with `delivered = 0` and `delivery_held = 1`, and ONE reply with
//                 the summary, the reason and `needs_decision` goes to the person who decides in the area (UD-269), who gets the message. The platform knows no zones: the host decides, reading TEAM_OUTPUT_JSON
//   other exit    the delivery failed; its stdout and stderr are the reason
//   environment   TEAM_JOB_ID TEAM_MESSAGE_ID TEAM_BRANCH TEAM_WORKDIR TEAM_DELIVER_ROUND TEAM_DELIVER_ATTEMPT and TEAM_OUTPUT_JSON (the structured output of the
//                 session, compact JSON without `summary`)
//                 TEAM_CAPTURES_VIDEO is «1» when the session left the walkthrough video (UD-275), «0» when not: a host that holds for review says so in the reason
//   timeout       EXECUTE_DELIVER_TIMEOUT_MS; SIGTERM to the group the job started, then SIGKILL after EXECUTE_KILL_GRACE_MS
//   stdout lines  `##team phase verify` and `##team phase deploy` move the progress of the job (and the panel) to that phase
//   «after»       TEAM_BEFORE_CAPTURES is the JSON list [{ place, as, width, height }] of the «before» of the first reply (empty list without one). With exit 0 the
//                 command can take the «after» from production at that place: it leaves the image in $TEAM_WORKDIR/captures and prints `##team capture <json>`
//                 ({ path, alt, masked, place, as }, as in `team reply --captures`), or `##team capture-failed <reason>`, which the closing reply says in one line. The
//                 capture of the session (taken from the branch) is used only when the first reply carried no «before» (UD-268)
//
// The author gets ONE closing reply. In green: the `summary` of the session plus «Ya está en producción», the reference in the structured
// part. If the verification fails, an `execute` job runs once more (EXECUTE_DELIVER_RETRIES) with the output in its prompt; if it fails again,
// the reply is the plain notice that it did not pass, with `outcome: blocked`.

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { SpanStatusCode, context, trace } from '@opentelemetry/api'
import { get, run as runSql } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { addReply, closeMessage } from '../domain/messages.js'
import { handOffToPerson } from '../domain/escalation.js'
import { permanent } from '../domain/errors.js'
import { Deferred } from '../domain/pipeline.js'
import { step } from '../domain/progress-phrases.js'
import { endManualSpan, startManualSpan, withSpan } from '../telemetry/api.js'
import { updateExecuteRun } from '../telemetry/execute-runs.js'
import { closeLine, closeReason, firstReplyAnchor } from './auto-close.js'
import { beforeOfMessage, capturesDir, closingCaptures, deliveryCaptureLines, describeRejected, noCaptureLine, storeCaptures } from './captures.js'
import { enqueueExecute } from './enqueue.js'
import { dailyBudget } from './budget.js'
import { labelOfModel, resolveExecuteModel } from '../domain/execute-models.js'
import { replyBody } from './handler.js'
import { readTemplate } from './prompt.js'
import { fillCommand, spawnStreaming } from './runners.js'

export const DELIVER_LATER = 75 // EX_TEMPFAIL (sysexits.h): the host cannot deliver now
export const DELIVER_HELD = 76 // the next code after EX_TEMPFAIL, outside sysexits (64 to 78 have no use for it here): a person reviews before it is delivered
// How many «not now» answers (exit 75) in a row, with the same output, the job waits through before it stops being a wait. It is not chosen: a legitimate wait
// (the turn of another delivery, a quota, no stock) lasts at most one turn of the host, 64 min measured 2026-10-26 (a turn of 64 min detained six branches 30 min;
// infra/techo-de-gasto.json `vida_max_min`), and each wait is EXECUTE_CAPACITY_WAIT_MS. Past that the same output is not a wait but a fault that only a change of the
// system fixes (a missing binary, a broken host script), and every extra turn can create a machine and spend money (rule 12 of the repository, counted by events, not by clock).
export const HOST_TURN_LIFE_MS = 64 * 60_000
export const deferralsInARow = (capacityWaitMs) => Math.ceil(HOST_TURN_LIFE_MS / capacityWaitMs)
const REASON_CHARS = 300 // declared courtesy: the reason is one plain sentence for the author
const PHASE_LINE = /^##team phase (verify|deploy)\s*$/
const PHASES = { verify: { code: 'deliverVerify', percent: 0 }, deploy: { code: 'deliverDeploy', percent: 50 } } // percent = finished phases over the two that exist
const CHECK_TIMEOUT_MS = 60000 // declared courtesy: the question «is it already in production?» answers in seconds; one that hangs must not hold the delivery
const OUTPUT_TAIL_CHARS = 6000 // declared courtesy: the end of the output is where a failure is; Claude reads this much in the second pass

const TEXTS = {
  'es-419': {
    production: (time) => `En producción desde ${time}.`,
    afterFailed: (reason) => `No pude tomar la captura del después: ${reason}.`,
    held: (reason, captures) => `Cambio listo para revisar: ${reason}. Todavía no llega a producción.${captures ? ' Cómo queda, en «Propuesta».' : ''}`,
    heldReason: 'el cambio necesita esa revisión',
    verification: (branch, reason, budget) => `No quedó en producción: no pasó la verificación${reason ? ` (${reason})` : ''}.${budget ? ' Se alcanzó el tope de gasto de hoy y Claude no sigue.' : ''} Lo que se hizo queda guardado en la rama ${branch}.\n\nCualquier persona del equipo puede volver a lanzar la entrega.`,
    again: (reason) => `No pasó la verificación${reason ? `: ${reason}` : ''}. Claude lo corrige y vuelve a entregar.`,
    alreadyThere: 'El cambio ya estaba en producción: llegó por otro camino y no hizo falta entregarlo de nuevo.',
    timeout: (branch, minutes) => `La entrega no terminó dentro del tiempo máximo (${minutes} min) y todavía no está en producción. Lo que se hizo queda guardado en la rama ${branch}.\n\nCualquier persona del equipo puede volver a lanzar la entrega.`,
    system: (branch) => `No pude entregar este trabajo por un problema del sistema y todavía no está en producción. Lo que se hizo queda guardado en la rama ${branch}.\n\nCualquier persona del equipo puede volver a lanzar la entrega.`,
    stuck: (branch) => `La entrega espera un arreglo del sistema: el anfitrión respondió «ahora no» una y otra vez con el mismo motivo. Lo hecho queda en la rama ${branch}; se vuelve a lanzar sola con la próxima versión.`,
    environment: (branch, reason) => `La entrega falló dos veces por la máquina de entrega o por el plazo (${reason}), no por el cambio, y todavía no está en producción. Lo que se hizo queda guardado en la rama ${branch}.\n\nQuien reciba este mensaje puede volver a lanzar la entrega.`,
    interrupted: (branch) => `La entrega se interrumpió dos veces seguidas (el servicio se reinició o se cortó la conexión con la máquina de entrega) y todavía no está en producción. Lo que se hizo queda guardado en la rama ${branch}.\n\nQuien reciba este mensaje puede volver a lanzar la entrega.`
  },
  en: {
    production: (time) => `In production since ${time}.`,
    afterFailed: (reason) => `I could not take the «after» screenshot: ${reason}.`,
    held: (reason, captures) => `Change ready for review: ${reason}. It is not in production yet.${captures ? ' How it looks, in «Proposal».' : ''}`,
    heldReason: 'the change needs that review',
    verification: (branch, reason, budget) => `It did not reach production: it did not pass verification${reason ? ` (${reason})` : ''}.${budget ? ' Today\'s spending cap was reached and Claude does not continue.' : ''} The work is saved on the branch ${branch}.\n\nAnyone on the team can launch the delivery again.`,
    again: (reason) => `It did not pass verification${reason ? `: ${reason}` : ''}. Claude is fixing it and will deliver again.`,
    alreadyThere: 'The change was already in production: it arrived another way and did not need to be delivered again.',
    timeout: (branch, minutes) => `The delivery did not finish within the time limit (${minutes} min) and is not in production yet. The work is saved on the branch ${branch}.\n\nAnyone on the team can launch the delivery again.`,
    system: (branch) => `I could not deliver this work because of a system problem and it is not in production yet. The work is saved on the branch ${branch}.\n\nAnyone on the team can launch the delivery again.`,
    stuck: (branch) => `The delivery waits for a fix of the system: the host answered «not now» again and again with the same reason. The work is saved on the branch ${branch}; it launches again by itself with the next version.`,
    environment: (branch, reason) => `The delivery failed twice because of the delivery machine or the time limit (${reason}), not because of the change, and it is not in production yet. The work is saved on the branch ${branch}.\n\nWhoever receives this message can launch the delivery again.`,
    interrupted: (branch) => `The delivery was interrupted twice in a row (the service restarted or the connection to the delivery machine dropped) and it is not in production yet. The work is saved on the branch ${branch}.\n\nWhoever receives this message can launch the delivery again.`
  }
}
const textsOf = (language) => TEXTS[language] ?? TEXTS['es-419']

const CHECK_CHARS = 160 // declared courtesy: the name of a failed check is one short phrase in the notice
const FAILED_CHECK = /^\s*FALLA prueba: (.+?)\s*$/gm
/**
 * The failed checks of a delivery, in plain words: the name of each test that `antes-de-entregar` printed as `FALLA prueba: <file> › <name>`, the first one and how many more.
 * Empty when the output names none. It reads the output of a command, never text of a person (RULES 4).
 */
export function failedCheck (output, language) {
  const names = [...new Set([...String(output ?? '').matchAll(FAILED_CHECK)].map((m) => { const i = m[1].indexOf(' › '); return (i === -1 ? m[1] : m[1].slice(i + 3)).trim() }))].filter(Boolean)
  if (names.length === 0) return ''
  const first = names[0].length > CHECK_CHARS ? `${names[0].slice(0, CHECK_CHARS - 1)}…` : names[0]
  return names.length === 1 ? first : (language === 'en' ? `${first} (and ${names.length - 1} more)` : `${first} (y ${names.length - 1} más)`)
}

// A failure of the delivery machine and not of the change: a timeout, a process killed by a signal, ssh (255) or what the delivery script prints when its
// environment is not ready (the checks of 10 s of `corrida-de-entrega.sh`, the tunnel, the machine that did not accept SSH, no capacity to create one)
// or production moved while the verification ran (exit 5, «lo servido … no es un antecesor de este árbol»: another delivery went out; measured on tp/93, job 97).
// Measured 2026-10-23 (prueba de 14 insumos): the delivery of tp/88 hit the 30 min limit by 47 s while its run on the machine kept going and merged.
const ENVIRONMENT_EXIT_CODES = new Set([255, 137, 143])
// What a shell answers when the command did not run (126 not executable, 127 not found), when `timeout` cut it (124) or when a signal killed it (128 + n): none is the change's.
const isUnstartedOrKilled = (code) => code === 124 || code === 126 || code === 127 || (code >= 129 && code <= 159)
const ENVIRONMENT_OUTPUT = /el entorno de la entrega no est[aá] listo|no se puede entrar por SSH|no acept[oó] SSH|sin token de \S+|no se pudo (armar el árbol|instalar las dependencias)|kex_exchange_identification|Connection (reset|closed|timed out)|ssh: connect to host|ERROR: \(gcloud\.compute\.(ssh|start-iap-tunnel)\)|no se pudo traer desarrollo o main|lo servido \(\w+\) no es un antecesor de este árbol|sin ensayo verde de esta combinaci[oó]n|es (?:de la infraestructura|del entorno|del dep[oó]sito|de la cola) y no del cambio/i
export function isEnvironmentFailure ({ code, timedOut = false, signal = null }, output = '') {
  if (timedOut || signal) return true
  if (code === 0 || code === DELIVER_LATER || code === DELIVER_HELD) return false
  if (ENVIRONMENT_EXIT_CODES.has(code) || isUnstartedOrKilled(code)) return true
  return ENVIRONMENT_OUTPUT.test(String(output))
}

/** The summary with the production note at the end of its last paragraph (the reply keeps its two paragraphs). */
export function withProductionNote (summary, note) {
  const text = String(summary ?? '').trim()
  if (!text) return note
  return `${/[\p{L}\p{N}]$/u.test(text) ? `${text}.` : text} ${note}`
}

/**
 * HH:MM of `at` with the name of the zone, in the server's time zone (TZ, UTC when unset: the same day the spending cap counts, UD-256). The zone goes with the time because
 * a server in UTC would otherwise show a time three hours off to a person in Chile and nobody could tell.
 */
export const clockTime = (at) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short', timeZone: process.env.TZ || 'UTC' })

/**
 * The closing reply of a delivery in green: the summary of the session with «En producción desde HH:MM.», then the lines of the system. `at` is the moment the
 * delivery was confirmed (UD-298): the reply is posted only then, so it states a fact and never a promise. The technical part stays in the run (UD-276).
 */
export function deliveredBody ({ output, language, lines = [], at = Date.now() }) {
  const t = textsOf(language)
  const base = output ?? {}
  return [replyBody({ summary: withProductionNote(base.summary, t.production(clockTime(at))) }), ...lines].join('\n\n')
}

/** The last non-empty stdout line that is not a phase marker: the reference of the delivery. */
export function referenceOf (stdout) {
  const lines = String(stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('##team '))
  return lines.at(-1)?.slice(0, 500) ?? null // a reference is a commit, a URL or a label; 500 characters hold any of them
}

/** The reply of a delivery held for review: the summary of the session and the reason in a plain paragraph. The hand-over carries `needs_decision` as a field (UD-269). */
export function heldBody ({ output, reason, language, captures = false }) {
  const t = textsOf(language)
  const base = output ?? {}
  const why = String(reason ?? '').trim().replace(/[.\s]+$/, '') || t.heldReason
  const summary = [String(base.summary ?? '').trim(), t.held(why, captures)].filter(Boolean).join('\n\n')
  return replyBody({ summary })
}

const tail = (text, chars) => (text.length > chars ? text.slice(-chars) : text)

/** TEAM_OUTPUT_JSON: the structured output of the session without its `summary`, compact; `{}` when the delivery was launched with no output. */
export function outputJson (output) {
  const { summary: _summary, ...rest } = output ?? {}
  return JSON.stringify(rest)
}

export function createDeliverHandler ({ db, config, queue, events, logger = null, now = Date.now }) {
  const x = config.execute

  /** The row of `execute_runs` of the run that handed over to this delivery. Measuring never fails the job. */
  function saveRun (payload, jobId, fields) {
    try {
      if (payload.execute_job_id) updateExecuteRun(db, payload.execute_job_id, payload.execute_attempt ?? 1, { deliver_job_id: jobId, ...fields })
    } catch (error) {
      logger?.warn({ err: error }, 'could not update the execute run with its delivery')
    }
  }

  /**
   * Whether the host already has the branch in production (UD-296): EXECUTE_DELIVER_CHECK_COMMAND runs with {message_id} {job_id} {branch} before the delivery. Exit 0 = the branch is an
   * ancestor of what the host serves (it went out another way, as the night batch did with tp/117) and the last stdout line is the reference; any other exit, a timeout or an error
   * = not known, and the delivery runs as always. The platform does not know where the host keeps its repository (the worker has no git): the host's command answers.
   */
  async function inProduction (job, ctx, { messageId, branch }) {
    if (!x.deliverCheckCommand) return null
    try {
      const command = fillCommand(x.deliverCheckCommand, { job_id: String(job.id), message_id: String(messageId), branch })
      const env = { ...process.env, TEAM_JOB_ID: String(job.id), TEAM_MESSAGE_ID: String(messageId), TEAM_BRANCH: branch }
      const r = await spawnStreaming('/bin/sh', ['-c', command], { env, keepStdout: true, timeoutMs: CHECK_TIMEOUT_MS, graceMs: x.killGraceMs, signal: ctx.signal })
      return r.code === 0 && !r.timedOut ? (referenceOf(r.stdout) ?? 'desarrollo') : null
    } catch (error) {
      logger?.warn({ err: error }, 'the check of the branch in production failed; the delivery runs')
      return null
    }
  }

  async function runJob (job, ctx) {
    const payload = parseJson(job.payload_json, {})
    const { message_id: messageId, member_id: memberId } = payload
    const branch = payload.branch ?? `tp/${messageId}`
    if (!x.deliverCommand) throw permanent('EXECUTE_DELIVER_COMMAND no está declarada.', 'deliver_not_configured')
    const message = get(db, 'SELECT id, status, author_id, template_id FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
    if (!message) throw permanent('El mensaje del trabajo ya no existe.', 'message_missing')
    if (message.status === 'closed') throw permanent('El mensaje está cerrado.', 'message_closed')
    const agent = get(db, 'SELECT id, kind, active FROM members WHERE id = ?', memberId)
    if (!agent || agent.kind !== 'agent') throw permanent('El miembro del trabajo no es un agente.', 'not_an_agent')
    if (agent.active !== 1) throw permanent('El agente está desactivado.', 'account_inactive')
    const author = get(db, 'SELECT language FROM members WHERE id = ?', message.author_id)
    const templateRow = message.template_id ? get(db, 'SELECT id, name, body_markdown FROM templates WHERE id = ?', message.template_id) : null
    const template = readTemplate(templateRow)

    /** The closing of a delivery that reached production, by the command or because the branch was already there (UD-296): the one closing reply and the end of the progress. */
    const closeDelivered = ({ ref, after, ms, alreadyThere = false }) => {
      return () => {
        // Inside the transaction that closes the job: the one closing reply, then the end of the progress.
        // From production when the command took it; the capture of the session (taken from the branch) only when there was no «before» place.
        const fromProduction = after?.stored ?? []
        const stored = fromProduction.length ? fromProduction : (after?.hadBefore ? [] : (payload.captures ?? []).filter((c) => c.kind !== 'video'))
        const closing = closingCaptures(db, { messageId, authorId: agent.id, stored, language: author?.language })
        for (const reason of after?.failed ?? []) closing.lines.push(textsOf(author?.language).afterFailed(reason))
        if (alreadyThere) closing.lines.push(textsOf(author?.language).alreadyThere)
        const missing = noCaptureLine(payload.output, closing.files.length > 0 ? 1 : 0, author?.language, [...(payload.captures_rejected ?? []), ...(after?.rejected ?? [])]) // UD-298
        if (missing) closing.lines.push(missing)
        closing.lines.push(...(payload.documents?.notes ?? [])) // UD-272: the documents the session attached travel with the delivery
        // UD-271: a delivery that ended with exit 0 is «done and checked»; the rest of the conditions are the system's (auto-close.js).
        const request = payload.close_request ?? null // optional (UD-310): a delivery an Editor launched by hand, or a session that did not ask, carries none
        const since = payload.close_since ?? firstReplyAnchor(db, { messageId, agentId: agent.id, from: (payload.execute_job_id ? get(db, 'SELECT created_at FROM jobs WHERE id = ?', payload.execute_job_id)?.created_at : null) ?? job.created_at })
        const why = alreadyThere ? null : closeReason(db, config, { output: payload.output, request, delivered: true, messageId, agentId: agent.id, after: stored.length, since, language: author?.language })
        if (why) closing.lines.push(closeLine(why, author?.language))
        const { replyId } = addReply({ db, events, now }, {
          messageId, authorId: agent.id, kind: 'answer', body: deliveredBody({ output: payload.output, template, ref, language: author?.language, lines: closing.lines, at: now() }), files: [...closing.files, ...(payload.documents?.files ?? [])]
        })
        if (why) closeMessage({ db, events, now }, messageId, agent.id)
        const finalAt = now()
        const started = payload.execute_job_id ? get(db, 'SELECT started_at FROM execute_runs WHERE job_id = ? AND attempt = ?', payload.execute_job_id, payload.execute_attempt ?? 1)?.started_at : null
        saveRun(payload, job.id, {
          delivery_ms: ms, delivered: 1, delivery_held: 0, delivery_ref: ref, ...(typeof started === 'number' ? { final_reply_ms: Math.max(0, finalAt - started) } : {})
        })
        events.publishForJob(job.id, { kind: 'progress', percent: 100, phrase: step('answered'), data: { message_id: messageId } })
        events.publishForJob(job.id, { kind: 'done', data: { status: 'done', message_id: String(messageId), reply_id: String(replyId), delivery_ref: ref } })
      }
    }

    // UD-296: a branch the host already serves went out another way (the night batch of the host): it is delivered, and nothing is deployed again.
    const landed = await inProduction(job, ctx, { messageId, branch })
    if (landed) {
      const ms = 0
      try { runSql(db, 'UPDATE jobs SET marks_json = ? WHERE id = ?', JSON.stringify({ delivery_ms: ms, delivered: 1 }), job.id) } catch { /* the mark is a courtesy */ }
      return closeDelivered({ ref: landed, after: null, ms, alreadyThere: true })
    }

    const startedAt = now()
    const setPhase = (code, percent) => {
      try { runSql(db, 'UPDATE jobs SET phase = ? WHERE id = ?', code, job.id) } catch { /* the label is a courtesy */ }
      if (!queue.progress(job, percent, step(code))) ctx.abort('lost')
    }
    let pending = ''
    let onPhase = () => {}
    const onData = (chunk) => {
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop()
      for (const line of lines) {
        const m = PHASE_LINE.exec(line.trim())
        if (m) onPhase(PHASES[m[1]])
      }
    }

    const root = x.workRoot || config.tmpDir
    await mkdir(root, { recursive: true })
    const workdir = await mkdtemp(join(root, `deliver-${job.id}-`))
    let result
    try {
      result = await withSpan('execute.deliver', {
        'team.step': 'execute.deliver', 'team.message_id': String(messageId), 'team.member_id': String(memberId), 'team.branch': branch, 'team.deliver_round': payload.round ?? 0
      }, async (span) => {
        // One child span per phase of the delivery (`execute.deliver.verify`, `execute.deliver.deploy`): the breakdown of a delivery reads from
        // the traces and not from the machine's logs. The phase in progress ends when the next marker arrives or the command exits.
        const parentContext = trace.setSpan(context.active(), span)
        let phaseSpan = null
        const enterPhase = (code) => {
          if (phaseSpan) endManualSpan(phaseSpan)
          const name = `execute.deliver.${code === 'deliverDeploy' ? 'deploy' : 'verify'}`
          phaseSpan = startManualSpan(name, { 'team.step': name, 'team.phase': code, 'team.job_id': String(job.id) }, parentContext)
        }
        onPhase = ({ code, percent }) => { span.addEvent('deliver.phase', { 'team.phase': code }); enterPhase(code); setPhase(code, percent) }
        setPhase('deliverVerify', 0)
        enterPhase('deliverVerify')
        const command = fillCommand(x.deliverCommand, { job_id: String(job.id), message_id: String(messageId), branch, workdir })
        // UD-268: the «before» (place, role and size) goes to the command, which takes the «after» from production once it serves the change.
        const before = await beforeOfMessage(db, config, { messageId, authorId: agent.id }).catch(() => [])
        await mkdir(capturesDir(workdir), { recursive: true })
        const env = {
          ...process.env, TEAM_JOB_ID: String(job.id), TEAM_MESSAGE_ID: String(messageId), TEAM_BRANCH: branch, TEAM_WORKDIR: workdir, TEAM_BEFORE_CAPTURES: JSON.stringify(before),
          TEAM_DELIVER_ROUND: String(payload.round ?? 0), TEAM_DELIVER_ATTEMPT: String(job.attempts),
          TEAM_OUTPUT_JSON: outputJson(payload.output), TEAM_CAPTURES_VIDEO: (payload.captures ?? []).some((c) => c.kind === 'video') ? '1' : '0', TEAM_REVIEWED_BY: (payload.requested_by ?? payload.approved_by) ? String(payload.requested_by ?? payload.approved_by) : ''
        }
        const r = await spawnStreaming('/bin/sh', ['-c', command], { env, keepStdout: true, onData, timeoutMs: x.deliverTimeoutMs, graceMs: x.killGraceMs, signal: ctx.signal })
        if (phaseSpan) { endManualSpan(phaseSpan, r.code !== 0 && r.code !== DELIVER_LATER && r.code !== DELIVER_HELD ? { error: new Error(r.timedOut ? 'timeout' : `exit ${r.code}`) } : {}); phaseSpan = null }
        span.setAttributes({ 'team.exit_code': r.code ?? -1, 'team.delivery_ms': Math.max(0, now() - startedAt) })
        if (r.code !== 0 && r.code !== DELIVER_LATER && r.code !== DELIVER_HELD) span.setStatus({ code: SpanStatusCode.ERROR, message: r.timedOut ? 'timeout' : `exit ${r.code}` })
        // The «after» the command took (UD-268): stored while the directory exists, like those of the session.
        if (r.code === 0) {
          const reported = deliveryCaptureLines(r.stdout)
          let stored = { stored: [], rejected: [] }
          if (reported.list.length) { try { stored = await storeCaptures({ config, output: { captures: reported.list, zone: payload.output?.zone ?? null }, workdir }) } catch (error) { logger?.warn({ err: error }, 'could not store the captures of the delivery') } }
          for (const c of stored.rejected) span.addEvent('captures.rejected', { 'team.capture_index': c.index, 'team.capture_reason': c.reason })
          if (stored.stored.length) span.setAttribute('team.captures', stored.stored.length)
          r.after = { stored: stored.stored, failed: reported.failed, rejected: describeRejected({ captures: reported.list }, stored.rejected), hadBefore: before.length > 0 }
        }
        const ref = r.code === 0 ? referenceOf(r.stdout) : null
        if (ref) span.setAttribute('team.delivery_ref', ref)
        if (r.code === DELIVER_HELD) span.setAttribute('team.delivery_held', true)
        return r
      })
    } finally {
      try { runSql(db, 'UPDATE jobs SET phase = NULL WHERE id = ?', job.id) } catch { /* the label is a courtesy */ }
      await rm(workdir, { recursive: true, force: true })
    }
    ctx.signal.throwIfAborted()
    const ms = Math.max(0, now() - startedAt)
    if (result.spawnError?.code === 'ENOENT') throw permanent('No se encontró «/bin/sh».', 'harness_unavailable')
    const output = tail([result.stdout.split('\n').filter((l) => !l.startsWith('##team ')).join('\n').trim(), result.stderr.trim()].filter(Boolean).join('\n'), OUTPUT_TAIL_CHARS)
    // A timeout or a failure of the machine runs once more by itself before it gives up (the command is idempotent by contract); the second one
    // goes to a person through the hand-over of UD-269 (`onFailure`). It is not a failure of the change: Claude does not see it.
    const environment = isEnvironmentFailure(result, output)
    const firstTry = job.attempts < job.max_attempts
    if (result.timedOut) {
      saveRun(payload, job.id, { delivery_ms: ms, delivered: 0 })
      const timeoutError = Object.assign(new Error(`La entrega superó el tiempo máximo de ${Math.round(x.deliverTimeoutMs / 1000)} s.`), { code: 'deliver_timeout', output })
      timeoutError.retryable = firstTry
      throw timeoutError
    }
    // Exit 75: the host cannot deliver now. The job waits and tries again; the attempt is not spent and nothing is recorded yet.
    if (result.code === DELIVER_LATER) {
      // The same «not now» too many times in a row is a fault of the system, not a wait: the job fails as infrastructure (`deliver_env`), a person is told in one line
      // and the resume by worker version launches it again with the next deploy.
      const key = createHash('sha1').update(tail(output, 400)).digest('hex').slice(0, 16)
      const fresh = parseJson(get(db, 'SELECT payload_json FROM jobs WHERE id = ?', job.id)?.payload_json, payload)
      const streak = fresh.defer_streak?.key === key ? fresh.defer_streak.n + 1 : 1
      if (streak >= deferralsInARow(x.capacityWaitMs)) {
        saveRun(payload, job.id, { delivery_ms: ms, delivered: 0 })
        throw Object.assign(new Error(`La orden de entrega respondió «ahora no» ${streak} veces seguidas con el mismo motivo: ${tail(output, 600) || 'sin salida'}`), { code: 'deliver_env', output, stuck: true, retryable: false })
      }
      runSql(db, 'UPDATE jobs SET payload_json = ? WHERE id = ?', JSON.stringify({ ...fresh, defer_streak: { key, n: streak } }), job.id)
      throw new Deferred(x.capacityWaitMs, step('deliverWait'))
    }
    if (result.code === DELIVER_HELD && !payload.requested_by) {
      const reason = (referenceOf(result.stdout) ?? '').slice(0, REASON_CHARS)
      return () => {
        const closing = closingCaptures(db, { messageId, authorId: agent.id, stored: payload.captures, language: author?.language, label: 'proposal' }) // UD-275: what the branch looks like, for the person who reviews
        // A held delivery is a question to the person who decides in the area, in their tray and not «answered» (UD-269).
        const { replyId } = handOffToPerson({ db, events, now }, {
          messageId, agentId: agent.id, source: 'deliver', body: [heldBody({ output: payload.output, template, reason, language: author?.language, captures: closing.files.length > 0 }), ...closing.lines, ...(payload.captures_rejected?.length ? [noCaptureLine(payload.output, closing.files.length, author?.language, payload.captures_rejected)] : []), ...(payload.documents?.notes ?? [])].join('\n\n'), files: [...closing.files, ...(payload.documents?.files ?? [])]
        })
        const finalAt = now()
        const started = payload.execute_job_id ? get(db, 'SELECT started_at FROM execute_runs WHERE job_id = ? AND attempt = ?', payload.execute_job_id, payload.execute_attempt ?? 1)?.started_at : null
        saveRun(payload, job.id, {
          delivery_ms: ms, delivered: 0, delivery_held: 1, delivery_hold_reason: reason || null, ...(typeof started === 'number' ? { final_reply_ms: Math.max(0, finalAt - started) } : {})
        })
        events.publishForJob(job.id, { kind: 'progress', percent: 100, phrase: step('answered'), data: { message_id: messageId } })
        events.publishForJob(job.id, { kind: 'done', data: { status: 'done', message_id: String(messageId), reply_id: String(replyId), delivery_held: true } })
      }
    }
    if (result.code !== 0) {
      saveRun(payload, job.id, { delivery_ms: ms, delivered: 0 })
      const failure = Object.assign(new Error(`La orden de entrega terminó con código ${result.code}: ${tail(output, 1500) || 'sin salida'}`), { code: environment ? 'deliver_env' : 'deliver_failed', output })
      failure.retryable = environment && firstTry
      throw failure
    }
    return closeDelivered({ ref: referenceOf(result.stdout), after: result.after, ms })
  }

  /**
   * The text of a delivery that ended without reaching production, by what failed: the machine or the time limit twice, a lease that expired twice (the
   * service restarted), the verification of the change, or anything else of the system.
   */
  function failureText (messageId, branch, error) {
    const author = get(db, 'SELECT a.language FROM messages m JOIN members a ON a.id = m.author_id WHERE m.id = ?', messageId)
    const t = textsOf(author?.language)
    if (error?.code === 'lease_expired') return t.interrupted(branch)
    if (error?.stuck) return t.stuck(branch)
    if (error?.code === 'deliver_timeout' || error?.code === 'deliver_env') {
      const reason = error.code === 'deliver_timeout' ? `${Math.max(1, Math.round(x.deliverTimeoutMs / 60000))} min` : tail(String(error.output ?? ''), 160).replace(/\s+/g, ' ').trim() || 'sin salida'
      return t.environment(branch, reason)
    }
    return error?.code === 'deliver_failed' ? t.verification(branch, failedCheck(error.output, author?.language), error.budgetSpent === true) : t.system(branch)
  }

  /** UD-289: the notice of a failed delivery carries the `deliver` job that failed, so that «Reintentar» launches the delivery again (the same columns as UD-282). */
  const markFailure = (replyId, job, error) => runSql(db, 'UPDATE replies SET failed_job_id = ?, failed_code = ? WHERE id = ?', job.id, error?.code ?? 'system', replyId)

  /**
   * A delivery that ends without reaching production (the machine twice, the time limit, a lease that expired twice, a verification that failed again, anything
   * else) goes to the person who decides in the area (UD-269) with the reason in plain words, and nobody has to find it among the jobs: as «answered» and
   * assigned to the agent it reached nobody (2026-10-23, a `blocked` buried as answered). Returns false when there is nobody to hand it to or the message
   * is closed or gone.
   */
  function handOff (job, messageId, memberId, branch, error) {
    try {
      const body = failureText(messageId, branch, error)
      // Every failed attempt says so in the thread (UD-296): the same notice twice in a row was folded into the first one, and a retry that failed again left nothing to read.
      const { replyId, personId } = handOffToPerson({ db, events, now }, { messageId, agentId: memberId, body, source: 'deliver' })
      markFailure(replyId, job, error)
      return personId !== null
    } catch (e) {
      logger?.warn({ err: e }, 'could not hand the failed delivery to a person')
      return false
    }
  }

  /** With nobody to hand the message to, the agent still says in plain words that the work is not in production; a closed or deleted message has nobody to tell. */
  function tellTheAuthor (job, messageId, memberId, branch, error) {
    try {
      const body = failureText(messageId, branch, error)
      const { replyId } = addReply({ db, events, now }, { messageId, authorId: memberId, body, kind: 'answer' })
      markFailure(replyId, job, error)
    } catch {
      // The reply is a courtesy: if the message is closed or gone the failure is already in the job and in its events.
    }
  }

  return {
    maxRuntimeMs: x.deliverTimeoutMs + x.killGraceMs * 3, // the command's own timeout fires first and leaves room for the SIGKILL

    run: runJob,

    onDeferred (job, deferral) {
      const { message_id: messageId } = parseJson(job.payload_json, {})
      events.publishForJob(job.id, { kind: 'progress', percent: 0, phrase: deferral.phrase, data: { message_id: messageId } })
    },

    onFailure (job, error, outcome) {
      const payload = parseJson(job.payload_json, {})
      const { message_id: messageId, member_id: memberId } = payload
      if (outcome.state === 'requeued') {
        events.publishForJob(job.id, { kind: 'progress', percent: 0, phrase: step('retry', { n: job.attempts, total: job.max_attempts }), data: { message_id: messageId } })
        return
      }
      if (outcome.state !== 'failed') return
      const branch = payload.branch ?? `tp/${messageId}`
      const round = payload.round ?? 0
      // A failed verification is not an end (UD-298): it goes back to Claude, a new `execute` with the output of the delivery in its prompt, again after each
      // failure while the day's budget lasts (EXECUTE_DELIVER_RETRIES, when declared, caps the rounds). A timeout or a system failure has nothing for Claude to fix and is reported.
      let again = null
      const budgetSpent = dailyBudget(db, x, now()).remaining <= 0
      if (budgetSpent && error?.code === 'deliver_failed') error.budgetSpent = true
      if (error?.code === 'deliver_failed' && !budgetSpent && (x.deliverRetries === null || round < x.deliverRetries)) {
        try {
          again = events.transaction(() => {
            // UD-295: the checks stayed red after the light model's own attempt (the verification of the delivery is the measurement): the second pass runs on the area's escalation model.
            const ranWith = get(db, 'SELECT model FROM jobs WHERE id = ?', payload.execute_job_id)?.model ?? null
            const stronger = ranWith && ranWith === x.lightModel ? resolveExecuteModel(db, { messageId, fallback: x.model, light: x.lightModel, escalated: true }).model : null
            const escalate = stronger !== null && stronger !== ranWith
            const lang = get(db, 'SELECT m.language FROM messages x JOIN members m ON m.id = x.author_id WHERE x.id = ?', messageId)?.language
            const id = enqueueExecute(db, { messageId, memberId, extra: { deliver_failure: { output: error.output ?? '' }, deliver_round: round + 1, close_since: payload.close_since ?? null, ...(escalate ? { escalated: true, escalated_from: payload.execute_job_id, escalated_from_model: ranWith, escalated_note: '' } : {}) } })
            // UD-296: the delivery that goes back to Claude says so, with the check that fell: before, the thread showed nothing until the second delivery ended.
            if (id !== null) addReply({ db, events, now }, { messageId, authorId: memberId, kind: 'answer', body: textsOf(lang).again(failedCheck(error.output, lang)) })
            if (id !== null && escalate) {
              addReply({ db, events, now }, { messageId, authorId: memberId, kind: 'answer', body: lang === 'en' ? `${labelOfModel(ranWith)} did not close it: ${labelOfModel(stronger)} continued.` : `${labelOfModel(ranWith)} no cerró: siguió ${labelOfModel(stronger)}.` })
            }
            return id
          })
        } catch (e) {
          logger?.warn({ err: e }, 'could not enqueue the second pass after a failed delivery')
        }
      }
      if (again === null && !handOff(job, messageId, memberId, branch, error)) tellTheAuthor(job, messageId, memberId, branch, error)
      events.publishForJob(job.id, {
        kind: 'done',
        data: { status: 'failed', message_id: messageId ? String(messageId) : null, error: String(error?.message ?? error), error_code: error?.code ?? null, ...(again !== null ? { execute_job_id: String(again) } : {}) }
      })
    }
  }
}
