// Job handlers (MASTER-SPEC §2 steps 2 to 4). The `analyze` job extracts each pending attachment,
// builds the bundle and calls the analyzer; the `extract` job extracts a single attachment. Every progress number
// comes from completed steps over total steps, never from a clock (§7.10).
//
// A handler is { run(job, ctx) → finalize?, onFailure(job, error, outcome), onDeferred(job, deferral) }:
//   run         works with no open transaction (provider calls are slow) and returns a synchronous
//               `finalize` function with the final writes. The worker runs it in the SAME transaction
//               that closes the job, with the attempt barrier: if the lease was lost, nothing is applied.
//   onFailure   reflects the attempt's failure on the input (retry or final failure).
//   onDeferred  the job was postponed without spending an attempt (audio budget).

import { all, get, run } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { permanent } from './errors.js'
import { ProviderError } from '../providers/errors.js'
import { DEFAULT_LANGUAGE } from './language.js'
import { recentInputsFor, transitionInput } from './inputs.js'
import { autoPublishProposal } from './proposals.js'
import { recipientsOf } from './inputs.js'
import { ensurePersonWhenTouched } from './assessment.js'
import { getAutoPublish, getFraming, getProject } from './settings.js'
import { isStep, keyOf, phraseOf, step } from './progress-phrases.js'
import { blobPath } from './storage.js'

// ExtractError codes that can clear up by themselves on retry (network of the link's site, a tool the system killed). Any other
// ExtractError is a property of the attachment (format, size, duration, unreadable file) and does not improve
// on retry: it fails immediately with its reason (src/contracts.md).
const EXTRACT_TRANSIENT = new Set(['link_timeout', 'link_fetch_failed', 'ffmpeg_killed'])
// A site that answers with these is busy or down, not telling that the page is not there.
const transientHttpStatus = (status) => status === 408 || status === 425 || status === 429 || status >= 500 // HTTP semantics, RFC 9110 §15
const isTransientExtract = (error) => EXTRACT_TRANSIENT.has(error.code) || (error.code === 'link_http_error' && transientHttpStatus(error.details?.status))

// Analyzer and provider errors that would repeat identically: configuration, refusal, cutoff, invalid
// output, malformed input or template, missing executable. Network and timeout ones are retried.
const ANALYSIS_FINAL_CODES = new Set(['input', 'nothing_readable', 'template', 'harness_unavailable', 'config', 'refusal', 'max_tokens', 'invalid_output', 'unsupported'])

/** Internal signal: the hourly audio budget is not enough; the worker postpones the job without spending the attempt. */
export class Deferred extends Error {
  constructor (delayMs, phrase) {
    super(phraseOf(phrase))
    this.deferMs = delayMs
    this.phrase = phrase
  }
}

/** The extractors' `onProgress` is (percent, phrase); the analyzer's is ({ percent, phrase }). Both are accepted. */
// The analyzer notifies `{ percent, phrase, code, vars }` (H-3722); an older one, `{ percent, phrase }` or `(percent, phrase)`.
const normalizeProgress = (a, b) => {
  if (a === null || typeof a !== 'object') return [a, b]
  return [a.percent, typeof a.code === 'string' && isStep({ code: a.code }) ? step(a.code, a.vars ?? {}) : a.phrase]
}

/** The Guards of an area as the analyzer reads them: id and text, and `person` when the Guard is about a person; the mechanism that holds it is the system's, not the model's. */
const guardsList = (text) => { try { return JSON.parse(text ?? '[]').map((g) => ({ id: g.id, text: g.text, ...(g.person ? { person: true } : {}) })) } catch { return [] } }

export function createPipeline ({ db, config, queue, events, modules, now = Date.now }) {
  const attachmentForExtractor = (a) => ({
    id: a.id,
    input_id: a.input_id,
    kind: a.kind,
    name: a.name,
    mime: a.mime,
    size: a.size,
    sha256: a.sha256,
    // Files: absolute path in the volume. Links: the URL.
    path: a.kind === 'link' ? a.path : blobPath(config, a.sha256)
  })

  /**
   * Hourly audio budget (MS §7.4): it is consulted before spending transcription; if it does not fit, the job
   * is postponed until the window frees up room. Consumption is recorded when extraction starts.
   */
  async function reserveAudio (pending, ctx) {
    const budget = modules.audioBudget
    const estimate = modules.estimateAudioSeconds
    if (!budget || !estimate) return
    let secondsCount = 0
    for (const a of pending) {
      if (a.kind !== 'audio' && a.kind !== 'video') continue
      // Measuring the length reads the file: one that cannot be read fails here, with the same reason and the same retry rule as its extraction.
      try { secondsCount += await estimate(attachmentForExtractor(a), { signal: ctx.signal }) } catch (error) { throw readableFailure(a, error, ctx.signal) }
    }
    if (secondsCount === 0) return
    const verdict = budget.check(secondsCount, now())
    if (!verdict.allowed) {
      if (!Number.isFinite(verdict.waitMs)) {
        throw permanent('El audio de este envío supera el presupuesto de transcripción por hora y nunca cabría.', 'audio_budget_exceeded')
      }
      throw new Deferred(verdict.waitMs, step('waiting'))
    }
    budget.record(secondsCount, now())
  }

  function demand (moduleRef, nameValue) {
    if (!moduleRef) throw permanent(`El módulo de ${nameValue} no está disponible en esta instalación.`, 'module_unavailable')
    return moduleRef
  }

  /**
   * What the sender reads when something of an attachment fails: its name and a reason. An ExtractError carries its own and its code says
   * whether a retry can help; a provider error keeps its typed code; anything else (a bug, a file system error) gets `extract_failed`, which
   * the panel translates, instead of a raw message such as «Cannot read properties of undefined».
   */
  function readableFailure (att, error, signal) {
    const nameValue = att.kind === 'link' ? att.path : (att.name || att.kind)
    if (error?.name === 'ExtractError') {
      const wrapped = new Error(`«${nameValue}»: ${error.message}`, { cause: error })
      wrapped.code = error.code
      wrapped.attachmentId = att.id
      wrapped.retryable = isTransientExtract(error)
      return wrapped
    }
    const own = error instanceof ProviderError || error?.name === 'AbortError' || error?.lost || error?.deferMs !== undefined || error?.retryable !== undefined || error?.infra || signal?.aborted
    if (own) return error
    const wrapped = new Error(`«${nameValue}»: no se pudo leer el adjunto (${String(error?.message ?? error).slice(0, 300)}).`, { cause: error })
    wrapped.code = 'extract_failed'
    wrapped.attachmentId = att.id
    return wrapped
  }

  async function extractAttachment (job, ctx, att, onProgress, table = 'attachments') {
    const extract = demand(modules.extract, 'extractores')
    let outText
    try {
      // The extractor's `config` is overrides of its knobs, not the application configuration.
      outText = await extract(attachmentForExtractor(att), { providers: modules.getProviders(), onProgress, signal: ctx.signal })
    } catch (error) {
      throw readableFailure(att, error, ctx.signal)
    }
    if (!outText || typeof outText.text !== 'string') throw new Error(`El extractor de «${att.name || att.kind}» no devolvió texto.`)
    // Writing is a single statement: no transaction is needed and the lock is not held during the call.
    run(db, `UPDATE ${table} SET extracted_text = ?, extracted_at = ?, extract_meta_json = ? WHERE id = ?`,
      outText.text, now(), JSON.stringify(outText.meta ?? {}), att.id)
  }

  /** Overall progress = (finished steps + fraction of the current step) / total steps. */
  function meter (job, ctx, totalSteps) {
    let lastSeqValue = { percent: -1, phrase: null }
    return (stepsDone, fraction, phraseText) => {
      const rawValue = ((stepsDone + Math.max(0, Math.min(1, fraction))) / totalSteps) * 100
      const percent = Math.min(99, Math.floor(rawValue)) // 100 is marked by the `done` event
      // Only what changes is written: each event is a commit with fsync (131 per second with FULL, I03 §2.3).
      if (percent === lastSeqValue.percent && keyOf(phraseText) === lastSeqValue.phrase) return
      lastSeqValue = { percent, phrase: keyOf(phraseText) }
      if (!queue.progress(job, percent, phraseText)) ctx.abort('lost')
    }
  }

  /** Visible message for a domain result of the analyzer that is not `ok`. */
  function reasonOfResult (r) {
    if (r.status === 'refusal') return `El proveedor rechazó analizar el contenido${r.explanation ? `: ${r.explanation}` : '.'}`
    if (r.status === 'max_tokens') return 'La respuesta del modelo se cortó por tamaño, incluso con el doble de límite.'
    if (r.reason === 'mece_conflict') return 'El análisis no logró repartir el contenido sin solapes ni huecos.'
    return `El modelo devolvió una salida inválida tras el reintento${r.errors?.length ? `: ${String(r.errors[0]).slice(0, 300)}` : '.'}`
  }

  /** Normalizes the proposal: each message carries its area and template (if the root has them, they are inherited). */
  function normalizeProposal (proposalObj) {
    if (!proposalObj || !Array.isArray(proposalObj.messages)) return null
    const messages = proposalObj.messages.map((m) => ({
      ...m,
      area_id: m.area_id ?? proposalObj.area_id,
      template_id: m.template_id ?? proposalObj.template_id
    }))
    if (messages.some((m) => !Number.isInteger(m.area_id) || !Number.isInteger(m.template_id))) return null
    const { area_id: _a, template_id: _t, ...rest } = proposalObj
    return { ...rest, messages }
  }

  const handlers = {
    analyze: {
      async run (job, ctx) {
        const { input_id: inputId } = parseJson(job.payload_json, {})
        const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
        if (!input) throw permanent('El input del trabajo ya no existe.', 'input_missing')
        const analyze = demand(modules.analyze, 'análisis')
        // UD-070: an input that is already published is done; a repeated job (queue retry, stray job) neither reads nor writes.
        if (input.status === 'published') return () => events.publishForJob(job.id, { kind: 'done', data: { status: 'done', input_status: 'published' } })

        // Without an active area that has an active template the analysis can never place a message: fail before spending the
        // extraction (a video takes minutes), with a code of its own instead of the analyzer's generic `input`.
        // Only areas that have a template to place a message in: an area without one offered to the model could be chosen, and its group could not be published.
        // UD-295: each area carries its Guards (the walls the analyzer cites by id), next to the description that describes its space.
        const areas = all(db, 'SELECT a.id, a.title, a.description, a.position, a.guards_json FROM areas a WHERE a.deleted_at IS NULL AND EXISTS (SELECT 1 FROM templates t WHERE t.area_id = a.id AND t.deleted_at IS NULL) ORDER BY a.position, a.id')
          .map(({ guards_json: guards, ...a }) => ({ ...a, guards: guardsList(guards) }))
        const templates = all(db, 'SELECT t.id, t.area_id, t.name, t.description, t.body_markdown FROM templates t JOIN areas a ON a.id = t.area_id WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL ORDER BY t.id')
        if (areas.length === 0 || templates.length === 0) {
          throw permanent('No hay áreas con plantilla activa: crea un área con su plantilla y vuelve a procesar el envío.', 'no_areas')
        }

        const pending = all(db, 'SELECT * FROM attachments WHERE input_id = ? AND extracted_at IS NULL ORDER BY id', inputId)
        const total = all(db, 'SELECT id FROM attachments WHERE input_id = ?', inputId).length
        const totalSteps = pending.length + 1 // each pending extraction and the analysis
        const advance = meter(job, ctx, totalSteps)

        await reserveAudio(pending, ctx)
        if (pending.length > 0) transitionInput(db, inputId, 'extracting', { now })
        for (let i = 0; i < pending.length; i++) {
          const a = pending[i]
          const ordinal = total - pending.length + i + 1
          const reading = step('attachmentN', { n: ordinal, total })
          advance(i, 0, reading)
          await extractAttachment(job, ctx, a, (percent, phraseText, s) => advance(i, (percent ?? 0) / 100, s ?? (phraseText || reading)))
          ctx.signal.throwIfAborted()
        }

        const atts = all(db, 'SELECT id, kind, name, extracted_text FROM attachments WHERE input_id = ? ORDER BY id', inputId)
          .map((a) => ({ id: a.id, kind: a.kind, name: a.name, extracted: a.extracted_text ?? '' }))
        transitionInput(db, inputId, 'analyzing', { now })
        advance(pending.length, 0, step('analyzing'))
        // UD-018: the author's language selects the prompts and the language of the output; it travels as context data.
        const author = get(db, 'SELECT language FROM members WHERE id = ?', input.author_id)
        const language = author?.language ?? DEFAULT_LANGUAGE
        const bundle = {
          text: input.text,
          language,
          framing: getFraming(db, language), // H-3722: the Editor's framing for the author's language
          attachments: atts,
          project: getProject(db, config), // UD-024
          areas,
          templates,
          members: all(db, 'SELECT id, name, profile FROM members WHERE active = 1 ORDER BY id').map((m) => ({ id: m.id, name: m.name, profile: m.profile })), // UD-023: the whole profile, no truncation
          // UD-025: the author's other unpublished inputs, as context for the model; nothing is compared or deduplicated here.
          recent_inputs: recentInputsFor({ db, config, now }, input)
        }

        let result
        try {
          result = await analyze(bundle, {
            providers: modules.getProviders(),
            analyzer: modules.getAnalyzer(),
            onProgress: (a, b) => {
              const [percent, phraseText] = normalizeProgress(a, b)
              advance(pending.length, (percent ?? 0) / 100, phraseText || step('analyzing'))
            },
            signal: ctx.signal,
            // UD-021: the second reading describes an image again in more detail when the first one found nothing.
            redescribe: async (a) => {
              const row = get(db, 'SELECT * FROM attachments WHERE id = ?', a.id)
              if (!row || row.kind !== 'image') return null
              const deep = await modules.extract(attachmentForExtractor(row), { providers: modules.getProviders(), signal: ctx.signal, deep: true })
              return deep.text
            }
          })
        } catch (error) {
          // The calls already made stay in `spans` (and in the llm_calls view) even if the job fails: each
          // provider opens its own span (UD-014).
          if (ANALYSIS_FINAL_CODES.has(error.code)) error.retryable = false
          throw error
        }
        ctx.signal.throwIfAborted()
        if (result?.status !== 'ok') {
          // Refusal, cutoff or invalid output: they do not improve on retry either. It fails with the visible reason.
          throw permanent(reasonOfResult(result ?? {}), result?.status ?? 'invalid')
        }
        const proposalObj = normalizeProposal(result.proposal)
        if (!proposalObj) throw permanent('El analizador devolvió una propuesta con forma inválida.', 'proposal_invalid')
        // UD-291: the recipients the sender chose are the assignees of every message; the routing keeps choosing area and template, not people.
        const recipients = recipientsOf(input)
        if (recipients.length > 0) for (const m of proposalObj.messages) m.assignee_ids = [...recipients]
        // UD-295: with no recipients chosen, the routing is automatic, and a Guard about a person that the message touches puts a person among the assignees, next to Claude.
        else for (const m of proposalObj.messages) ensurePersonWhenTouched(db, m, input.author_id)

        return () => {
          // Inside the transaction that closes the job. Each message carries its area and template.
          // Idempotent: a repeated run on an input that is already published (or discarded) writes nothing (UD-070).
          const current = get(db, 'SELECT status FROM inputs WHERE id = ?', inputId)?.status
          if (current === 'published') return
          run(db, `INSERT INTO proposals (input_id, payload_json, units_json, created_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(input_id) DO UPDATE SET payload_json = excluded.payload_json, units_json = excluded.units_json, created_at = excluded.created_at`,
          inputId, JSON.stringify(proposalObj), JSON.stringify((result.units ?? []).map((u) => ({ id: u.id, text: u.text }))), now())
          transitionInput(db, inputId, 'proposed', { now })
          // UD-070: a valid proposal is published right here (UD-072: unless the sender asked for a draft), in this same transaction; otherwise it waits as `proposed`.
          const outcome = getAutoPublish(db) && !get(db, 'SELECT keep_draft FROM inputs WHERE id = ?', inputId).keep_draft ? autoPublishProposal({ db, events, now }, inputId) : { published: false, messageIds: [] }
          events.publishForJob(job.id, { kind: 'progress', percent: 100, phrase: outcome.published ? step('published') : step('proposalReady') })
          events.publishForJob(job.id, {
            kind: 'done',
            data: { status: 'done', input_status: outcome.published ? 'published' : 'proposed', message_ids: outcome.messageIds.map(String) }
          })
        }
      },

      /**
       * The safety net under `onFailure`: an input that waits in `queued`, `extracting` or `analyzing` with no analysis job queued or running will never
       * move (the process died between the queue closing the job and its handler writing the input, a job lost with a purge). If the last job failed, the
       * input fails with that job's reason; otherwise its analysis is queued again, which costs nothing the author gave. A job that ended in the last
       * heartbeat is left to its handler. Returns how many inputs it settled.
       */
      sweep () {
        const settledBefore = now() - config.worker.heartbeatMs
        const live = "SELECT 1 AS ok FROM jobs j WHERE j.input_id = ? AND j.kind = 'analyze' AND j.status IN ('queued', 'running')"
        let settled = 0
        for (const { id } of all(db, `SELECT i.id FROM inputs i WHERE i.status IN ('queued', 'extracting', 'analyzing') AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.input_id = i.id AND j.kind = 'analyze' AND j.status IN ('queued', 'running'))`)) {
          settled += events.transaction(() => {
            const input = get(db, 'SELECT status, updated_at FROM inputs WHERE id = ?', id)
            if (!input || !['queued', 'extracting', 'analyzing'].includes(input.status) || get(db, live, id)) return 0
            const last = get(db, "SELECT id, status, last_error, finished_at FROM jobs WHERE input_id = ? AND kind = 'analyze' ORDER BY id DESC LIMIT 1", id)
            if ((last?.finished_at ?? input.updated_at) > settledBefore) return 0
            if (last?.status === 'failed') {
              const reason = last.last_error ?? 'El análisis falló.'
              transitionInput(db, id, 'failed', { error: reason, errorCode: 'job_failed_unseen', now })
              events.publishForJob(last.id, { kind: 'done', data: { status: 'failed', error: reason, error_code: 'job_failed_unseen', attachment_id: null } })
            } else {
              transitionInput(db, id, 'queued', { now })
              const jobId = queue.enqueue('analyze', { input_id: id }, { inputId: id })
              events.publishForJob(jobId, { kind: 'progress', percent: 0, phrase: step('queued') })
            }
            return 1
          })
        }
        return settled
      },

      onDeferred (job, deferral) {
        const { input_id: inputId } = parseJson(job.payload_json, {})
        events.transaction(() => {
          if (inputId && get(db, 'SELECT status FROM inputs WHERE id = ?', inputId)?.status !== 'cancelled') transitionInput(db, inputId, 'queued', { now })
          events.publishForJob(job.id, { kind: 'progress', percent: 0, phrase: deferral.phrase })
        })
      },

      onFailure (job, error, outcome) {
        const { input_id: inputId } = parseJson(job.payload_json, {})
        if (!inputId) return
        events.transaction(() => {
          if (outcome.state === 'requeued') {
            if (get(db, 'SELECT status FROM inputs WHERE id = ?', inputId)?.status !== 'cancelled') transitionInput(db, inputId, 'queued', { now })
            events.publishForJob(job.id, { kind: 'progress', percent: 0, phrase: step('retry', { n: job.attempts, total: job.max_attempts }) })
          } else if (outcome.state === 'failed') {
            const current = get(db, 'SELECT status FROM inputs WHERE id = ?', inputId)?.status
            const errorCodeValue = error?.code && typeof error.code === 'string' ? error.code : null
            if (current && current !== 'cancelled' && current !== 'published') transitionInput(db, inputId, 'failed', { error: String(error?.message ?? error), errorCode: errorCodeValue, now })
            events.publishForJob(job.id, { kind: 'done', data: { status: 'failed', error: String(error?.message ?? error), error_code: errorCodeValue, attachment_id: error?.attachmentId ?? null } })
          }
        })
      }
    },

    extract: {
      async run (job, ctx) {
        const { attachment_id: id, reply_attachment_id: replyAttachmentId } = parseJson(job.payload_json, {})
        // UD-279: the audio or video of a reply (its own table) is read by the same extractor; the text is stored on its row.
        const att = replyAttachmentId ? get(db, 'SELECT * FROM reply_attachments WHERE id = ?', replyAttachmentId) : get(db, 'SELECT * FROM attachments WHERE id = ?', id)
        if (!att) throw permanent('El adjunto del trabajo ya no existe.', 'attachment_missing')
        const advance = meter(job, ctx, 1)
        await reserveAudio([att], ctx) // an attachment added to a published message transcribes with the same hourly budget as a send
        await extractAttachment(job, ctx, att, (percent, phraseText) => advance(0, (percent ?? 0) / 100, phraseText || 'Lectura de adjunto'), replyAttachmentId ? 'reply_attachments' : 'attachments')
        return () => events.publishForJob(job.id, { kind: 'done', data: { status: 'done' } })
      },
      onFailure (job, error, outcome) {
        if (outcome.state === 'failed') events.publishForJob(job.id, { kind: 'done', data: { status: 'failed', error: String(error?.message ?? error), error_code: error?.code ?? null } })
      }
    }
  }

  return handlers
}
