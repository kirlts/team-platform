// The `deliver` job (UD-263, MASTER-SPEC §7.3 and §7.5 «Ejecución»): the delivery to production as a job of its own, without AI and without a
// machine. `execute` ends at the push of the branch `tp/<message_id>`; when it ends with `outcome: done` it enqueues this job (an Editor can
// enqueue it with `POST /messages/:id/deliver`). The job runs EXECUTE_DELIVER_COMMAND, a shell command of the host, in the host of the worker:
//
//   placeholders  {message_id} {job_id} {branch} {workdir}   (shell-quoted; {workdir} is an empty directory removed afterwards)
//   exit 0        it is in production; the last stdout line is the reference (a commit, a URL or a label)
//   exit 75       it cannot be delivered now (EX_TEMPFAIL): the job waits EXECUTE_CAPACITY_WAIT_MS and tries again without spending its attempt
//   other exit    the delivery failed; its stdout and stderr are the reason
//   timeout       EXECUTE_DELIVER_TIMEOUT_MS; SIGTERM to the group the job started, then SIGKILL after EXECUTE_KILL_GRACE_MS
//   stdout lines  `##team phase verify` and `##team phase deploy` move the progress of the job (and the panel) to that phase
//
// The author gets ONE closing reply. In green: the `summary` of the session plus «Ya está en producción», the reference in the structured
// part. If the verification fails, an `execute` job runs once more (EXECUTE_DELIVER_RETRIES) with the output in its prompt; if it fails again,
// the reply is the plain notice that it did not pass, with `outcome: blocked`.

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { SpanStatusCode } from '@opentelemetry/api'
import { get, run as runSql } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { addReply } from '../domain/messages.js'
import { permanent } from '../domain/errors.js'
import { Deferred } from '../domain/pipeline.js'
import { step } from '../domain/progress-phrases.js'
import { withSpan } from '../telemetry/api.js'
import { updateExecuteRun } from '../telemetry/execute-runs.js'
import { enqueueExecute } from './enqueue.js'
import { replyBody } from './handler.js'
import { readTemplate } from './prompt.js'
import { fillCommand, spawnStreaming } from './runners.js'

export const DELIVER_LATER = 75 // EX_TEMPFAIL (sysexits.h): the host cannot deliver now
const PHASE_LINE = /^##team phase (verify|deploy)\s*$/
const PHASES = { verify: { code: 'deliverVerify', percent: 0 }, deploy: { code: 'deliverDeploy', percent: 50 } } // percent = finished phases over the two that exist
const OUTPUT_TAIL_CHARS = 6000 // declared courtesy: the end of the output is where a failure is; Claude reads this much in the second pass

const TEXTS = {
  'es-419': {
    production: 'Ya está en producción.',
    delivery: 'Entrega',
    verification: (branch) => `El cambio no pasó la verificación y todavía no está en producción. Lo que se hizo queda guardado en la rama ${branch}.\n\nUn Editor puede volver a lanzar la entrega.`,
    timeout: (branch, minutes) => `La entrega no terminó dentro del tiempo máximo (${minutes} min) y todavía no está en producción. Lo que se hizo queda guardado en la rama ${branch}.\n\nUn Editor puede volver a lanzar la entrega.`,
    system: (branch) => `No pude entregar este trabajo por un problema del sistema y todavía no está en producción. Lo que se hizo queda guardado en la rama ${branch}.\n\nUn Editor puede volver a lanzar la entrega.`
  },
  en: {
    production: 'It is in production now.',
    delivery: 'Delivery',
    verification: (branch) => `The change did not pass verification and is not in production yet. The work is saved on the branch ${branch}.\n\nAn Editor can launch the delivery again.`,
    timeout: (branch, minutes) => `The delivery did not finish within the time limit (${minutes} min) and is not in production yet. The work is saved on the branch ${branch}.\n\nAn Editor can launch the delivery again.`,
    system: (branch) => `I could not deliver this work because of a system problem and it is not in production yet. The work is saved on the branch ${branch}.\n\nAn Editor can launch the delivery again.`
  }
}
const textsOf = (language) => TEXTS[language] ?? TEXTS['es-419']

/** The summary with the production note at the end of its last paragraph (the reply keeps its two paragraphs). */
export function withProductionNote (summary, note) {
  const text = String(summary ?? '').trim()
  if (!text) return note
  return `${/[\p{L}\p{N}]$/u.test(text) ? `${text}.` : text} ${note}`
}

/** The closing reply of a delivery in green: the output of the session with the note, then its structured part and the reference under «Entrega». */
export function deliveredBody ({ output, template = null, ref = null, language }) {
  const t = textsOf(language)
  const base = output ?? {}
  return replyBody({ ...base, summary: withProductionNote(base.summary, t.production), ...(ref ? { delivery_ref: ref } : {}) }, template, { delivery_ref: t.delivery })
}

/** The last non-empty stdout line that is not a phase marker: the reference of the delivery. */
export function referenceOf (stdout) {
  const lines = String(stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('##team '))
  return lines.at(-1)?.slice(0, 500) ?? null // a reference is a commit, a URL or a label; 500 characters hold any of them
}

const tail = (text, chars) => (text.length > chars ? text.slice(-chars) : text)

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
        onPhase = ({ code, percent }) => { span.addEvent('deliver.phase', { 'team.phase': code }); setPhase(code, percent) }
        setPhase('deliverVerify', 0)
        const command = fillCommand(x.deliverCommand, { job_id: String(job.id), message_id: String(messageId), branch, workdir })
        const env = {
          ...process.env, TEAM_JOB_ID: String(job.id), TEAM_MESSAGE_ID: String(messageId), TEAM_BRANCH: branch, TEAM_WORKDIR: workdir,
          TEAM_DELIVER_ROUND: String(payload.round ?? 0), TEAM_DELIVER_ATTEMPT: String(job.attempts)
        }
        const r = await spawnStreaming('/bin/sh', ['-c', command], { env, keepStdout: true, onData, timeoutMs: x.deliverTimeoutMs, graceMs: x.killGraceMs, signal: ctx.signal })
        span.setAttributes({ 'team.exit_code': r.code ?? -1, 'team.delivery_ms': Math.max(0, now() - startedAt) })
        if (r.code !== 0 && r.code !== DELIVER_LATER) span.setStatus({ code: SpanStatusCode.ERROR, message: r.timedOut ? 'timeout' : `exit ${r.code}` })
        const ref = r.code === 0 ? referenceOf(r.stdout) : null
        if (ref) span.setAttribute('team.delivery_ref', ref)
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
    if (result.timedOut) {
      saveRun(payload, job.id, { delivery_ms: ms, delivered: 0 })
      throw Object.assign(permanent(`La entrega superó el tiempo máximo de ${Math.round(x.deliverTimeoutMs / 1000)} s.`, 'deliver_timeout'), { output })
    }
    // Exit 75: the host cannot deliver now. The job waits and tries again; the attempt is not spent and nothing is recorded yet.
    if (result.code === DELIVER_LATER) throw new Deferred(x.capacityWaitMs, step('deliverWait'))
    if (result.code !== 0) {
      saveRun(payload, job.id, { delivery_ms: ms, delivered: 0 })
      throw Object.assign(permanent(`La orden de entrega terminó con código ${result.code}: ${tail(output, 1500) || 'sin salida'}`, 'deliver_failed'), { output })
    }
    const ref = referenceOf(result.stdout)

    return () => {
      // Inside the transaction that closes the job: the one closing reply, then the end of the progress.
      const { replyId } = addReply({ db, events, now }, {
        messageId, authorId: agent.id, kind: 'answer', body: deliveredBody({ output: payload.output, template, ref, language: author?.language })
      })
      const finalAt = now()
      const started = payload.execute_job_id ? get(db, 'SELECT started_at FROM execute_runs WHERE job_id = ? AND attempt = ?', payload.execute_job_id, payload.execute_attempt ?? 1)?.started_at : null
      saveRun(payload, job.id, {
        delivery_ms: ms, delivered: 1, delivery_ref: ref, ...(typeof started === 'number' ? { final_reply_ms: Math.max(0, finalAt - started) } : {})
      })
      events.publishForJob(job.id, { kind: 'progress', percent: 100, phrase: step('answered'), data: { message_id: messageId } })
      events.publishForJob(job.id, { kind: 'done', data: { status: 'done', message_id: String(messageId), reply_id: String(replyId), delivery_ref: ref } })
    }
  }

  /** Tells the author in plain words that the work is not in production; a closed or deleted message has nobody to tell. */
  function tellTheAuthor (messageId, memberId, branch, error) {
    try {
      const author = get(db, 'SELECT a.language FROM messages m JOIN members a ON a.id = m.author_id WHERE m.id = ?', messageId)
      const t = textsOf(author?.language)
      const reason = error?.code === 'deliver_failed' ? t.verification(branch)
        : error?.code === 'deliver_timeout' ? t.timeout(branch, Math.max(1, Math.round(x.deliverTimeoutMs / 60000)))
          : t.system(branch)
      addReply({ db, events, now }, { messageId, authorId: memberId, body: `${reason}\n\n**Resultado**: blocked`, kind: 'answer' })
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
      // A failed verification goes back to Claude once: a new `execute` with the output of the delivery in its prompt. A delivery an Editor
      // launched by hand, a timeout or a system failure has nothing for Claude to fix and is reported.
      let again = null
      if (error?.code === 'deliver_failed' && !payload.requested_by && round < x.deliverRetries) {
        try {
          again = events.transaction(() => enqueueExecute(db, { messageId, memberId, extra: { deliver_failure: { output: error.output ?? '' }, deliver_round: round + 1 } }))
        } catch (e) {
          logger?.warn({ err: e }, 'could not enqueue the second pass after a failed delivery')
        }
      }
      if (again === null) tellTheAuthor(messageId, memberId, branch, error)
      events.publishForJob(job.id, {
        kind: 'done',
        data: { status: 'failed', message_id: messageId ? String(messageId) : null, error: String(error?.message ?? error), error_code: error?.code ?? null, ...(again !== null ? { execute_job_id: String(again) } : {}) }
      })
    }
  }
}
