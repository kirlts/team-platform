// The `execute` job (UD-254, UD-255, MS §7.5 «Ejecución»): an unattended Claude Code session works a message assigned to
// an agent member. The session sends its first reply itself with `team reply`; the `result` line of its NDJSON closes the
// job: a valid `structured_output` becomes the closing reply (its `summary`, then the rest of the declared output); no
// structured output, an error result or an invalid one fail the job with the reason. `session_id` and `total_cost_usd`
// stay on the `execute` span of the job's trace.

import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import Ajv from 'ajv'
import { get, run as runSql } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { permanent } from '../domain/errors.js'
import { Deferred } from '../domain/pipeline.js'
import { addReply } from '../domain/messages.js'
import { step } from '../domain/progress-phrases.js'
import { getProject } from '../domain/settings.js'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { currentTraceparent, recordGenAiCall, withSpan } from '../telemetry/api.js'
import { readAgentSecret } from './agent-credentials.js'
import { buildExecutePrompt, declaredOutput, finalSchema, readTemplate } from './prompt.js'
import { runLocal, runMachine } from './runners.js'
import { createSessionTracer } from './session-spans.js'
import { createStreamReader } from './stream.js'

const run = promisify(execFile)
const TEAM_SCRIPT = fileURLToPath(new URL('../../scripts/team.mjs', import.meta.url))
const PROVIDER = 'claude-code'

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
export function replyBody (output, template = null) {
  const { summary, ...rest } = output
  const labels = { outcome: 'Resultado', ...Object.fromEntries((template?.output ?? []).map((e) => [e.name, e.label ?? e.name])) }
  const lines = Object.entries(rest).filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `**${labels[k] ?? k}**: ${typeof v === 'string' ? v : `\n\n\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\``}`)
  return lines.length ? `${summary.trim()}\n\n${lines.join('\n\n')}` : summary.trim()
}

export function createExecuteHandler ({ db, config, queue, events, vault, logger = null, now = Date.now }) {
  const x = config.execute
  const ajv = new Ajv({ allErrors: true, strict: false })

  async function prepareWorkdir (job, messageId) {
    const root = x.workRoot || config.tmpDir
    await mkdir(root, { recursive: true })
    const workdir = await mkdtemp(join(root, `execute-${job.id}-`))
    await mkdir(join(workdir, 'bin'))
    // `team` in the session's PATH: the standalone script next to a shim, so a machine gets it with the job dir.
    await copyFile(TEAM_SCRIPT, join(workdir, 'bin', 'team.mjs'))
    await writeFile(join(workdir, 'bin', 'team'), '#!/bin/sh\nexec node "$(dirname "$0")/team.mjs" "$@"\n', { mode: 0o755 })
    let cwd = workdir
    let worktree = null
    if (x.runner === 'local' && x.repoDir) {
      worktree = join(workdir, 'repo')
      await run('git', ['-C', x.repoDir, 'worktree', 'add', '-B', `tp/${messageId}`, worktree])
      cwd = worktree
    }
    return { workdir, cwd, worktree }
  }

  async function cleanup ({ workdir, worktree }) {
    // The branch stays for a person to deliver (UD-254 point 6); only the worktree and the job dir go.
    if (worktree) await run('git', ['-C', x.repoDir, 'worktree', 'remove', '--force', worktree]).catch((e) => logger?.warn({ err: e }, 'could not remove the execute worktree'))
    await rm(workdir, { recursive: true, force: true })
  }

  return {
    maxRuntimeMs: x.timeoutMs + x.killGraceMs * 3, // the runner's own timeout fires first and leaves room to destroy the machine

    async run (job, ctx) {
      const { message_id: messageId, member_id: memberId } = parseJson(job.payload_json, {})
      const jobSpan = trace.getActiveSpan() // the `job` span of this attempt: `reply.start` and `reply.final` are events on it (UD-262)
      const startedAt = now()
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
      const schema = finalSchema(declared.grammar)
      const validate = ajv.compile(finalSchema(declared.validation, { validation: true }))
      let hostInstructions = ''
      if (x.hostInstructions) {
        try { hostInstructions = await readFile(x.hostInstructions, 'utf8') } catch (error) {
          throw permanent(`No se pudo leer EXECUTE_HOST_INSTRUCTIONS (${x.hostInstructions}): ${error.code ?? error.message}`, 'host_instructions_missing')
        }
      }

      const branch = `tp/${messageId}`
      const prompt = buildExecutePrompt({
        message: { id: messageId, title: message.title, body: message.body, fields: parseJson(message.fields_json, {}), area: message.area_title, status: message.status },
        template: templateRow, author, agent, project: getProject(db, config), jobId: job.id, maxSubagents: x.maxSubagents, branch, hostInstructions
      })
      // UD-256: the day's spend first; with nothing left the job waits for the next day without spending its attempt.
      const budget = dailyBudget(db, x, now())
      if (budget.remaining <= 0) throw new Deferred(budget.nextDayMs, step('budgetWait'))
      const budgetUsd = Math.round(Math.min(x.maxBudgetUsd, budget.remaining) * 100) / 100 || 0.01
      const args = claudeArgs({ ...x, budgetUsd }, schema)
      // It counts as run from here: the machine cost applies even if the session never returns its cost.
      runSql(db, 'UPDATE jobs SET runner = ?, run_at = ? WHERE id = ?', x.runner, now(), job.id)

      let session = null // spans of the tools and subagents, alive while the `run` phase is
      const reader = createStreamReader({
        maxTurns: x.maxTurns,
        onEvent: (event) => session?.onEvent(event),
        onProgress: (percent, phrase) => { if (!queue.progress(job, percent, phrase)) ctx.abort('lost') }
      })
      queue.progress(job, 0, x.runner === 'machine' ? 'Creando la máquina' : 'Preparando la sesión')

      const dirs = await prepareWorkdir(job, messageId)
      const teamUrl = x.teamUrl || `http://127.0.0.1:${config.port}`
      const sessionEnv = {
        TEAM_URL: teamUrl, TEAM_API_PREFIX: config.apiPrefix, TEAM_AGENT_EMAIL: agent.email, TEAM_AGENT_SECRET: secret,
        TEAM_JOB_ID: String(job.id), TEAM_MESSAGE_ID: String(messageId), TEAM_BRANCH: branch
      }
      // One span per real phase of the job; `jobs.phase` says which one is running (the queue shows it).
      const kind = x.runner === 'machine' ? 'machine' : 'local'
      const setPhase = (name) => { try { runSql(db, 'UPDATE jobs SET phase = ? WHERE id = ?', name, job.id) } catch { /* the label is a courtesy */ } }
      const phase = (name, fn) => withSpan(`execute.${kind}.${name}`, { 'team.step': `execute.${kind}.${name}`, 'team.runner': x.runner }, async (span) => {
        setPhase(name)
        if (name === 'run') session = createSessionTracer({ model: x.model })
        try {
          const r = await fn()
          if (r && typeof r === 'object' && 'code' in r) {
            span.setAttribute('team.exit_code', r.code ?? -1)
            if (r.code !== 0 && name !== 'run') span.setStatus({ code: SpanStatusCode.ERROR, message: `exit ${r.code}` })
          }
          return r
        } finally {
          if (name === 'run') { session?.finish(span); session = null }
        }
      })
      let outcome
      try {
        outcome = await withSpan('execute', {
          'team.step': 'execute', 'team.message_id': String(messageId), 'team.member_id': String(memberId),
          'team.runner': x.runner, 'team.model': x.model, 'team.effort': x.effort, 'team.max_budget_usd': budgetUsd, 'team.daily_spent_usd': budget.spent
        }, async (span) => {
          span.setAttribute('team.queue_wait_ms', Math.max(0, startedAt - job.created_at))
          // The session continues this trace (W3C `TRACEPARENT`) and, when the host declares it, exports its own telemetry (EXECUTE_OTEL_ENV).
          const tracedEnv = { ...(x.otelEnv ?? {}), ...(currentTraceparent() ? { TRACEPARENT: currentTraceparent() } : {}) }
          const opts = { config, args, prompt, onData: (c) => reader.push(c), signal: ctx.signal }
          const r = x.runner === 'machine'
            ? await runMachine({ ...opts, jobId: job.id, workdir: dirs.workdir, env: { ...sessionEnv, ...tracedEnv }, log: (m) => logger?.error(m), phase })
            : await phase('run', () => runLocal({ ...opts, cwd: dirs.cwd, env: { ...process.env, ...sessionEnv, ...tracedEnv, PATH: `${join(dirs.workdir, 'bin')}:${process.env.PATH ?? ''}` } }))
          reader.end()
          setPhase(null)
          const firstReply = get(db, 'SELECT MIN(created_at) AS at FROM replies WHERE message_id = ? AND author_id = ? AND created_at >= ?', messageId, memberId, startedAt)?.at
          if (firstReply) jobSpan?.addEvent('reply.start', { 'team.ms_since_job_start': msSince(firstReply), 'team.ms_since_message': Math.max(0, firstReply - message.created_at) }, firstReply)
          const st = reader.state()
          const result = st.result
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
              runSql(db, 'UPDATE jobs SET cost_usd = ? WHERE id = ?', result.total_cost_usd, job.id) // UD-256, also when the job fails after
            }
          }
          return { r, st, result }
        })
      } finally {
        await cleanup(dirs)
      }
      ctx.signal.throwIfAborted()
      const { r, result } = outcome
      if (r.timedOut) throw permanent(`La sesión superó el tiempo máximo de ${Math.round(x.timeoutMs / 1000)} s.`, 'execute_timeout')
      if (r.spawnError?.code === 'ENOENT') throw permanent(`No se encontró «${x.runner === 'machine' ? '/bin/sh' : x.bin}» (EXECUTE_CLAUDE_BIN).`, 'harness_unavailable')
      if (r.phase === 'create') throw permanent(`La orden que crea la máquina terminó con código ${r.code}: ${r.stderr.trim().slice(0, 300) || 'sin mensaje'}`, 'machine_create_failed')
      if (!result) throw permanent(`claude -p terminó con código ${r.code} sin línea «result»: ${r.stderr.trim().slice(0, 300) || 'sin mensaje'}`, 'execute_no_result')
      if (result.is_error) throw permanent(`claude -p informó un error (${result.subtype ?? 'sin subtipo'}): ${String(result.result ?? '').slice(0, 300)}`, 'execute_error')
      if (result.structured_output === undefined || result.structured_output === null) throw permanent('La sesión terminó sin salida estructurada.', 'invalid_output')
      if (!validate(result.structured_output)) {
        throw permanent(`La salida estructurada no cumple el formato: ${ajv.errorsText(validate.errors).slice(0, 300)}`, 'invalid_output')
      }
      const body = replyBody(result.structured_output, template)

      return () => {
        // Inside the transaction that closes the job: the closing reply, then the end of the progress.
        const { replyId } = addReply({ db, events, now }, { messageId, authorId: agent.id, body, kind: 'answer' })
        const finalAt = now()
        jobSpan?.addEvent('reply.final', { 'team.ms_since_job_start': msSince(finalAt), 'team.ms_since_message': Math.max(0, finalAt - message.created_at) }, finalAt)
        events.publishForJob(job.id, { kind: 'progress', percent: 100, phrase: step('answered'), data: { message_id: messageId } })
        events.publishForJob(job.id, {
          kind: 'done',
          data: { status: 'done', message_id: String(messageId), reply_id: String(replyId), session_id: outcome.st.sessionId, cost_usd: result.total_cost_usd ?? null }
        })
      }
    },

    onDeferred (job, deferral) {
      const { message_id: messageId } = parseJson(job.payload_json, {})
      events.publishForJob(job.id, { kind: 'progress', percent: 0, phrase: deferral.phrase, data: { message_id: messageId } })
    },

    onFailure (job, error, outcome) {
      const { message_id: messageId } = parseJson(job.payload_json, {})
      if (outcome.state === 'failed') {
        events.publishForJob(job.id, { kind: 'done', data: { status: 'failed', message_id: messageId ? String(messageId) : null, error: String(error?.message ?? error), error_code: error?.code ?? null } })
      } else if (outcome.state === 'requeued') {
        events.publishForJob(job.id, { kind: 'progress', percent: 0, phrase: step('retry', { n: job.attempts, total: job.max_attempts }), data: { message_id: messageId } })
      }
    }
  }
}

export const executeTeamScript = resolve(TEAM_SCRIPT)
