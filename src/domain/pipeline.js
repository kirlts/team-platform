// Manejadores de trabajos (MASTER-SPEC §2 pasos 2 a 4). El trabajo `analyze` extrae cada adjunto pendiente,
// arma el paquete y llama al analizador; el trabajo `extract` extrae un solo adjunto. Todo número de avance
// sale de pasos completados sobre pasos totales, nunca de un reloj (§7.10).
//
// Un manejador es { run(job, ctx) → finalize?, onFailure(job, error, outcome), onDeferred(job, deferral) }:
//   run         trabaja sin transacción abierta (las llamadas a proveedores son lentas) y devuelve una función
//               síncrona `finalize` con las escrituras finales. El worker la ejecuta en la MISMA transacción
//               que cierra el trabajo, con la barrera de intento: si el arriendo se perdió, no se aplica nada.
//   onFailure   refleja en el input el fallo del intento (reintento o fallo definitivo).
//   onDeferred  el trabajo se aplazó sin gastar intento (presupuesto de audio).

import { all, get, run } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { parseDomains } from './members.js'
import { permanent } from './errors.js'
import { transitionInput } from './inputs.js'
import { blobPath } from './storage.js'

// Códigos de ExtractError que pueden pasar solos al reintentar (red del sitio del enlace). Todo otro
// ExtractError es una propiedad del adjunto (formato, tamaño, duración, archivo ilegible) y no mejora
// reintentando: falla de inmediato con su motivo (src/contracts.md).
const EXTRACT_TRANSIENT = new Set(['link_timeout', 'link_fetch_failed'])

// Errores del analizador y de los proveedores que se repetirían igual: configuración, rechazo, corte, salida
// inválida, entrada o plantilla mal formadas, ejecutable ausente. Los de red y plazo sí se reintentan.
const ANALYSIS_FINAL_CODES = new Set(['input', 'template', 'harness_unavailable', 'config', 'refusal', 'max_tokens', 'invalid_output', 'unsupported'])

/** Señal interna: el presupuesto de audio por hora no alcanza; el worker aplaza el trabajo sin gastar el intento. */
export class Deferred extends Error {
  constructor (delayMs, phrase) {
    super(phrase)
    this.deferMs = delayMs
    this.phrase = phrase
  }
}

/** `onProgress` de extractores es (percent, frase); el del analizador, ({ percent, phrase }). Se aceptan las dos. */
const normalizeProgress = (a, b) => (a !== null && typeof a === 'object' ? [a.percent, a.phrase] : [a, b])

export function createPipeline ({ db, config, queue, events, modules, now = Date.now }) {
  const attachmentForExtractor = (a) => ({
    id: a.id,
    input_id: a.input_id,
    kind: a.kind,
    name: a.name,
    mime: a.mime,
    size: a.size,
    sha256: a.sha256,
    // Archivos: ruta absoluta en el volumen. Enlaces: la URL.
    path: a.kind === 'link' ? a.path : blobPath(config, a.sha256)
  })

  /**
   * Presupuesto de audio por hora (MS §7.4): antes de gastar transcripción se consulta; si no cabe, el trabajo
   * se aplaza hasta que la ventana libere lugar. Se anota el consumo al empezar a extraer.
   */
  async function reserveAudio (pending, ctx) {
    const budget = modules.audioBudget
    const estimate = modules.estimateAudioSeconds
    if (!budget || !estimate) return
    let secondsCount = 0
    for (const a of pending) {
      if (a.kind === 'audio' || a.kind === 'video') secondsCount += await estimate(attachmentForExtractor(a), { signal: ctx.signal })
    }
    if (secondsCount === 0) return
    const verdict = budget.check(secondsCount, now())
    if (!verdict.allowed) {
      if (!Number.isFinite(verdict.waitMs)) {
        throw permanent('El audio de este envío supera el presupuesto de transcripción por hora y nunca cabría.', 'audio_budget_exceeded')
      }
      throw new Deferred(verdict.waitMs, 'Esperando cupo de transcripción')
    }
    budget.record(secondsCount, now())
  }

  function demand (moduleRef, nameValue) {
    if (!moduleRef) throw permanent(`El módulo de ${nameValue} no está disponible en esta instalación.`, 'module_unavailable')
    return moduleRef
  }

  async function extractAttachment (job, ctx, att, onProgress) {
    const extract = demand(modules.extract, 'extractores')
    let outText
    try {
      // `config` del extractor son sobrescrituras de sus perillas, no la configuración de la aplicación.
      outText = await extract(attachmentForExtractor(att), { providers: modules.getProviders(), onProgress, signal: ctx.signal })
    } catch (error) {
      if (error?.name === 'ExtractError') {
        const nameValue = att.kind === 'link' ? att.path : (att.name || att.kind)
        const wrapped = new Error(`«${nameValue}»: ${error.message}`, { cause: error })
        wrapped.code = error.code
        wrapped.attachmentId = att.id
        wrapped.retryable = EXTRACT_TRANSIENT.has(error.code)
        throw wrapped
      }
      throw error
    }
    if (!outText || typeof outText.text !== 'string') throw new Error(`El extractor de «${att.name || att.kind}» no devolvió texto.`)
    // Escribir es una sola sentencia: no hace falta transacción ni se retiene el candado durante la llamada.
    run(db, 'UPDATE attachments SET extracted_text = ?, extracted_at = ?, extract_meta_json = ? WHERE id = ?',
      outText.text, now(), JSON.stringify(outText.meta ?? {}), att.id)
  }

  /** Avance global = (pasos terminados + fracción del paso actual) / pasos totales. */
  function meter (job, ctx, totalSteps) {
    let lastSeqValue = { percent: -1, phrase: null }
    return (stepsDone, fraction, phraseText) => {
      const rawValue = ((stepsDone + Math.max(0, Math.min(1, fraction))) / totalSteps) * 100
      const percent = Math.min(99, Math.floor(rawValue)) // el 100 lo marca el evento `done`
      // Sólo se escribe lo que cambia: cada evento es un commit con fsync (131 por segundo con FULL, I03 §2.3).
      if (percent === lastSeqValue.percent && phraseText === lastSeqValue.phrase) return
      lastSeqValue = { percent, phrase: phraseText }
      if (!queue.progress(job, percent, phraseText)) ctx.abort('lost')
    }
  }

  /** Mensaje visible de un resultado de dominio del analizador que no es `ok`. */
  function reasonOfResult (r) {
    if (r.status === 'refusal') return `El proveedor rechazó analizar el contenido${r.explanation ? `: ${r.explanation}` : '.'}`
    if (r.status === 'max_tokens') return 'La respuesta del modelo se cortó por tamaño, incluso con el doble de límite.'
    if (r.reason === 'mece_conflict') return 'El análisis no logró repartir el contenido sin solapes ni huecos.'
    return `El modelo devolvió una salida inválida tras el reintento${r.errors?.length ? `: ${String(r.errors[0]).slice(0, 300)}` : '.'}`
  }

  /** Normaliza la propuesta: cada mensaje lleva su área y plantilla (si la raíz las trae, se heredan). */
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

        const pending = all(db, 'SELECT * FROM attachments WHERE input_id = ? AND extracted_at IS NULL ORDER BY id', inputId)
        const total = all(db, 'SELECT id FROM attachments WHERE input_id = ?', inputId).length
        const totalSteps = pending.length + 1 // cada extracción pendiente y el análisis
        const advance = meter(job, ctx, totalSteps)

        await reserveAudio(pending, ctx)
        if (pending.length > 0) transitionInput(db, inputId, 'extracting', { now })
        for (let i = 0; i < pending.length; i++) {
          const a = pending[i]
          const ordinal = total - pending.length + i + 1
          advance(i, 0, `Leyendo adjunto ${ordinal} de ${total}`)
          await extractAttachment(job, ctx, a, (percent, phraseText) => advance(i, (percent ?? 0) / 100, phraseText || `Leyendo adjunto ${ordinal} de ${total}`))
          ctx.signal.throwIfAborted()
        }

        transitionInput(db, inputId, 'analyzing', { now })
        advance(pending.length, 0, 'Analizando')
        const atts = all(db, 'SELECT id, kind, name, extracted_text FROM attachments WHERE input_id = ? ORDER BY id', inputId)
          .map((a) => ({ id: a.id, kind: a.kind, name: a.name, extracted: a.extracted_text ?? '' }))
        const bundle = {
          text: input.text,
          attachments: atts,
          areas: all(db, 'SELECT id, title, description, position FROM areas WHERE deleted_at IS NULL ORDER BY position, id'),
          templates: all(db, 'SELECT t.id, t.area_id, t.name, t.description, t.body_markdown FROM templates t JOIN areas a ON a.id = t.area_id WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL ORDER BY t.id'),
          members: all(db, 'SELECT id, name, responsibilities, domains FROM members ORDER BY id').map((m) => ({ ...m, domains: parseDomains(m.domains).join(', ') }))
        }

        let result
        try {
          result = await analyze(bundle, {
            providers: modules.getProviders(),
            analyzer: modules.getAnalyzer(),
            onProgress: (a, b) => {
              const [percent, phraseText] = normalizeProgress(a, b)
              advance(pending.length, (percent ?? 0) / 100, phraseText || 'Analizando')
            },
            signal: ctx.signal
          })
        } catch (error) {
          // Las llamadas ya hechas quedan en `spans` (y en la vista llm_calls) aunque el trabajo falle: cada
          // proveedor abre su propio span (UD-014).
          if (ANALYSIS_FINAL_CODES.has(error.code)) error.retryable = false
          throw error
        }
        ctx.signal.throwIfAborted()
        if (result?.status !== 'ok') {
          // Rechazo, corte o salida inválida: no mejoran reintentando igual. Falla con el motivo visible.
          throw permanent(reasonOfResult(result ?? {}), result?.status ?? 'invalid')
        }
        const proposalObj = normalizeProposal(result.proposal)
        if (!proposalObj) throw permanent('El analizador devolvió una propuesta con forma inválida.', 'proposal_invalid')

        return () => {
          // Dentro de la transacción que cierra el trabajo. Cada mensaje lleva su área y plantilla.
          run(db, `INSERT INTO proposals (input_id, payload_json, units_json, created_at) VALUES (?, ?, ?, ?)
                   ON CONFLICT(input_id) DO UPDATE SET payload_json = excluded.payload_json, units_json = excluded.units_json, created_at = excluded.created_at`,
          inputId, JSON.stringify(proposalObj), JSON.stringify((result.units ?? []).map((u) => ({ id: u.id, text: u.text }))), now())
          transitionInput(db, inputId, 'proposed', { now })
          events.publishForJob(job.id, { kind: 'progress', percent: 100, phrase: 'Propuesta lista' })
          events.publishForJob(job.id, { kind: 'done', data: { status: 'done', input_status: 'proposed' } })
        }
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
            events.publishForJob(job.id, { kind: 'progress', percent: 0, phrase: `Falló el intento ${job.attempts} de ${job.max_attempts}; se reintenta` })
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
        const { attachment_id: id } = parseJson(job.payload_json, {})
        const att = get(db, 'SELECT * FROM attachments WHERE id = ?', id)
        if (!att) throw permanent('El adjunto del trabajo ya no existe.', 'attachment_missing')
        const advance = meter(job, ctx, 1)
        await extractAttachment(job, ctx, att, (percent, phraseText) => advance(0, (percent ?? 0) / 100, phraseText || 'Leyendo adjunto'))
        return () => events.publishForJob(job.id, { kind: 'done', data: { status: 'done' } })
      },
      onFailure (job, error, outcome) {
        if (outcome.state === 'failed') events.publishForJob(job.id, { kind: 'done', data: { status: 'failed', error: String(error?.message ?? error), error_code: error?.code ?? null } })
      }
    }
  }

  return handlers
}
