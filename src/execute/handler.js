// The `execute` job (UD-254, UD-255, MS §7.5 «Ejecución»): an unattended Claude Code session works a message assigned to
// an agent member. The session sends its first reply itself with `team reply`; the `result` line of its NDJSON closes the
// job: a valid `structured_output` becomes the closing reply (its `summary`, then the rest of the declared output); no
// structured output, an error result or an invalid one fail the job with the reason. `session_id` and `total_cost_usd`
// stay on the `execute` span of the job's trace.
//
// With EXECUTE_DELIVER_COMMAND declared (UD-263) the session ends at the push of the branch: when the output says `outcome: done` and the
// branch exists, the closing reply is not posted yet. The job enqueues a `deliver` job (src/execute/deliver.js) that carries the output and
// posts the one closing reply when the delivery ends. Without the command everything above stays as it was.

import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import Ajv from 'ajv'
import { get, run as runSql } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { infra, permanent } from '../domain/errors.js'
import { Deferred } from '../domain/pipeline.js'
import { addReply, closeMessage } from '../domain/messages.js'
import { HANDOFF_OUTCOMES, alreadyHandedOver, handOffToPerson } from '../domain/escalation.js'
import { step } from '../domain/progress-phrases.js'
import { getProject } from '../domain/settings.js'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { currentTraceparent, recordGenAiCall, withSpan } from '../telemetry/api.js'
import { instanceLabel, recordExecuteRun, updateExecuteRun } from '../telemetry/execute-runs.js'
import { readAgentSecret } from './agent-credentials.js'
import { capturesDir, capturesEnv, closingCaptures, storeCaptures } from './captures.js'
import { decisionCheckProblem, decisionLines } from './decision-check.js'
import { buildExecuteParts, buildExecutePrompt, declaredOutput, finalSchema, readTemplate } from './prompt.js'
import { closeLine, closeReason, closeRequest, firstReplyAnchor } from './auto-close.js'
import { enqueueDeliver } from './enqueue.js'
import { runLocal, runMachine } from './runners.js'
import { createSessionTracer } from './session-spans.js'
import { createStreamReader } from './stream.js'

const run = promisify(execFile)
const TEAM_SCRIPT = fileURLToPath(new URL('../../scripts/team.mjs', import.meta.url))
const PROVIDER = 'claude-code'
const STDERR_TAIL_CHARS = 600 // declared courtesy: the cause of a process that fails is at the END of its stderr (the start is ssh and useradd noise); enough for the last lines, short enough for `last_error`

/**
 * The end of a process's stderr for an error message: the last non-empty lines that fit in `chars` (a single longer line keeps its end). The start of the
 * stderr of a machine is `ssh` and `useradd` warnings; the reason is the last thing it printed (2026-10-24, job 132 failed with code 1 and the reason was cut off).
 */
export function stderrTail (text, chars = STDERR_TAIL_CHARS) {
  const lines = String(text ?? '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '')
  const kept = []
  let size = 0
  for (const line of lines.reverse()) {
    const add = line.length + (kept.length ? 1 : 0)
    if (size + add > chars) { if (kept.length === 0) kept.push(line.slice(-chars)); break }
    kept.push(line)
    size += add
  }
  return kept.reverse().join('\n')
}

/** Start of the server's local day (TZ; UTC when unset) that contains `t`, and the start of the next one. */
export function localDay (t) {
  const start = new Date(t)
  start.setHours(0, 0, 0, 0)
  const next = new Date(start)
  next.setDate(next.getDate() + 1)
  return { start: start.getTime(), next: next.getTime() }
}

/**
 * The daily spend cap (UD-256): what the `execute` jobs that ran today cost (`jobs.cost_usd`) plus the fixed cost of
 * each one that ran on a machine. A job counts on the day it started (`jobs.run_at` of its last attempt).
 */
export function dailyBudget (db, x, t) {
  const { start, next } = localDay(t)
  const row = get(db, "SELECT COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(runner = 'machine'), 0) AS machines FROM jobs WHERE kind = 'execute' AND runner IS NOT NULL AND run_at >= ? AND run_at < ?", start, next)
  const spent = row.cost + row.machines * x.machineCostUsd
  return { spent, remaining: x.dailyBudgetUsd - spent, nextDayMs: next - t }
}

/** Where a machine finds the stable part of the prompt: run.sh replaces this marker with its own job directory. */
export const SYSTEM_FILE_ON_MACHINE = '@JOB_DIR@/system.md'

/** The arguments of `claude -p` (UD-255). */
export function claudeArgs (x, schema) {
  return [
    '-p',
    '--model', x.model,
    '--effort', x.effort, // `claude --help` 2.1.284: «--effort <level> Effort level for the current session (low, medium, high, xhigh, max)»
    '--max-budget-usd', String(x.budgetUsd ?? x.maxBudgetUsd),
    '--max-turns', String(x.maxTurns),
    '--permission-mode', 'bypassPermissions',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--json-schema', JSON.stringify(schema)
  ]
}

/**
 * Renders the rest of the structured output (everything but `summary`) under the summary, each entry with the label the
 * template declares (`outcome` as «Resultado», as the panel shows it).
 */
export function replyBody (output, template = null, extraLabels = {}) {
  const { summary, captures: _captures, decision_check: _check, close: _close, close_reason: _closeReason, ...rest } = output // the screenshots travel as attachments (UD-268); the check is shown as the question (UD-269); the close request is read by the system (UD-271) and shows as one line
  const labels = { outcome: 'Resultado', ...Object.fromEntries((template?.output ?? []).map((e) => [e.name, e.label ?? e.name])), ...extraLabels }
  const lines = Object.entries(rest).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `**${labels[k] ?? k}**: ${typeof v === 'string' ? v : `\n\n\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\``}`)
  return lines.length ? `${summary.trim()}\n\n${lines.join('\n\n')}` : summary.trim()
}

// What the people read when a job fails. Plain words, never the internal code; `config` carries the reason of a refusal to start (it is already a plain sentence).
const FAILURE_TEXTS = {
  'es-419': {
    saved: 'Todavía no está en producción. Lo que alcancé a hacer queda guardado en la rama del mensaje.',
    again: 'Quien reciba este mensaje puede volver a lanzarlo desde la ficha.',
    editor: 'Un Editor puede volver a lanzarlo desde la ficha del mensaje.',
    interrupted: 'La sesión se interrumpió antes de terminar, dos veces seguidas (el servicio se reinició o se perdió la máquina de trabajo).',
    timeout: (minutes) => `No alcancé a terminar dentro del tiempo máximo (${minutes} min) y la sesión se cerró.`,
    budget: 'Se alcanzó el tope de gasto antes de terminar.',
    turns: 'La sesión llegó al máximo de pasos antes de terminar.',
    format: 'La sesión terminó, pero su resultado no tenía el formato pedido.',
    infra: 'No pude terminar este trabajo por un problema del sistema (la máquina de trabajo, la conexión o el servicio del modelo), dos veces seguidas.',
    system: 'No pude terminar este trabajo por un problema del sistema.',
    config: (reason) => `No pude empezar este trabajo: ${reason}`,
    budgetWait: (time) => `En espera: se alcanzó el tope de gasto de hoy. Sigue mañana a las ${time}.`,
    edited: 'El mensaje se editó mientras trabajaba, así que esta respuesta puede no corresponder al texto de ahora. No se entregó a producción; lo hecho queda guardado en la rama.'
  },
  en: {
    saved: 'It is not in production yet. What I got done is saved on the branch of the message.',
    again: 'Whoever receives this message can launch it again from its page.',
    editor: 'An Editor can launch it again from the page of the message.',
    interrupted: 'The session was interrupted before it finished, twice in a row (the service restarted or the work machine was lost).',
    timeout: (minutes) => `I could not finish within the time limit (${minutes} min) and the session was closed.`,
    budget: 'The spending limit was reached before it finished.',
    turns: 'The session reached its maximum number of steps before it finished.',
    format: 'The session finished, but its result did not have the format asked for.',
    infra: 'I could not finish this work because of a system problem (the work machine, the connection or the model service), twice in a row.',
    system: 'I could not finish this work because of a system problem.',
    config: (reason) => `I could not start this work: ${reason}`,
    budgetWait: (time) => `Waiting: today's spending limit was reached. It continues tomorrow at ${time}.`,
    edited: 'The message was edited while I worked, so this answer may not match its current text. It was not delivered to production; the work is saved on the branch.'
  }
}
// The kind of text of each error code of the job; a code that is not here reads as `system`.
const FAILURE_KIND = {
  lease_expired: 'interrupted', execute_timeout: 'timeout', execute_budget: 'budget', execute_max_turns: 'turns', invalid_output: 'format',
  execute_no_result: 'infra', machine_create_failed: 'infra', execute_api_error: 'infra', execute_flag_rejected: 'infra',
  account_inactive: 'config', agent_secret_missing: 'config', not_an_agent: 'config', template: 'config', host_instructions_missing: 'config', harness_unavailable: 'config'
}
// A `result` line that says the model service or the connection failed (claude -p ends with it after its own retries): the session did nothing a second try would repeat.
const API_FAILURE = /\b(429|5\d\d)\b|overloaded|rate.?limit|too many requests|service unavailable|bad gateway|gateway time-?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|connection (error|reset|refused)|timed out/i
// What a `claude` that does not know a flag of the invocation prints before it exits with no event.
const FLAG_REJECTED = /unknown (option|argument)|unrecognized (option|argument)|append-system-prompt-file/i

/** The text of a failure for its reader: the reason, where the work is and who can launch it again. */
export function failureBody (error, language, { timeoutMs = 0 } = {}) {
  const t = FAILURE_TEXTS[language] ?? FAILURE_TEXTS['es-419']
  const kind = FAILURE_KIND[error?.code] ?? 'system'
  const reason = kind === 'timeout' ? t.timeout(Math.max(1, Math.round(timeoutMs / 60000))) : kind === 'config' ? t.config(String(error?.message ?? '').trim()) : t[kind]
  const saved = kind === 'config' ? '' : ` ${t.saved}`
  return `${reason}${saved}\n\n${t.again}\n\n**Resultado**: blocked`
}

const fingerprint = (m) => JSON.stringify([m.title, m.body, m.fields_json, m.area_id, m.template_id])

export function createExecuteHandler ({ db, config, queue, events, vault, logger = null, now = Date.now }) {
  const x = config.execute
  const ajv = new Ajv({ allErrors: true, strict: false })

  async function prepareWorkdir (job, messageId, resume = false) {
    const root = x.workRoot || config.tmpDir
    await mkdir(root, { recursive: true })
    const workdir = await mkdtemp(join(root, `execute-${job.id}-`))
    try {
      await mkdir(join(workdir, 'bin'))
      // `team` in the session's PATH: the standalone script next to a shim, so a machine gets it with the job dir.
      await copyFile(TEAM_SCRIPT, join(workdir, 'bin', 'team.mjs'))
      await writeFile(join(workdir, 'bin', 'team'), '#!/bin/sh\nexec node "$(dirname "$0")/team.mjs" "$@"\n', { mode: 0o755 })
      let cwd = workdir
      let worktree = null
      if (x.runner === 'local' && x.repoDir) {
        worktree = join(workdir, 'repo')
        await releaseBranch(root, `tp/${messageId}`)
        // A second pass after a failed delivery continues from the branch the first one left; a first pass starts it from HEAD.
        await run('git', ['-C', x.repoDir, 'worktree', 'add', ...(resume ? [worktree, `tp/${messageId}`] : ['-B', `tp/${messageId}`, worktree])])
        cwd = worktree
      }
      return { workdir, cwd, worktree }
    } catch (error) {
      await rm(workdir, { recursive: true, force: true }) // nothing else will: the job has not got its directories yet
      throw error
    }
  }

  /**
   * The previous attempt of the job died with its worker and left a worktree on the branch of the message (the directory of that attempt, inside the work
   * root): git refuses to check the branch out twice, and every later attempt failed with «already checked out». Only worktrees this handler made
   * (`execute-<job>-…/repo` under the work root) are removed.
   */
  async function releaseBranch (root, branch) {
    try {
      const { stdout } = await run('git', ['-C', x.repoDir, 'worktree', 'list', '--porcelain'])
      for (const entry of stdout.split('\n\n')) {
        const path = /^worktree (.+)$/m.exec(entry)?.[1]
        if (!path || !entry.includes(`branch refs/heads/${branch}`)) continue
        if (!path.startsWith(`${root}/execute-`) || !path.endsWith('/repo')) continue
        await run('git', ['-C', x.repoDir, 'worktree', 'remove', '--force', path]).catch(() => {})
        await rm(join(path, '..'), { recursive: true, force: true })
      }
      await run('git', ['-C', x.repoDir, 'worktree', 'prune'])
    } catch (e) { logger?.warn({ err: e }, 'could not release the branch of the message from an old worktree') }
  }

  async function cleanup ({ workdir, worktree }) {
    // The branch stays for a person to deliver (UD-254 point 6); only the worktree and the job dir go.
    if (worktree) await run('git', ['-C', x.repoDir, 'worktree', 'remove', '--force', worktree]).catch((e) => logger?.warn({ err: e }, 'could not remove the execute worktree'))
    await rm(workdir, { recursive: true, force: true })
  }

  /**
   * Whether the branch of the job exists, so a delivery has something to deliver. With the host repository here (EXECUTE_REPO_DIR) it is
   * looked up locally and then on `origin`; without it the delivery command is the one that finds the branch and says if it is missing.
   */
  async function branchExists (branch) {
    if (!x.repoDir) return true
    const git = (...args) => run('git', ['-C', x.repoDir, ...args], { timeout: x.deliverTimeoutMs })
    try { await git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`); return true } catch { /* not a local branch */ }
    try { await git('ls-remote', '--exit-code', '--heads', 'origin', branch); return true } catch { return false }
  }

  const liveMachines = new Set() // the jobs of this process that hold a machine; EXECUTE_MAX_MACHINES bounds it
  // What each session that runs now may still spend: `--max-budget-usd` of its invocation. The day's cost counts a job only when its result arrives, so
  // eight sessions that start together each saw the whole remainder and could spend eight times the day's cap (UD-256).
  const reserved = new Map()

  /** The row of `execute_runs` for an attempt (UD-262). Measuring never fails the job. */
  function saveRun (job, ctx, rec) {
    try {
      const { message_id: messageId } = parseJson(job.payload_json, {})
      const end = now()
      const result = rec.result
      const marks = parseJson(get(db, 'SELECT marks_json FROM jobs WHERE id = ?', job.id)?.marks_json, {}) ?? {}
      const reason = ctx.signal.aborted ? ctx.signal.reason : null
      const failed = rec.error !== undefined
      const aborted = failed && (reason === 'lost' || reason === 'shutdown')
      const errorCode = !failed ? null : (typeof rec.error === 'string' ? rec.error : (rec.error?.code ?? (reason ? String(reason) : (rec.error?.name ?? 'error'))))
      const models = Object.keys(result?.modelUsage ?? {})
      const s = rec.session
      const u = result?.usage ?? {}
      const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      const phaseMs = rec.phaseMs
      recordExecuteRun(db, {
        job_id: job.id, attempt: job.attempts, message_id: messageId ?? null, instance: instanceLabel(config),
        trace_id: job.trace_id ?? null, session_id: rec.st?.sessionId ?? null,
        model: models.length ? models.join(',') : x.model, runner: x.runner, machine: rec.r?.machine ?? null,
        started_at: rec.startedAt, finished_at: end,
        queue_wait_ms: Math.max(0, rec.startedAt - job.created_at),
        first_reply_ms: rec.firstReplyAt === null ? null : Math.max(0, rec.firstReplyAt - rec.startedAt),
        final_reply_ms: null, total_ms: Math.max(0, end - rec.startedAt),
        create_ms: phaseMs.create ?? null, run_ms: phaseMs.run ?? null, destroy_ms: phaseMs.destroy ?? null,
        tools_ms: s ? s.tools_ms : null,
        judge_ms: marks.judge_ms ?? null, delivery_ms: marks.delivery_ms ?? null, wait_ms: marks.wait_ms ?? null,
        input_tokens: result ? input : (s?.input_tokens ?? null), output_tokens: result ? (u.output_tokens ?? 0) : (s?.output_tokens ?? null),
        cache_read_tokens: result ? (u.cache_read_input_tokens ?? 0) : (s?.cache_read_tokens ?? null),
        cache_write_tokens: result ? (u.cache_creation_input_tokens ?? 0) : (s?.cache_write_tokens ?? null),
        cost_usd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
        turns: rec.st?.turns ?? null, tool_count: s?.tools ?? null, subagent_count: s?.subagents ?? null,
        outcome: aborted ? 'aborted' : (failed ? 'failed' : (typeof result?.structured_output?.outcome === 'string' ? result.structured_output.outcome : null)),
        error_code: errorCode, delivered: marks.delivered ?? null,
        transcript_ref: rec.r?.collect?.ref ?? null, slowest_tools: s?.slowest ?? []
      })
    } catch (error) {
      logger?.warn({ err: error }, 'could not record the execute run')
    }
  }

  async function runJob (job, ctx, rec) {
    const payload = parseJson(job.payload_json, {})
    const { message_id: messageId, member_id: memberId } = payload
    const deliverFailure = payload.deliver_failure ?? null // set when this pass follows a delivery that failed (UD-263)
    const jobSpan = trace.getActiveSpan() // the `job` span of this attempt: `reply.start` and `reply.final` are events on it (UD-262)
    const startedAt = rec.startedAt
    const msSince = (t) => Math.max(0, t - startedAt)
    const message = get(db, `SELECT m.*, a.title AS area_title FROM messages m JOIN areas a ON a.id = m.area_id WHERE m.id = ? AND m.deleted_at IS NULL`, messageId)
    if (!message) throw permanent('El mensaje del trabajo ya no existe.', 'message_missing')
    const agent = get(db, 'SELECT id, email, name, kind, profile, language, active FROM members WHERE id = ?', memberId)
    if (!agent || agent.kind !== 'agent') throw permanent('El miembro del trabajo no es un agente.', 'not_an_agent')
    if (agent.active !== 1) throw permanent('El agente está desactivado.', 'account_inactive')
    if (message.status === 'closed') throw permanent('El mensaje está cerrado.', 'message_closed')
    const secret = readAgentSecret(db, vault, agent.id)
    if (!secret) throw permanent('El agente no tiene secreto propio; un Editor debe crearlo de nuevo.', 'agent_secret_missing')
    const author = get(db, 'SELECT id, name, profile, language FROM members WHERE id = ?', message.author_id)
    const templateRow = message.template_id ? get(db, 'SELECT id, name, body_markdown FROM templates WHERE id = ?', message.template_id) : null
    const template = readTemplate(templateRow)
    let declared
    try { declared = declaredOutput(template) } catch (error) { throw permanent(`La salida declarada de la plantilla no compila: ${error.message}`, 'template') }
    const schema = finalSchema(declared.grammar, { autoClose: x.autoClose })
    const validate = ajv.compile(finalSchema(declared.validation, { validation: true, autoClose: x.autoClose }))
    let hostInstructions = ''
    if (x.hostInstructions) {
      try { hostInstructions = await readFile(x.hostInstructions, 'utf8') } catch (error) {
        throw permanent(`No se pudo leer EXECUTE_HOST_INSTRUCTIONS (${x.hostInstructions}): ${error.code ?? error.message}`, 'host_instructions_missing')
      }
    }

    const branch = `tp/${messageId}`
    const startedWith = fingerprint(message) // what the session was asked; an edit while it works makes its answer a possible answer to the old text
    const promptInput = {
      message: { id: messageId, title: message.title, body: message.body, fields: parseJson(message.fields_json, {}), area: message.area_title, status: message.status },
      template: templateRow, author, agent, project: getProject(db, config), jobId: job.id, maxSubagents: x.maxSubagents, branch, hostInstructions,
      deliver: Boolean(x.deliverCommand), deliverFailure, autoClose: x.autoClose,
      // A retry after a failure of the system: the first attempt may have sent the first reply already, and a second one repeats «Recibido» in the thread.
      retried: job.attempts > 1 && Boolean(get(db, 'SELECT 1 AS ok FROM replies WHERE message_id = ? AND author_id = ? AND created_at >= ? AND deleted_at IS NULL', messageId, memberId, job.created_at))
    }
    // The anchor of «a person replied after the first reply of the agent»: the one a previous pass of this message already fixed, else the first reply since this job was created.
    const closeSince = (j, mId, agId, p) => p.close_since ?? firstReplyAnchor(db, { messageId: mId, agentId: agId, from: j.created_at })
    const parts = buildExecuteParts(promptInput)
    // Measurement 2026-10-23-tokens-y-cache.md: with EXECUTE_STABLE_AS_SYSTEM the stable part travels as an appended system prompt and the user message holds the rest.
    // A previous attempt found that the binary does not know the flag of the system prompt: this one carries the whole prompt in the message (payload `no_stable_system`).
    const stable = x.stableAsSystem && payload.no_stable_system !== true
    const prompt = stable ? parts.variable : buildExecutePrompt(promptInput)
    // The host's machine quota is a fact of the host (2026-10-22: a region of 8 cores held two machines of 4 and 21 jobs failed for good with
    // «quota exceeded»). Over EXECUTE_MAX_MACHINES the job waits, without spending its attempt and without cost.
    // The slot is taken in the same tick as the check: two jobs that start together cannot both pass it. `run` releases it on any exit.
    if (x.runner === 'machine') {
      if (x.maxMachines > 0 && liveMachines.size >= x.maxMachines) throw new Deferred(x.capacityWaitMs, step('capacityWait'))
      liveMachines.add(job.id)
    }
    // UD-256: the day's spend first; with nothing left the job waits for the next day without spending its attempt.
    const budget = dailyBudget(db, x, now())
    if (budget.remaining <= 0) {
      noticeBudgetWait(job, messageId, now() + budget.nextDayMs)
      throw new Deferred(budget.nextDayMs, step('budgetWait'))
    }
    const available = budget.remaining - [...reserved.values()].reduce((a, b) => a + b, 0)
    if (available < 0.01) throw new Deferred(x.capacityWaitMs, step('budgetWait')) // what is left is held by sessions that run now: it may come back when they end
    const budgetUsd = Math.round(Math.min(x.maxBudgetUsd, available) * 100) / 100 || 0.01
    reserved.set(job.id, budgetUsd)
    const args = claudeArgs({ ...x, budgetUsd }, schema)
    // It counts as run from here: the machine cost applies even if the session never returns its cost.
    runSql(db, 'UPDATE jobs SET runner = ?, run_at = ?, marks_json = NULL WHERE id = ?', x.runner, now(), job.id)
    rec.began = true

    let session = null // spans of the tools and subagents, alive while the `run` phase is
    const reader = createStreamReader({
      maxTurns: x.maxTurns,
      onEvent: (event) => session?.onEvent(event),
      onProgress: (percent, phrase) => { if (!queue.progress(job, percent, phrase)) ctx.abort('lost') }
    })
    queue.progress(job, 0, x.runner === 'machine' ? 'Creando la máquina' : 'Preparando la sesión')

    const dirs = await prepareWorkdir(job, messageId, deliverFailure !== null)
    const teamUrl = x.teamUrl || `http://127.0.0.1:${config.port}`
    const sessionEnv = {
      TEAM_URL: teamUrl, TEAM_API_PREFIX: config.apiPrefix, TEAM_AGENT_EMAIL: agent.email, TEAM_AGENT_SECRET: secret,
      TEAM_JOB_ID: String(job.id), TEAM_MESSAGE_ID: String(messageId), TEAM_BRANCH: branch, ...capturesEnv(config, dirs.workdir, author?.language)
    }
    // One span per real phase of the job; `jobs.phase` says which one is running (the queue shows it).
    const kind = x.runner === 'machine' ? 'machine' : 'local'
    const setPhase = (name) => { try { runSql(db, 'UPDATE jobs SET phase = ? WHERE id = ?', name, job.id) } catch { /* the label is a courtesy */ } }
    const phase = (name, fn) => withSpan(`execute.${kind}.${name}`, { 'team.step': `execute.${kind}.${name}`, 'team.runner': x.runner }, async (span) => {
      setPhase(name)
      const phaseStart = now()
      if (name === 'run') session = createSessionTracer({ model: x.model })
      try {
        const r = await fn()
        if (r && typeof r === 'object' && 'code' in r) {
          span.setAttribute('team.exit_code', r.code ?? -1)
          if (r.code !== 0 && name !== 'run') span.setStatus({ code: SpanStatusCode.ERROR, message: `exit ${r.code}` })
        }
        return r
      } finally {
        if (name === 'run') { rec.session = session?.finish(span) ?? null; session = null }
        rec.phaseMs[name] = Math.max(0, now() - phaseStart)
      }
    })
    let outcome
    if (x.runner === 'machine') liveMachines.add(job.id)
    try {
      // After `dirs` exists: the file goes in the job directory (inside the `try`: a full disk here must still remove the directory).
      if (stable) {
        await writeFile(join(dirs.workdir, 'system.md'), parts.stable)
        args.push('--append-system-prompt-file', x.runner === 'machine' ? SYSTEM_FILE_ON_MACHINE : join(dirs.workdir, 'system.md'))
      }
      outcome = await withSpan('execute', {
        'team.step': 'execute', 'team.message_id': String(messageId), 'team.member_id': String(memberId),
        'team.runner': x.runner, 'team.model': x.model, 'team.effort': x.effort, 'team.max_budget_usd': budgetUsd, 'team.daily_spent_usd': budget.spent
      }, async (span) => {
        span.setAttribute('team.queue_wait_ms', Math.max(0, startedAt - job.created_at))
        await mkdir(capturesDir(dirs.workdir)) // where the session leaves its screenshots (UD-268); here and not in prepareWorkdir, so the check of EXECUTE_MAX_MACHINES keeps its timing
        // The session continues this trace (W3C `TRACEPARENT`) and, when the host declares it, exports its own telemetry (EXECUTE_OTEL_ENV).
        const tracedEnv = { ...(x.sessionEnv ?? {}), ...(x.otelEnv ?? {}), ...(currentTraceparent() ? { TRACEPARENT: currentTraceparent() } : {}) }
        // A line that cannot be turned into progress (the job was purged, the database is busy) must not become an uncaught exception of the worker: the session goes on.
        const opts = { config, args, prompt, onData: (c) => { try { reader.push(c) } catch (e) { logger?.warn({ err: e }, 'could not record the progress of the session') } }, signal: ctx.signal }
        const r = x.runner === 'machine'
          ? await runMachine({ ...opts, jobId: job.id, workdir: dirs.workdir, env: { ...sessionEnv, ...tracedEnv }, log: (m) => logger?.error(m), phase })
          : await phase('run', () => runLocal({ ...opts, cwd: dirs.cwd, env: { ...process.env, ...sessionEnv, ...tracedEnv, PATH: `${join(dirs.workdir, 'bin')}:${process.env.PATH ?? ''}` } }))
        reader.end()
        setPhase(null)
        const firstReply = get(db, 'SELECT MIN(created_at) AS at FROM replies WHERE message_id = ? AND author_id = ? AND created_at >= ?', messageId, memberId, startedAt)?.at
        if (firstReply) jobSpan?.addEvent('reply.start', { 'team.ms_since_job_start': msSince(firstReply), 'team.ms_since_message': Math.max(0, firstReply - message.created_at) }, firstReply)
        const st = reader.state()
        const result = st.result
        Object.assign(rec, { r, st, result, firstReplyAt: firstReply ?? null })
        span.setAttributes({ 'team.exit_code': r.code ?? -1, 'team.turns': st.turns, 'team.ndjson_lines': st.lines, 'team.ndjson_invalid': st.invalid })
        if (st.sessionId) span.setAttribute('team.session_id', st.sessionId)
        if (r.machine) span.setAttribute('team.machine', r.machine)
        if (r.destroy) span.setAttribute('team.machine_destroyed', r.destroy.code === 0)
        if (result) {
          const u = result.usage ?? {}
          const models = Object.keys(result.modelUsage ?? {})
          recordGenAiCall(span, {
            provider: PROVIDER,
            model: models.length === 1 ? models[0] : (models.join(',') || x.model),
            request: { messages: [{ role: 'user', content: prompt }], effort: x.effort },
            response: { text: JSON.stringify(result.structured_output ?? result.result ?? null), model: models[0] ?? x.model, stop_reason: result.stop_reason, duration_ms: result.duration_ms },
            usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cached_tokens: u.cache_read_input_tokens ?? 0, cache_creation_tokens: u.cache_creation_input_tokens ?? 0 },
            cost: result.total_cost_usd ?? null
          })
          if (typeof result.total_cost_usd === 'number') {
            span.setAttribute('team.cost_usd', result.total_cost_usd)
            runSql(db, 'UPDATE jobs SET cost_usd = COALESCE(cost_usd, 0) + ? WHERE id = ?', result.total_cost_usd, job.id) // UD-256, also when the job fails after; it adds up: the second try of a job must not erase what the first one spent
          }
        }
        // UD-268: the screenshots are stored while the job directory exists; the closing reply attaches them when it is posted.
        let captured = { stored: [], rejected: [] }
        try { captured = await storeCaptures({ config, output: result?.structured_output, workdir: dirs.workdir }) } catch (error) { logger?.warn({ err: error }, 'could not store the captures') }
        for (const c of captured.rejected) span.addEvent('captures.rejected', { 'team.capture_index': c.index, 'team.capture_reason': c.reason })
        if (captured.stored.length) span.setAttribute('team.captures', captured.stored.length)
        return { r, st, result, captured }
      })
    } finally {
      liveMachines.delete(job.id)
      await cleanup(dirs)
    }
    ctx.signal.throwIfAborted()
    const { r, result, captured } = outcome
    if (r.timedOut) throw permanent(`La sesión superó el tiempo máximo de ${Math.round(x.timeoutMs / 1000)} s.`, 'execute_timeout')
    if (r.spawnError?.code === 'ENOENT') throw permanent(`No se encontró «${x.runner === 'machine' ? '/bin/sh' : x.bin}» (EXECUTE_CLAUDE_BIN).`, 'harness_unavailable')
    // EXECUTE_MACHINE_CREATE exits 75 (EX_TEMPFAIL) when the host has no capacity now (quota, no free machine): the job waits and tries again.
    if (r.phase === 'create' && r.code === 75) {
      runSql(db, 'UPDATE jobs SET runner = NULL WHERE id = ?', job.id)
      rec.began = false
      throw new Deferred(x.capacityWaitMs, step('capacityWait'))
    }
    // From here a failure is told apart by what it says about the infrastructure: a machine that was not created, a session that died with no result and a
    // model service that failed are tried once more (`infra`) and then go to a person; the budget, the format and the rest are not a second try's to fix.
    const retryAfterMs = x.infraRetryWaitMs
    if (r.phase === 'create') throw infra(`La orden que crea la máquina terminó con código ${r.code}: ${stderrTail(r.stderr) || 'sin mensaje'}`, 'machine_create_failed', { retryAfterMs })
    if (!result) {
      const never = outcome.st.sessionId === null && outcome.st.lines === 0 // not one event: the binary did not start the session
      const detail = `claude -p terminó con código ${r.code}${r.signal ? ` (señal ${r.signal})` : ''} sin línea «result»: ${stderrTail(r.stderr) || 'sin mensaje'}`
      if (stable && never && FLAG_REJECTED.test(r.stderr)) {
        // 2026-10-23: EXECUTE_STABLE_AS_SYSTEM was on before the `claude` of the image knew `--append-system-prompt-file`, and every job failed in 0.07 s.
        // The next attempt sends the prompt whole; the variable can be on before or after the image and no job is lost.
        runSql(db, "UPDATE jobs SET payload_json = json_set(payload_json, '$.no_stable_system', json('true')) WHERE id = ?", job.id)
        throw infra(detail, 'execute_flag_rejected')
      }
      throw infra(detail, 'execute_no_result', { retryAfterMs })
    }
    if (result.is_error) {
      const text = String(result.result ?? '')
      const detail = `claude -p informó un error (${result.subtype ?? 'sin subtipo'}): ${text.slice(0, 300)}`
      if (result.subtype === 'error_max_budget_usd') throw permanent(detail, 'execute_budget')
      if (result.subtype === 'error_max_turns') throw permanent(detail, 'execute_max_turns')
      if (result.subtype === 'error_max_structured_output_retries') throw permanent(detail, 'invalid_output')
      if (result.subtype === 'error_during_execution' || API_FAILURE.test(text)) throw infra(detail, 'execute_api_error', { retryAfterMs })
      throw permanent(detail, 'execute_error')
    }
    if (result.structured_output === undefined || result.structured_output === null) throw permanent('La sesión terminó sin salida estructurada.', 'invalid_output')
    if (!validate(result.structured_output)) {
      throw permanent(`La salida estructurada no cumple el formato: ${ajv.errorsText(validate.errors).slice(0, 300)}`, 'invalid_output')
    }
    // UD-269: a `needs_decision` without a valid `decision_check` reaches no person; it fails like any invalid output.
    const noCheck = decisionCheckProblem(result.structured_output)
    if (noCheck) throw permanent(`La salida estructurada no cumple el formato: ${noCheck}`, 'invalid_output')
    const request = closeRequest(result.structured_output) // UD-271: what the session asked for; the system decides when the reply is posted
    const { captures: _declared, close: _close, close_reason: _closeReason, ...output } = result.structured_output // the files are in `captured`, the request is in `request`; what travels on is the rest
    const { decision_check: check, ...visible } = output // the check is shown as the question, not as JSON
    const body = [replyBody(visible, template), ...decisionLines(check, author?.language)].join('\n\n')
    const hands = Boolean(x.deliverCommand) && output.outcome === 'done' && await branchExists(branch)

    return () => {
      // The message may have changed while the session worked. Closed, deleted or no longer Claude's: nobody waits for this answer, and it could not be posted.
      // Edited: the answer is posted, but the change does not go to production on its own and a person reads it first.
      const now_ = get(db, `SELECT status, deleted_at, title, body, fields_json, area_id, template_id,
                                   EXISTS (SELECT 1 FROM message_assignees a WHERE a.message_id = messages.id AND a.member_id = ?) AS held FROM messages WHERE id = ?`, agent.id, messageId)
      if (!now_ || now_.deleted_at !== null || now_.status === 'closed' || now_.held !== 1) {
        events.publishForJob(job.id, { kind: 'done', data: { status: 'done', message_id: String(messageId), reply_id: null, skipped: 'message_changed', session_id: outcome.st.sessionId, cost_usd: result.total_cost_usd ?? null } })
        return
      }
      const edited = fingerprint(now_) !== startedWith
      if (hands && !edited) {
        // The delivery is the next job: it posts the closing reply when it ends (UD-263). A delivery already queued or running for the message
        // (an Editor started it by hand) leaves nothing to hand over, and the reply goes out now.
        const deliverJobId = enqueueDeliver(db, {
          messageId, now,
          payload: {
            member_id: memberId, branch, round: payload.deliver_round ?? 0, output, captures: captured.stored, execute_job_id: job.id, execute_attempt: job.attempts, requested_by: null,
            close_request: request, close_since: closeSince(job, messageId, memberId, payload) // UD-271: the delivery closes the message when it ends in green
          }
        })
        if (deliverJobId !== null) {
          rec.deliverJobId = deliverJobId
          events.publishForJob(job.id, { kind: 'progress', percent: 100, phrase: step('done'), data: { message_id: messageId } })
          events.publishForJob(job.id, {
            kind: 'done',
            data: { status: 'done', message_id: String(messageId), reply_id: null, deliver_job_id: String(deliverJobId), session_id: outcome.st.sessionId, cost_usd: result.total_cost_usd ?? null }
          })
          return
        }
      }
      // Inside the transaction that closes the job: the closing reply, then the end of the progress.
      const closing = closingCaptures(db, { messageId, authorId: agent.id, stored: captured.stored, language: author?.language })
      // `needs_decision` and `not_mine` go to a person's tray, not to the thread as «answered» (UD-269); the decision reads the field, not the text.
      const editedNote = edited ? [(FAILURE_TEXTS[author?.language] ?? FAILURE_TEXTS['es-419']).edited] : []
      // UD-271: an outcome that needs no change (`investigated`) with nothing left to the sender may close the message here; a change closes it in the delivery.
      const handOff = HANDOFF_OUTCOMES.includes(output.outcome) || edited
      const why = handOff ? null : closeReason(db, config, { output, request, delivered: false, messageId, agentId: agent.id, after: captured.stored.length, since: closeSince(job, messageId, memberId, payload) })
      const reply = { messageId, authorId: agent.id, body: [body, ...closing.lines, ...editedNote, ...(why ? [closeLine(why, author?.language)] : [])].join('\n\n'), kind: 'answer', files: closing.files }
      const { replyId } = handOff
        ? handOffToPerson({ db, events, now }, { messageId, agentId: agent.id, body: reply.body, files: reply.files, source: 'execute' })
        : addReply({ db, events, now }, reply)
      if (why) closeMessage({ db, events, now }, messageId, agent.id)
      const finalAt = now()
      rec.finalReplyMs = msSince(finalAt)
      jobSpan?.addEvent('reply.final', { 'team.ms_since_job_start': msSince(finalAt), 'team.ms_since_message': Math.max(0, finalAt - message.created_at) }, finalAt)
      events.publishForJob(job.id, { kind: 'progress', percent: 100, phrase: step('answered'), data: { message_id: messageId } })
      events.publishForJob(job.id, {
        kind: 'done',
        data: { status: 'done', message_id: String(messageId), reply_id: String(replyId), session_id: outcome.st.sessionId, cost_usd: result.total_cost_usd ?? null }
      })
    }
  }

  /**
   * A job that waits for the next day because the day's cap is spent leaves no trace in the thread: for up to a day nobody knew why the message did not move.
   * The agent says it once, in plain words (payload `budget_notice` keeps it from repeating at each retry). Never fails the job.
   */
  function noticeBudgetWait (job, messageId, resumeAt) {
    try {
      const { member_id: memberId, budget_notice: told } = parseJson(job.payload_json, {})
      if (told || !memberId) return
      const t = FAILURE_TEXTS[languageOf(messageId)] ?? FAILURE_TEXTS['es-419']
      const time = new Date(resumeAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      addReply({ db, events, now }, { messageId, authorId: memberId, kind: 'answer', body: t.budgetWait(time) })
      runSql(db, "UPDATE jobs SET payload_json = json_set(payload_json, '$.budget_notice', json('true')) WHERE id = ?", job.id)
    } catch (e) {
      logger?.warn({ err: e }, 'could not post the notice of the spending cap')
    }
  }

  const languageOf = (messageId) => get(db, 'SELECT a.language FROM messages m JOIN members a ON a.id = m.author_id WHERE m.id = ?', messageId)?.language

  /**
   * A job that fails (time limit, machine, session without result) leaves the author without an answer: the first reply said «Recibido» and
   * nothing came after (2026-10-22, message 3 ran out of its hour inside the delivery). The message goes to the person who decides in the area,
   * the way `needs_decision` does (UD-269), with the reason in plain words and never the internal code: as «answered» and assigned to the agent it
   * reached nobody (2026-10-23, an infrastructure `blocked` buried as answered). Returns false when there is nobody to hand it to or the message is
   * closed or gone.
   */
  function handOffFailure (job, messageId, error) {
    try {
      const { member_id: memberId } = parseJson(job.payload_json, {})
      if (!messageId || !memberId) return false
      const body = failureBody(error, languageOf(messageId), { timeoutMs: x.timeoutMs })
      if (alreadyHandedOver(db, messageId, body)) return true // launched again and failed the same way
      const { personId } = handOffToPerson({ db, events, now }, { messageId, agentId: memberId, body, source: 'execute' })
      return personId !== null
    } catch (e) {
      logger?.warn({ err: e }, 'could not hand the failed job to a person')
      return false
    }
  }

  /** With nobody to hand the message to, the agent still says in plain words that the work is not done; a closed or deleted message has nobody to tell. */
  function tellTheAuthor (job, messageId, error) {
    try {
      const { member_id: memberId } = parseJson(job.payload_json, {})
      if (!messageId || !memberId) return
      const body = failureBody(error, languageOf(messageId), { timeoutMs: x.timeoutMs })
      if (get(db, 'SELECT body FROM replies WHERE message_id = ? ORDER BY id DESC LIMIT 1', messageId)?.body === body) return // the same notice twice tells the author nothing new
      addReply({ db, events, now }, { messageId, authorId: memberId, body, kind: 'answer' })
    } catch {
      // The reply is a courtesy: if the message is closed or gone the failure is already in the job and in its events.
    }
  }

  return {
    maxRuntimeMs: x.timeoutMs + x.killGraceMs * 3, // the runner's own timeout fires first and leaves room to destroy the machine

    async run (job, ctx) {
      // UD-262: the row of the run is written when the attempt ends, also when it fails, times out or is aborted.
      const rec = { began: false, startedAt: now(), phaseMs: {}, session: null, st: null, result: null, r: null, firstReplyAt: null, finalReplyMs: null }
      let finalize
      try {
        finalize = await runJob(job, ctx, rec)
      } catch (error) {
        rec.error = error
        throw error
      } finally {
        liveMachines.delete(job.id)
        reserved.delete(job.id)
        if (rec.began) saveRun(job, ctx, rec)
      }
      return () => {
        finalize()
        try {
          if (rec.finalReplyMs !== null) updateExecuteRun(db, job.id, job.attempts, { final_reply_ms: rec.finalReplyMs, total_ms: rec.finalReplyMs })
          else if (rec.deliverJobId) updateExecuteRun(db, job.id, job.attempts, { deliver_job_id: rec.deliverJobId }) // the delivery fills the rest when it ends
        } catch (e) { logger?.warn({ err: e }, 'could not update the execute run') }
      }
    },

    onDeferred (job, deferral) {
      const { message_id: messageId } = parseJson(job.payload_json, {})
      events.publishForJob(job.id, { kind: 'progress', percent: 0, phrase: deferral.phrase, data: { message_id: messageId } })
    },

    onFailure (job, error, outcome) {
      const { message_id: messageId } = parseJson(job.payload_json, {})
      if (outcome.state === 'failed') {
        // Every final failure ends with a person holding the message, with the reason: the session died with its worker twice, the machine or the model service failed twice,
        // the time or the budget ran out, the output did not fit, the agent cannot start. Without a person to take it, the agent says so in the thread.
        if (!handOffFailure(job, messageId, error)) tellTheAuthor(job, messageId, error)
        events.publishForJob(job.id, { kind: 'done', data: { status: 'failed', message_id: messageId ? String(messageId) : null, error: String(error?.message ?? error), error_code: error?.code ?? null } })
      } else if (outcome.state === 'requeued') {
        events.publishForJob(job.id, { kind: 'progress', percent: 0, phrase: step('retry', { n: job.attempts, total: job.max_attempts }), data: { message_id: messageId } })
      }
    }
  }
}

export const executeTeamScript = resolve(TEAM_SCRIPT)
