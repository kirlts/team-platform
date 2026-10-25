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
import { all, get, run as runSql } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { AppError, infra, permanent } from '../domain/errors.js'
import { Deferred } from '../domain/pipeline.js'
import { addReply, closeMessage } from '../domain/messages.js'
import { mentionAnswered } from '../domain/mentions.js'
import { dailyBudget, localDay } from './budget.js'
import { HANDOFF_OUTCOMES, alreadyHandedOver, handOffToPerson } from '../domain/escalation.js'
import { audit } from '../domain/audit.js'
import { step } from '../domain/progress-phrases.js'
import { getProject } from '../domain/settings.js'
import { labelOfModel, resolveExecuteModel } from '../domain/execute-models.js'
import { guardsOf } from '../domain/assessment.js'
import { buildJudgePrompt, runJudge, saveJudgment } from './judge.js'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { currentTraceparent, recordGenAiCall, withSpan } from '../telemetry/api.js'
import { instanceLabel, recordExecuteRun, updateExecuteRun } from '../telemetry/execute-runs.js'
import { readAgentSecret } from './agent-credentials.js'
import { capturesDir, capturesEnv, closingCaptures, storeCaptures } from './captures.js'
import { documentFiles, documentNotes, documentsDir, documentsEnv, storeDocuments } from './documents.js'
import { decisionCheckProblem, decisionDetail, decisionLines } from './decision-check.js'
import { approveDelivery } from './approve.js'
import { discardDelivery, pendingDelivery } from '../domain/delivery-review.js'
import { loadMention, mentionBlock, planThread, stageThread, threadEnv } from './mention-context.js'
import { buildExecuteParts, buildExecutePrompt, declaredOutput, finalSchema, readTemplate } from './prompt.js'
import { closeLine, closeReason, closeRequest, firstReplyAnchor } from './auto-close.js'
import { enqueueDeliver, enqueueExecute } from './enqueue.js'
import { runLocal, runMachine } from './runners.js'
import { createSessionTracer } from './session-spans.js'
import { createStreamReader } from './stream.js'
import { startProgressNotices } from './progress-timer.js'
import { DEFAULT_PROGRESS_INTERVAL_MIN } from '../domain/progress-notes.js'

const run = promisify(execFile)
const TEAM_SCRIPT = fileURLToPath(new URL('../../scripts/team.mjs', import.meta.url))
// Modules that `team.mjs` imports at run time and that must travel with it (only Node built-ins inside): without them `team walkthrough` died with «Cannot find module walkthrough.mjs» (job 144, 2026-10-24).
export const TEAM_COMPANIONS = ['walkthrough.mjs']
const PROVIDER = 'claude-code'
const STDERR_TAIL_CHARS = 600 // declared courtesy: the cause of a process that fails is at the END of its stderr (the start is ssh and useradd noise); enough for the last lines, short enough for `last_error`

/**
 * The end of a process's stderr for an error message: the last non-empty lines that fit in `chars` (a single longer line keeps its end). The start of the
 * stderr of a machine is `ssh` and `useradd` warnings; the reason is the last thing it printed (2026-10-24, job 132 failed with code 1 and the reason was cut off).
 */
/**
 * The telemetry of the session (UD-262) is correlated with the job: when the host declares `EXECUTE_OTEL_ENV`, the session's
 * resource carries the job, attempt, message and trace ids (`OTEL_RESOURCE_ATTRIBUTES`, no spaces, as the Claude Code docs require),
 * so every metric, event and span it exports can be queried by `tp.job_id`. Without `EXECUTE_OTEL_ENV` nothing is added.
 */
export function otelSessionEnv (otelEnv, { jobId, attempt, messageId, traceId }) {
  if (!otelEnv || Object.keys(otelEnv).length === 0) return {}
  const own = [['tp.job_id', jobId], ['tp.attempt', attempt], ['tp.message_id', messageId], ['tp.trace_id', traceId]]
    .filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  const declared = otelEnv.OTEL_RESOURCE_ATTRIBUTES
  return { ...otelEnv, OTEL_RESOURCE_ATTRIBUTES: [declared, ...own].filter(Boolean).join(',') }
}

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

/**
 * What the analyzer expects of this session and which walls of the area the message touches (UD-295), as the text of the `expectation` block. The mechanism that holds each Guard is
 * named so the session knows where the wall is; it is not asked to remember it. Empty when the analyzer said nothing.
 */
export function assessmentText (message, db) {
  const lines = []
  if (message.expectation) lines.push(message.expectation)
  let touched = []
  try { touched = JSON.parse(message.guards_json || '[]') } catch { /* none */ }
  const guards = guardsOf(db, message.area_id).filter((g) => touched.includes(g.id))
  if (guards.length) lines.push('', 'Guards of the area that this message touches:', ...guards.map((g) => `- G${g.id}: ${g.text}${g.mechanism ? ` (held by: ${g.mechanism})` : ''}${g.person ? ' (about a person: the system puts a person on this message and you do not close it)' : ''}`))
  return lines.join('\n')
}

export { dailyBudget, localDay }

/** Where a machine finds the stable part of the prompt: run.sh replaces this marker with its own job directory. */
export const SYSTEM_FILE_ON_MACHINE = '@JOB_DIR@/system.md'

/**
 * UD-285: a reply that mentions the agent while its session runs reaches that same session. `PostToolBatch` fires «after a full batch of parallel tool calls resolves,
 * before the next model call», and a hook of that event may return `hookSpecificOutput.additionalContext`, which Claude Code wraps in a system reminder at that point (https://code.claude.com/docs/en/hooks, read 2026-10-24).
 * The command is `team mentions`: one request that returns only what is new (and marks it taken), nothing printed when there is nothing. It runs at the event of
 * every step, never on a timer; `--settings` adds the hook without replacing the ones the repository of the session already declares.
 */
export const LIVE_MENTION_SETTINGS = { hooks: { PostToolBatch: [{ hooks: [{ type: 'command', command: 'team mentions' }] }] } }

/**
 * The hooks the invocation declares (UD-295). A hard rule is not a paragraph the model has to remember: it is a hook that runs whether it remembers or not.
 * Every session has the live mentions. A direct fix on the area's light model also has `team map` at the start (the short map of the repository as context), `team guard` before every Bash call (no push to `main`, no forced push) and, when
 * the host declares it (EXECUTE_DIRECT_STOP_COMMAND), its check at the end: the command gets the event as JSON on stdin, exit 2 with the reason on stderr sends the
 * session back to work, and it must exit 0 when `stop_hook_active` is true so a session is held once, not forever.
 */
export function sessionSettings ({ light = false, assessed = false, stopCommand = '' } = {}) {
  const hooks = { ...LIVE_MENTION_SETTINGS.hooks }
  // KAIROS-PARA-TEAM-PLATFORM.md of the host §6: the light model gets only the paths it will probably touch; the larger model gets the short map of the repository.
  // KAIROS-PARA-TEAM-PLATFORM.md of the host §6: the light model gets only the paths it will probably touch; a larger model, when the analyzer assessed the message, the short map of the repository.
  if (light) hooks.SessionStart = [{ hooks: [{ type: 'command', command: 'team map --hook --brief' }] }]
  else if (assessed) hooks.SessionStart = [{ hooks: [{ type: 'command', command: 'team map --hook' }] }]
  if (light) {
    hooks.PreToolUse = [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'team guard' }] }]
    if (stopCommand) hooks.Stop = [{ hooks: [{ type: 'command', command: stopCommand }] }]
  }
  return { hooks }
}

/** The arguments of `claude -p` (UD-255). `light`: a direct fix on the area's own direct model (UD-295). */
export function claudeArgs (x, schema, { light = false, assessed = false } = {}) {
  return [
    '-p',
    '--model', x.model,
    '--effort', x.effort, // `claude --help` 2.1.284: «--effort <level> Effort level for the current session (low, medium, high, xhigh, max)»
    '--max-budget-usd', String(x.budgetUsd ?? x.maxBudgetUsd),
    ...(x.maxTurns > 0 ? ['--max-turns', String(x.maxTurns)] : []), // 0: no cap on turns, `--max-budget-usd` governs (UD-283)
    ...(light && x.directTools ? ['--tools', x.directTools] : []),
    '--permission-mode', 'bypassPermissions',
    '--settings', JSON.stringify(sessionSettings({ light, assessed, stopCommand: x.directStopCommand })),
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--json-schema', JSON.stringify(schema)
  ]
}

const SYSTEM_READ_FIELDS = ['cannot_close', 'approved', 'approved_reply', 'summary', 'captures', 'decision_check', 'close', 'close_reason', 'mode', 'attachments'] // the screenshots travel as attachments (UD-268); the check is shown as the question (UD-269); the close request is read by the system and shows as one line (UD-271); `mode` is read by the system and the documents travel as attachments (UD-272)

/**
 * What the sender reads of the structured output (UD-276): its `summary` and nothing else. The rest (outcome, zone, technical cause, verification,
 * branch, files…) is for whoever wants the detail and is kept apart, see `detailEntries`.
 */
export function replyBody (output) {
  return String(output?.summary ?? '').trim()
}

/**
 * The rest of the structured output (everything the system does not read) as [label, text] pairs, each with the label the template declares
 * (`outcome` as «Resultado»). Saved with the run (`execute_runs.detail_json`) and shown folded in «Tiempos», never in the reply.
 */
export function detailEntries (output, template = null, extraLabels = {}) {
  const labels = { outcome: 'Resultado', ...Object.fromEntries((template?.output ?? []).map((e) => [e.name, e.label ?? e.name])), ...extraLabels }
  return Object.entries(output ?? {})
    .filter(([k, v]) => !SYSTEM_READ_FIELDS.includes(k) && v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => [labels[k] ?? k, typeof v === 'string' ? v : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n') : JSON.stringify(v, null, 2)])
}

// The one line the system posts when a mention starts to be attended: the agent's first reply, whatever the session does later.
const ACK_TEXTS = {
  'es-419': 'Recibido. Empiezo ahora y respondo aquí apenas termine.',
  en: 'Received. Starting now; I will answer here as soon as I finish.'
}

// What the people read when a job fails. Plain words, never the internal code; `config` carries the reason of a refusal to start (it is already a plain sentence).
const FAILURE_TEXTS = {
  'es-419': {
    saved: 'Todavía no está en producción. Lo que alcancé a hacer queda guardado en la rama del mensaje.',
    again: 'Quien reciba este mensaje puede volver a lanzarlo desde la ficha.',
    editor: 'Cualquier persona del equipo puede volver a lanzarlo desde la ficha del mensaje.',
    interrupted: 'La sesión se interrumpió antes de terminar, dos veces seguidas (el servicio se reinició o se perdió la máquina de trabajo).',
    timeout: (minutes) => `No alcancé a terminar dentro del tiempo máximo (${minutes} min) y la sesión se cerró.`,
    budget: 'Se alcanzó el tope de gasto antes de terminar.',
    turns: 'La sesión llegó al máximo de pasos antes de terminar.',
    format: 'La sesión terminó, pero su resultado no tenía el formato pedido.',
    infra: 'No pude terminar este trabajo por un problema del sistema (la máquina de trabajo, la conexión o el servicio del modelo), dos veces seguidas.',
    system: 'No pude terminar este trabajo por un problema del sistema.',
    config: (reason) => `No pude empezar este trabajo: ${reason}`,
    budgetWait: (time) => `En espera: se alcanzó el tope de gasto de hoy. Sigue mañana a las ${time}.`,
    // UD-278: what a person reads when the agent could not answer a mention: its name and a reason in plain words.
    mention: (agent, why) => `${agent} no pudo responder: ${why}.`,
    why: { interrupted: 'se interrumpió', timeout: 'se acabó el tiempo', budget: 'se alcanzó el tope de gasto', turns: 'era demasiado largo', format: 'la respuesta no tuvo el formato esperado', infra: 'falló un servicio', system: 'hubo un problema del sistema' },
    // UD-280: the person is not an Editor, so the system does not deliver or discard; it says who can.
    notPerson: 'Sólo una persona del equipo puede aprobar o descartar este cambio. No se entregó ni se descartó.',
    edited: 'El mensaje se editó mientras trabajaba, así que esta respuesta puede no corresponder al texto de ahora. No se entregó a producción; lo hecho queda guardado en la rama.'
  },
  en: {
    saved: 'It is not in production yet. What I got done is saved on the branch of the message.',
    again: 'Whoever receives this message can launch it again from its page.',
    editor: 'Anyone on the team can launch it again from the page of the message.',
    interrupted: 'The session was interrupted before it finished, twice in a row (the service restarted or the work machine was lost).',
    timeout: (minutes) => `I could not finish within the time limit (${minutes} min) and the session was closed.`,
    budget: 'The spending limit was reached before it finished.',
    turns: 'The session reached its maximum number of steps before it finished.',
    format: 'The session finished, but its result did not have the format asked for.',
    infra: 'I could not finish this work because of a system problem (the work machine, the connection or the model service), twice in a row.',
    system: 'I could not finish this work because of a system problem.',
    config: (reason) => `I could not start this work: ${reason}`,
    budgetWait: (time) => `Waiting: today's spending limit was reached. It continues tomorrow at ${time}.`,
    mention: (agent, why) => `${agent} could not answer: ${why}.`,
    why: { interrupted: 'it was interrupted', timeout: 'time ran out', budget: 'the spending limit was reached', turns: 'it was too long', format: 'the answer did not have the expected format', infra: 'a service failed', system: 'a system problem' },
    notPerson: 'Only a person of the team can approve or discard this change. It was neither delivered nor discarded.',
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
export function failureBody (error, language, { timeoutMs = 0, mentionAgent = null } = {}) {
  const t = FAILURE_TEXTS[language] ?? FAILURE_TEXTS['es-419']
  const kind = FAILURE_KIND[error?.code] ?? 'system'
  const reason = kind === 'timeout' ? t.timeout(Math.max(1, Math.round(timeoutMs / 60000))) : kind === 'config' ? t.config(String(error?.message ?? '').trim()) : t[kind]
  const saved = kind === 'config' ? '' : ` ${t.saved}`
  // UD-278: a job that was called by a mention says it in one line: who could not answer and why, in plain words.
  if (mentionAgent) return t.mention(mentionAgent, kind === 'config' ? String(error?.message ?? '').trim() : t.why[kind] ?? t.why.system)
  return `${reason}${saved}\n\n${t.again}`
}

const fingerprint = (m) => JSON.stringify([m.title, m.body, m.fields_json, m.area_id, m.template_id])

export function createExecuteHandler ({ db, config, queue, events, vault, logger = null, now = Date.now, progressUnitMs = 60_000 /* calendar constant: one minute; a test shortens it */ }) {
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
      for (const name of TEAM_COMPANIONS) await copyFile(fileURLToPath(new URL(`../../scripts/${name}`, import.meta.url)), join(workdir, 'bin', name))
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
        model: models.length ? models.join(',') : (rec.model ?? x.model), runner: x.runner, machine: rec.r?.machine ?? null,
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
        detail_json: rec.detail ? JSON.stringify(rec.detail) : null,
        review_answered: rec.reviewAnswered ? 1 : null,
        outcome: aborted ? 'aborted' : (failed ? 'failed' : (typeof result?.structured_output?.outcome === 'string' ? result.structured_output.outcome : null)),
        error_code: errorCode, delivered: marks.delivered ?? null,
        transcript_ref: rec.r?.collect?.ref ?? null, transcript_error: transcriptError(rec.r?.collect), slowest_tools: s?.slowest ?? []
      })
    } catch (error) {
      logger?.warn({ err: error }, 'could not record the execute run')
    }
  }

  /** Why a collected run has no transcript: the exit code and the start of what the command said, never silence. */
  function transcriptError (collect) {
    if (!collect || collect.ref) return null
    const why = collect.code === 0 ? 'no output' : `exit ${collect.code}: ${String(collect.stderr ?? '').trim().slice(0, 500)}`
    logger?.error({ transcript_error: why }, 'transcript_not_collected')
    return why
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
    // UD-295: the model of this session comes from the area of the message and the level of the message (a retry of a failed session on the lighter model goes up to the area's).
    const { model, estimates } = resolveExecuteModel(db, { messageId, fallback: x.model, light: x.lightModel, limits: x.lightLimits, escalated: payload.escalated === true })
    const light = model === x.lightModel // the light model (Haiku 5.5): the minimal prompt, the narrow tools, the map and the hooks of UD-295 apply
    rec.model = model
    rec.light = light
    const templateRow = message.template_id ? get(db, 'SELECT id, name, body_markdown, progress_interval_min FROM templates WHERE id = ?', message.template_id) : null
    const template = readTemplate(templateRow)
    let declared
    try { declared = declaredOutput(template) } catch (error) { throw permanent(`La salida declarada de la plantilla no compila: ${error.message}`, 'template') }
    // UD-272: the forward that brought the message to this agent (the reply of kind `forward` the job names), when there is one and it is still in the thread.
    const forward = payload.forward?.reply_id
      ? get(db, `SELECT r.body AS reason, m.name AS by FROM replies r JOIN members m ON m.id = r.author_id
                  WHERE r.id = ? AND r.message_id = ? AND r.kind = 'forward' AND r.forwarded_to = ? AND r.deleted_at IS NULL`, payload.forward.reply_id, messageId, memberId) ?? null
      : null
    // UD-278: the reply that mentions this agent (when the job was enqueued by a mention). The session receives the whole thread; `mode` and `attachments` are offered as with a forward.
    const mention = loadMention(db, payload.mention, { messageId })
    const thread = mention ? planThread(db, { messageId, marked: [mention.replyId, ...mention.earlier] }) : null
    // UD-280: a mention on a message whose change waits for review. This very job is a running `execute`, so the review is read without it.
    const reviewState = mention ? pendingDelivery(db, messageId, { exceptJobId: job.id }) : null
    const mentionAuthor = mention ? get(db, 'SELECT m.id, m.role, m.kind, m.active FROM replies r JOIN members m ON m.id = r.author_id WHERE r.id = ?', mention.replyId) : null
    // The first reply of a mention is the system's, in the first seconds and before the machine exists: a session that omits it (job 138: 61 tools, no reply) leaves the person without a sign.
    const acknowledged = mention ? acknowledgeMention(job, payload, { messageId, memberId, mention }) : false
    // Any active person of the team approves or discards by writing it (Martín, 2026-10-24: the Editor only changes configured texts; UD-284).
    const byPerson = Boolean(mentionAuthor && mentionAuthor.kind !== 'agent' && mentionAuthor.active === 1)
    const review = reviewState
      ? { branch: reviewState.branch, reason: reviewState.held_reason, byPerson }
      : null
    const schema = finalSchema(declared.grammar, { autoClose: x.autoClose, forwarded: forward !== null || mention !== null, reviewing: review !== null, light })
    const validate = ajv.compile(finalSchema(declared.validation, { validation: true, autoClose: x.autoClose }))
    let hostInstructions = ''
    // UD-295: the host's minimal version of its rules for a light session, when it declares one.
    const hostFile = light && x.directHostInstructions ? x.directHostInstructions : x.hostInstructions
    if (hostFile) {
      try { hostInstructions = await readFile(hostFile, 'utf8') } catch (error) {
        throw permanent(`No se pudo leer ${hostFile === x.hostInstructions ? 'EXECUTE_HOST_INSTRUCTIONS' : 'EXECUTE_DIRECT_HOST_INSTRUCTIONS'} (${hostFile}): ${error.code ?? error.message}`, 'host_instructions_missing')
      }
    }

    const branch = `tp/${messageId}`
    const startedWith = fingerprint(message) // what the session was asked; an edit while it works makes its answer a possible answer to the old text
    const promptInput = {
      message: { id: messageId, title: message.title, body: message.body, fields: parseJson(message.fields_json, {}), area: message.area_title, status: message.status },
      template: templateRow, author, agent, project: getProject(db, config), jobId: job.id, maxSubagents: x.maxSubagents, branch, hostInstructions,
      compact: light, assessment: assessmentText(message, db), escalation: payload.escalated_from ? { from: labelOfModel(payload.escalated_from_model), note: payload.escalated_note ?? '' } : null, deliver: Boolean(x.deliverCommand), deliverFailure, autoClose: x.autoClose, forward, mention: mention ? mentionBlock(mention, thread, review, acknowledged) : null,
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
    const args = claudeArgs({ ...x, model, budgetUsd }, schema, { light, assessed: estimates !== null })
    // It counts as run from here: the machine cost applies even if the session never returns its cost.
    runSql(db, 'UPDATE jobs SET runner = ?, model = ?, run_at = ?, marks_json = NULL WHERE id = ?', x.runner, model, now(), job.id)
    rec.began = true

    let session = null // spans of the tools and subagents, alive while the `run` phase is
    let notices = { stop () {} } // the clock of the progress notices (UD-293), alive while the `run` phase is
    const reader = createStreamReader({
      maxTurns: x.maxTurns,
      budgetUsd,
      onEvent: (event) => session?.onEvent(event),
      onProgress: (percent, phrase) => { if (!queue.progress(job, percent, phrase)) ctx.abort('lost') }
    })
    queue.progress(job, 0, x.runner === 'machine' ? 'Creando la máquina' : 'Preparando la sesión')

    const dirs = await prepareWorkdir(job, messageId, deliverFailure !== null)
    const teamUrl = x.teamUrl || `http://127.0.0.1:${config.port}`
    const sessionEnv = {
      TEAM_URL: teamUrl, TEAM_API_PREFIX: config.apiPrefix, TEAM_AGENT_EMAIL: agent.email, TEAM_AGENT_SECRET: secret,
      TEAM_JOB_ID: String(job.id), TEAM_MESSAGE_ID: String(messageId), TEAM_BRANCH: branch, ...capturesEnv(config, dirs.workdir, author?.language), ...documentsEnv(config, dirs.workdir), ...(mention ? threadEnv(dirs.workdir) : {})
    }
    // One span per real phase of the job; `jobs.phase` says which one is running (the queue shows it).
    const kind = x.runner === 'machine' ? 'machine' : 'local'
    const setPhase = (name) => { try { runSql(db, 'UPDATE jobs SET phase = ? WHERE id = ?', name, job.id) } catch { /* the label is a courtesy */ } }
    const phase = (name, fn) => withSpan(`execute.${kind}.${name}`, { 'team.step': `execute.${kind}.${name}`, 'team.runner': x.runner }, async (span) => {
      setPhase(name)
      const phaseStart = now()
      if (name === 'run') {
        session = createSessionTracer({ model })
        // UD-293: from here until the session ends, a notice in the thread every `progress_interval_min` of the template.
        notices = startProgressNotices({ db, events, now, logger, jobId: job.id, messageId, authorId: memberId, language: author?.language, intervalMin: templateRow?.progress_interval_min ?? DEFAULT_PROGRESS_INTERVAL_MIN, unitMs: progressUnitMs, reader })
      }
      try {
        const r = await fn()
        if (r && typeof r === 'object' && 'code' in r) {
          span.setAttribute('team.exit_code', r.code ?? -1)
          if (r.code !== 0 && name !== 'run') span.setStatus({ code: SpanStatusCode.ERROR, message: `exit ${r.code}` })
        }
        return r
      } finally {
        if (name === 'run') { notices.stop(); rec.session = session?.finish(span) ?? null; session = null }
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
        'team.runner': x.runner, 'team.model': model, 'team.estimates': estimates ? JSON.stringify(estimates) : '', 'team.effort': x.effort, 'team.max_budget_usd': budgetUsd, 'team.daily_spent_usd': budget.spent
      }, async (span) => {
        span.setAttribute('team.queue_wait_ms', Math.max(0, startedAt - job.created_at))
        await mkdir(capturesDir(dirs.workdir)) // where the session leaves its screenshots (UD-268); here and not in prepareWorkdir, so the check of EXECUTE_MAX_MACHINES keeps its timing
        await mkdir(documentsDir(dirs.workdir)) // and its documents (UD-272)
        if (thread) span.setAttribute('team.thread_files', await stageThread({ config, plan: thread, workdir: dirs.workdir })) // UD-278: the attachments of the thread, where the session reads them
        // The session continues this trace (W3C `TRACEPARENT`) and, when the host declares it, exports its own telemetry (EXECUTE_OTEL_ENV).
        const tracedEnv = { ...(x.sessionEnv ?? {}), ...(light ? (x.directSessionEnv ?? {}) : {}), ...otelSessionEnv(x.otelEnv, { jobId: job.id, attempt: job.attempts, messageId, traceId: job.trace_id }), ...(currentTraceparent() ? { TRACEPARENT: currentTraceparent() } : {}) }
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
            model: models.length === 1 ? models[0] : (models.join(',') || model),
            request: { messages: [{ role: 'user', content: prompt }], effort: x.effort },
            response: { text: JSON.stringify(result.structured_output ?? result.result ?? null), model: models[0] ?? model, stop_reason: result.stop_reason, duration_ms: result.duration_ms },
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
        // UD-272: the documents the reason asked for, stored while the job directory exists, like the screenshots.
        let documents = { stored: [], rejected: [] }
        try { documents = await storeDocuments({ config, output: result?.structured_output, workdir: dirs.workdir }) } catch (error) { logger?.warn({ err: error }, 'could not store the documents') }
        for (const d of documents.rejected) span.addEvent('documents.rejected', { 'team.document_index': d.index, 'team.document_reason': d.reason })
        if (documents.stored.length) span.setAttribute('team.documents', documents.stored.length)
        return { r, st, result, captured, documents }
      })
    } finally {
      liveMachines.delete(job.id)
      await cleanup(dirs)
    }
    ctx.signal.throwIfAborted()
    const { r, result, captured, documents } = outcome
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
    const request = mention ? null : closeRequest(result.structured_output) // UD-271: what the session asked for; the system decides when the reply is posted. A mention never closes (UD-278): the people in the thread decide
    // The files are in `captured` and `documents`, the request is in `request`, the mode is in `investigate`; what travels on is the rest.
    const { captures: _declared, close: _close, close_reason: _closeReason, cannot_close: cannotClose, mode, approved, approved_reply: approvedReply, attachments: _attachments, review: asked, review_reason: askedReason, ...output } = result.structured_output
    // UD-280: what the person asked about the change under review. The system reads the field, never the words; without a review pending the field means nothing.
    const reviewAction = review ? asked ?? 'none' : null
    const untouched = reviewAction === 'approve' || reviewAction === 'discard' || reviewAction === 'none' // the review is answered or left as it is: no change, no delivery, no close
    const investigate = mode === 'investigate' || untouched // UD-272: the model understood the reason as «look into it»: nothing is delivered and nothing is closed, whatever the rest of the output says
    const documentLines = documentNotes(documents.rejected, author?.language)
    const { decision_check: check, ...visible } = output // the check is shown as the question, not as JSON
    let body = [replyBody(visible), ...decisionLines(check)].join('\n\n')
    rec.detail = [...detailEntries(visible, template), ...decisionDetail(check, author?.language)] // UD-276: kept with the run, shown folded in «Tiempos»
    // UD-295: the IMK judgement of what the session did (a cheap model reads the reply, the output and the evidence), saved with the job. Not when the work goes on in a stronger model:
    // the judge reads the end of the work. A judge that cannot run leaves the job unjudged; the job does not depend on it.
    const goesOn = light && payload.escalated !== true && (cannotClose === true || output.outcome === 'blocked')
    let judgment = null
    if (!goesOn) {
      let touched = []
      try { touched = JSON.parse(message.guards_json || '[]') } catch { /* none */ }
      judgment = await runJudge({
        config,
        signal: ctx.signal,
        prompt: buildJudgePrompt({
          message, expectation: message.expectation, guards: guardsOf(db, message.area_id).filter((g) => touched.includes(g.id)), output: visible, detail: rec.detail,
          captures: captured.stored, stats: { modelo: model, turnos: outcome.st.turns, minutos: Math.round((now() - startedAt) / 6000) / 10, costo_usd: result.total_cost_usd ?? 'desconocido', resultado: output.outcome ?? 'ninguno', ...(payload.escalated ? { continuo_el_trabajo_de: labelOfModel(payload.escalated_from_model) } : {}) }
        })
      })
      if (judgment?.cost) runSql(db, 'UPDATE jobs SET cost_usd = COALESCE(cost_usd, 0) + ? WHERE id = ?', judgment.cost, job.id) // it counts in the day's cap with the job
    }
    const hands = Boolean(x.deliverCommand) && output.outcome === 'done' && !investigate && await branchExists(branch)
    // UD-286: the person already asked, in their own words, to implement and publish. The model says it in `approved`; the system reads the field, never the words, and the delivery goes out without a second review.
    const preApprovedBy = approved === true && !investigate && mentionAuthor && byPerson ? mentionAuthor.id : null
    rec.reviewAnswered = untouched // the run changed nothing: the review keeps pointing at the run that held the branch

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
      if (judgment) saveJudgment(db, { jobId: job.id, messageId, judgment, workedWith: model, now })
      // UD-295: the session of the light model says, as a parameter, that it could not close, or ends `blocked`: the work is relaunched once on the area's escalation model,
      // on the same branch, and the thread says so. What the system reads is the field and the outcome, never the words; never the other way round and never twice.
      const stronger = light && payload.escalated !== true ? resolveExecuteModel(db, { messageId, fallback: x.model, light: x.lightModel, limits: x.lightLimits, escalated: true }).model : null
      if (stronger && stronger !== model && (cannotClose === true || output.outcome === 'blocked') && !edited) {
        const origin = Object.fromEntries(Object.entries(payload).filter(([k]) => !['message_id', 'member_id', 'requested_by', 'budget_notice', 'retry_after_reply_id', 'escalated', 'escalated_from', 'escalated_from_model', 'escalated_note', 'no_stable_system'].includes(k)))
        const next = enqueueExecute(db, {
          messageId, memberId, requestedBy: payload.requested_by ?? null, now, exceptJobId: job.id,
          extra: { ...origin, escalated: true, escalated_from: job.id, escalated_from_model: model, escalated_note: String(output.summary ?? '').slice(0, 1500) }
        })
        if (next !== null) {
          const lang = author?.language
          addReply({ db, events, now }, { messageId, authorId: agent.id, kind: 'answer', body: (lang === 'en' ? `${labelOfModel(model)} did not close it: ${labelOfModel(stronger)} continued.` : `${labelOfModel(model)} no cerró: siguió ${labelOfModel(stronger)}.`) })
          audit(db, { memberId: agent.id, action: 'message.execute_escalate', entity: 'message', entityId: messageId, detail: { from_job_id: job.id, job_id: next, from: model, to: stronger, why: cannotClose === true ? 'cannot_close' : 'blocked' }, now })
          events.publishForJob(job.id, { kind: 'done', data: { status: 'done', message_id: String(messageId), reply_id: null, escalated_job_id: String(next), session_id: outcome.st.sessionId, cost_usd: result.total_cost_usd ?? null } })
          return
        }
      }
      // UD-280: the person asked, in their own words, to deliver or to drop the change under review. The system carries it out for any active person (UD-284).
      let discarded = false
      if (reviewAction === 'approve' || reviewAction === 'discard') {
        const texts = FAILURE_TEXTS[author?.language] ?? FAILURE_TEXTS['es-419']
        if (!byPerson) body = texts.notPerson
        else {
          try {
            if (reviewAction === 'approve') approveDelivery({ db, config, events }, { messageId, requestedBy: mentionAuthor.id, exceptJobId: job.id })
            else discardDelivery({ db, events, now }, { messageId, memberId: mentionAuthor.id, reason: (askedReason?.trim() || String(output.summary ?? '').trim()).slice(0, 1000) || '-', exceptJobId: job.id })
            discarded = reviewAction === 'discard'
          } catch (error) {
            if (!(error instanceof AppError)) throw error
            body = error.message // a conflict is already a plain sentence for people (the review is gone, a delivery is running)
          }
        }
      }
      if (hands && !edited) {
        // The delivery is the next job: it posts the closing reply when it ends (UD-263). A delivery already queued or running for the message
        // (an Editor started it by hand) leaves nothing to hand over, and the reply goes out now.
        const deliverJobId = enqueueDeliver(db, {
          messageId, now,
          payload: {
            member_id: memberId, branch, round: payload.deliver_round ?? 0, output, captures: captured.stored, documents: { files: documentFiles(documents.stored), notes: documentLines }, execute_job_id: job.id, execute_attempt: job.attempts, requested_by: null, approved_by: preApprovedBy,
            close_request: request, close_since: closeSince(job, messageId, memberId, payload) // UD-271: the delivery closes the message when it ends in green
          }
        })
        if (deliverJobId !== null) {
          rec.deliverJobId = deliverJobId
          if (preApprovedBy !== null) audit(db, { memberId: preApprovedBy, action: 'message.deliver_preapproved', entity: 'message', entityId: messageId, detail: { job_id: deliverJobId, reply: String(approvedReply ?? '').slice(0, 300) || null } })
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
      const why = handOff || investigate ? null : closeReason(db, config, { output, request, delivered: false, messageId, agentId: agent.id, after: captured.stored.length, since: closeSince(job, messageId, memberId, payload) })
      const reply = { messageId, authorId: agent.id, body: [body, ...closing.lines, ...documentLines, ...editedNote, ...(why ? [closeLine(why, author?.language)] : [])].join('\n\n'), kind: 'answer', files: [...closing.files, ...documentFiles(documents.stored)] }
      const { replyId } = handOff
        ? handOffToPerson({ db, events, now }, { messageId, agentId: agent.id, body: reply.body, files: reply.files, source: 'execute' })
        : addReply({ db, events, now }, reply)
      if (why) closeMessage({ db, events, now }, messageId, agent.id)
      if (discarded) runSql(db, "UPDATE messages SET status = 'open', updated_at = ? WHERE id = ?", now(), messageId) // a discarded change leaves the message open (UD-275), also after the answer
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

  /** The name of the agent when this job was called by a mention (UD-278), else null: a failure of such a job is told in one line. */
  function mentionAgentOf (job, messageId) {
    const payload = parseJson(job.payload_json, {})
    return loadMention(db, payload.mention, { messageId }) ? get(db, 'SELECT name FROM members WHERE id = ?', payload.member_id)?.name ?? null : null
  }

  /**
   * The guarantee of UD-278: a mention of an agent always gets at least one reply from it. When the job ended for good and no reply of the agent follows the
   * mention (the hand-over to a person did not post one, or the thread changed under it), the system writes one in the agent's name: one line that says it
   * could not and why. Never fails the job; a closed or deleted message has nobody to tell.
   */
  function acknowledgeMention (job, payload, { messageId, memberId, mention }) {
    try {
      if (payload.ack_reply_id) return true // an earlier attempt of this job already posted it
      const first = Math.min(mention.replyId, ...mention.earlier)
      if (mentionAnswered(db, { messageId, agentId: memberId, replyId: Math.max(first - 1, payload.retry_after_reply_id ?? 0) })) return false // the agent already answered this mention: nothing to acknowledge
      const { replyId } = addReply({ db, events, now }, { messageId, authorId: memberId, kind: 'answer', body: (ACK_TEXTS[languageOf(messageId)] ?? ACK_TEXTS['es-419']) })
      runSql(db, "UPDATE jobs SET payload_json = json_set(payload_json, '$.ack_reply_id', ?) WHERE id = ?", replyId, job.id)
      payload.ack_reply_id = replyId
      return true
    } catch (e) {
      logger?.warn({ err: e }, 'could not post the acknowledgement of a mention')
      return false
    }
  }

  function answerMention (job, messageId, error) {
    try {
      const payload = parseJson(job.payload_json, {})
      if (!mentionAgentOf(job, messageId)) return
      const first = Math.min(payload.mention.reply_id, ...(payload.mention.earlier ?? []))
      if (mentionAnswered(db, { messageId, agentId: payload.member_id, replyId: Math.max(first - 1, payload.retry_after_reply_id ?? 0), exceptReplyId: payload.ack_reply_id ?? 0 })) return
      const { replyId } = addReply({ db, events, now }, { messageId, authorId: payload.member_id, kind: 'answer', body: failureBody(error, languageOf(messageId), { timeoutMs: x.timeoutMs, mentionAgent: mentionAgentOf(job, messageId) }) })
      markFailure(replyId, job, error)
    } catch (e) {
      logger?.warn({ err: e }, 'could not post the answer to a mention that failed')
    }
  }

  /** UD-282: the notice of a failure carries the job that failed, so that «Reintentar» launches that job again. */
  const markFailure = (replyId, job, error) => runSql(db, 'UPDATE replies SET failed_job_id = ?, failed_code = ? WHERE id = ?', job.id, error?.code ?? 'system', replyId)

  const markLastReply = (messageId, job, error) => runSql(db, 'UPDATE replies SET failed_job_id = ?, failed_code = ? WHERE id = (SELECT MAX(id) FROM replies WHERE message_id = ? AND deleted_at IS NULL)', job.id, error?.code ?? 'system', messageId)

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
      const body = failureBody(error, languageOf(messageId), { timeoutMs: x.timeoutMs, mentionAgent: mentionAgentOf(job, messageId) })
      if (alreadyHandedOver(db, messageId, body)) { markLastReply(messageId, job, error); return true } // launched again and failed the same way: the notice stays and now stands for this job
      const { replyId, personId } = handOffToPerson({ db, events, now }, { messageId, agentId: memberId, body, source: 'execute' })
      markFailure(replyId, job, error)
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
      const body = failureBody(error, languageOf(messageId), { timeoutMs: x.timeoutMs, mentionAgent: mentionAgentOf(job, messageId) })
      if (get(db, 'SELECT body FROM replies WHERE message_id = ? ORDER BY id DESC LIMIT 1', messageId)?.body === body) { markLastReply(messageId, job, error); return } // the same notice twice tells the author nothing new
      const { replyId } = addReply({ db, events, now }, { messageId, authorId: memberId, body, kind: 'answer' })
      markFailure(replyId, job, error)
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
        answerMention(job, messageId, error)
        events.publishForJob(job.id, { kind: 'done', data: { status: 'failed', message_id: messageId ? String(messageId) : null, error: String(error?.message ?? error), error_code: error?.code ?? null } })
      } else if (outcome.state === 'requeued') {
        events.publishForJob(job.id, { kind: 'progress', percent: 0, phrase: step('retry', { n: job.attempts, total: job.max_attempts }), data: { message_id: messageId } })
      }
    }
  }
}

export const executeTeamScript = resolve(TEAM_SCRIPT)
