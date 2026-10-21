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
import { llmCostUsd, speechCostUsd } from './costs.js'
import { parseDomains } from './members.js'
import { permanent } from './errors.js'
import { transitionInput } from './inputs.js'
import { blobPath } from './storage.js'

// Códigos de ExtractError que pueden pasar solos al reintentar (red del sitio del enlace). Todo otro
// ExtractError es una propiedad del adjunto (formato, tamaño, duración, archivo ilegible) y no mejora
// reintentando: falla de inmediato con su motivo (src/contracts.md).
const EXTRACT_TRANSITORIOS = new Set(['link_timeout', 'link_fetch_failed'])

// Errores del analizador y de los proveedores que se repetirían igual: configuración, rechazo, corte, salida
// inválida, entrada o plantilla mal formadas, ejecutable ausente. Los de red y plazo sí se reintentan.
const ANALISIS_DEFINITIVOS = new Set(['input', 'template', 'harness_unavailable', 'config', 'refusal', 'max_tokens', 'invalid_output', 'unsupported'])

/** Señal interna: el presupuesto de audio por hora no alcanza; el worker aplaza el trabajo sin gastar el intento. */
export class Deferred extends Error {
  constructor (delayMs, phrase) {
    super(phrase)
    this.deferMs = delayMs
    this.phrase = phrase
  }
}

/** `onProgress` de extractores es (percent, frase); el del analizador, ({ percent, phrase }). Se aceptan las dos. */
const normalizarAvance = (a, b) => (a !== null && typeof a === 'object' ? [a.percent, a.phrase] : [a, b])

export function createPipeline ({ db, config, queue, events, modules, now = Date.now }) {
  function registrarLlamada (job) {
    return (llamada) => {
      const r = run(db, `INSERT INTO llm_calls (job_id, provider, model, modality, input_tokens, output_tokens, cached_tokens, cost_usd, duration_ms, at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      job.id, llamada.provider, llamada.model, llamada.modality,
      llamada.input_tokens ?? 0, llamada.output_tokens ?? 0, llamada.cached_tokens ?? 0, llamada.cost_usd ?? 0, llamada.duration_ms ?? 0, now())
      return Number(r.lastInsertRowid)
    }
  }

  /** Llamadas del extractor (`meta.calls`): { modality, usage | audioSeconds, … } (src/contracts.md). */
  function registrarLlamadasDeExtractor (job, calls) {
    const ajustes = modules.getProviders?.()?.describe?.() ?? []
    const registrar = registrarLlamada(job)
    for (const c of calls ?? []) {
      if (!['text', 'vision', 'speech'].includes(c.modality)) continue
      const uso = c.usage ?? {}
      const segundos = c.audioSeconds ?? 0
      const ranura = ajustes.find((s) => s.slot === c.modality)
      const modelo = c.model ?? ranura?.model ?? 'desconocido'
      registrar({
        provider: c.provider ?? ranura?.provider ?? 'desconocido',
        model: modelo,
        modality: c.modality,
        input_tokens: uso.input_tokens ?? 0,
        output_tokens: uso.output_tokens ?? 0,
        cached_tokens: uso.cached_tokens ?? 0,
        // El audio se factura por tiempo, no por tokens (MS §3, UD-008).
        cost_usd: c.cost_usd ?? (segundos > 0 ? speechCostUsd(config, segundos) : llmCostUsd(config, modelo, uso)),
        duration_ms: c.duration_ms ?? 0
      })
    }
  }

  /** Llamadas del analizador (`calls`): { step, provider, model, usage, duration_ms, outcome } → llm_calls. Devuelve el último id. */
  function registrarLlamadasDelAnalizador (job, calls) {
    const registrar = registrarLlamada(job)
    let ultimo = null
    for (const c of calls ?? []) {
      ultimo = registrar({
        provider: c.provider ?? 'desconocido',
        model: c.model ?? 'desconocido',
        modality: c.modality ?? 'text',
        input_tokens: c.usage?.input_tokens ?? 0,
        output_tokens: c.usage?.output_tokens ?? 0,
        cached_tokens: c.usage?.cached_tokens ?? 0,
        cost_usd: c.cost_usd ?? llmCostUsd(config, c.model, c.usage ?? {}),
        duration_ms: c.duration_ms ?? 0
      })
    }
    return ultimo
  }

  const adjuntoParaExtractor = (a) => ({
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
  async function reservarAudio (pendientes, ctx) {
    const presupuesto = modules.audioBudget
    const estimar = modules.estimateAudioSeconds
    if (!presupuesto || !estimar) return
    let segundos = 0
    for (const a of pendientes) {
      if (a.kind === 'audio' || a.kind === 'video') segundos += await estimar(adjuntoParaExtractor(a), { signal: ctx.signal })
    }
    if (segundos === 0) return
    const veredicto = presupuesto.check(segundos, now())
    if (!veredicto.allowed) {
      if (!Number.isFinite(veredicto.waitMs)) {
        throw permanent('El audio de este envío supera el presupuesto de transcripción por hora y nunca cabría.', 'audio_budget_exceeded')
      }
      throw new Deferred(veredicto.waitMs, 'Esperando cupo de transcripción')
    }
    presupuesto.record(segundos, now())
  }

  function exigir (modulo, nombre) {
    if (!modulo) throw permanent(`El módulo de ${nombre} no está disponible en esta instalación.`, 'module_unavailable')
    return modulo
  }

  async function extraerAdjunto (job, ctx, adjunto, onProgress) {
    const extract = exigir(modules.extract, 'extractores')
    let salida
    try {
      // `config` del extractor son sobrescrituras de sus perillas, no la configuración de la aplicación.
      salida = await extract(adjuntoParaExtractor(adjunto), { providers: modules.getProviders(), onProgress, signal: ctx.signal })
    } catch (error) {
      if (error?.name === 'ExtractError') {
        const nombre = adjunto.kind === 'link' ? adjunto.path : (adjunto.name || adjunto.kind)
        const envuelto = new Error(`«${nombre}»: ${error.message}`, { cause: error })
        envuelto.code = error.code
        envuelto.attachmentId = adjunto.id
        envuelto.retryable = EXTRACT_TRANSITORIOS.has(error.code)
        throw envuelto
      }
      throw error
    }
    if (!salida || typeof salida.text !== 'string') throw new Error(`El extractor de «${adjunto.name || adjunto.kind}» no devolvió texto.`)
    registrarLlamadasDeExtractor(job, salida.meta?.calls)
    // Escribir es una sola sentencia: no hace falta transacción ni se retiene el candado durante la llamada.
    run(db, 'UPDATE attachments SET extracted_text = ?, extracted_at = ?, extract_meta_json = ? WHERE id = ?',
      salida.text, now(), JSON.stringify(salida.meta ?? {}), adjunto.id)
  }

  /** Avance global = (pasos terminados + fracción del paso actual) / pasos totales. */
  function medidor (job, ctx, totalPasos) {
    let ultimo = { percent: -1, phrase: null }
    return (pasosHechos, fraccion, frase) => {
      const crudo = ((pasosHechos + Math.max(0, Math.min(1, fraccion))) / totalPasos) * 100
      const percent = Math.min(99, Math.floor(crudo)) // el 100 lo marca el evento `done`
      // Sólo se escribe lo que cambia: cada evento es un commit con fsync (131 por segundo con FULL, I03 §2.3).
      if (percent === ultimo.percent && frase === ultimo.phrase) return
      ultimo = { percent, phrase: frase }
      if (!queue.progress(job, percent, frase)) ctx.abort('lost')
    }
  }

  /** Mensaje visible de un resultado de dominio del analizador que no es `ok`. */
  function motivoDeResultado (r) {
    if (r.status === 'refusal') return `El proveedor rechazó analizar el contenido${r.explanation ? `: ${r.explanation}` : '.'}`
    if (r.status === 'max_tokens') return 'La respuesta del modelo se cortó por tamaño, incluso con el doble de límite.'
    if (r.reason === 'mece_conflict') return 'El análisis no logró repartir el contenido sin solapes ni huecos.'
    return `El modelo devolvió una salida inválida tras el reintento${r.errors?.length ? `: ${String(r.errors[0]).slice(0, 300)}` : '.'}`
  }

  /** Normaliza la propuesta: cada mensaje lleva su área y plantilla (si la raíz las trae, se heredan). */
  function normalizarPropuesta (propuesta) {
    if (!propuesta || !Array.isArray(propuesta.messages)) return null
    const messages = propuesta.messages.map((m) => ({
      ...m,
      area_id: m.area_id ?? propuesta.area_id,
      template_id: m.template_id ?? propuesta.template_id
    }))
    if (messages.some((m) => !Number.isInteger(m.area_id) || !Number.isInteger(m.template_id))) return null
    const { area_id: _a, template_id: _t, ...resto } = propuesta
    return { ...resto, messages }
  }

  const handlers = {
    analyze: {
      async run (job, ctx) {
        const { input_id: inputId } = parseJson(job.payload_json, {})
        const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
        if (!input) throw permanent('El input del trabajo ya no existe.', 'input_missing')
        const analyze = exigir(modules.analyze, 'análisis')

        const pendientes = all(db, 'SELECT * FROM attachments WHERE input_id = ? AND extracted_at IS NULL ORDER BY id', inputId)
        const total = all(db, 'SELECT id FROM attachments WHERE input_id = ?', inputId).length
        const totalPasos = pendientes.length + 1 // cada extracción pendiente y el análisis
        const avanzar = medidor(job, ctx, totalPasos)

        await reservarAudio(pendientes, ctx)
        if (pendientes.length > 0) transitionInput(db, inputId, 'extracting', { now })
        for (let i = 0; i < pendientes.length; i++) {
          const a = pendientes[i]
          const posicion = total - pendientes.length + i + 1
          avanzar(i, 0, `Leyendo adjunto ${posicion} de ${total}`)
          await extraerAdjunto(job, ctx, a, (percent, frase) => avanzar(i, (percent ?? 0) / 100, frase || `Leyendo adjunto ${posicion} de ${total}`))
          ctx.signal.throwIfAborted()
        }

        transitionInput(db, inputId, 'analyzing', { now })
        avanzar(pendientes.length, 0, 'Analizando')
        const adjuntos = all(db, 'SELECT id, kind, name, extracted_text FROM attachments WHERE input_id = ? ORDER BY id', inputId)
          .map((a) => ({ id: a.id, kind: a.kind, name: a.name, extracted: a.extracted_text ?? '' }))
        const bundle = {
          text: input.text,
          attachments: adjuntos,
          areas: all(db, 'SELECT id, title, description, position FROM areas WHERE deleted_at IS NULL ORDER BY position, id'),
          templates: all(db, 'SELECT t.id, t.area_id, t.name, t.description, t.body_markdown FROM templates t JOIN areas a ON a.id = t.area_id WHERE t.deleted_at IS NULL AND a.deleted_at IS NULL ORDER BY t.id'),
          members: all(db, 'SELECT id, name, responsibilities, domains FROM members ORDER BY id').map((m) => ({ ...m, domains: parseDomains(m.domains).join(', ') }))
        }

        let resultado
        try {
          resultado = await analyze(bundle, {
            providers: modules.getProviders(),
            analyzer: modules.getAnalyzer(),
            onProgress: (a, b) => {
              const [percent, frase] = normalizarAvance(a, b)
              avanzar(pendientes.length, (percent ?? 0) / 100, frase || 'Analizando')
            },
            signal: ctx.signal
          })
        } catch (error) {
          // Las llamadas ya hechas cuestan aunque el trabajo falle (contrato del analizador).
          registrarLlamadasDelAnalizador(job, error.calls)
          if (ANALISIS_DEFINITIVOS.has(error.code)) error.retryable = false
          throw error
        }
        const ultimaLlamada = registrarLlamadasDelAnalizador(job, resultado?.calls)
        ctx.signal.throwIfAborted()
        if (resultado?.status !== 'ok') {
          // Rechazo, corte o salida inválida: no mejoran reintentando igual. Falla con el motivo visible.
          throw permanent(motivoDeResultado(resultado ?? {}), resultado?.status ?? 'invalid')
        }
        const propuesta = normalizarPropuesta(resultado.proposal)
        if (!propuesta) throw permanent('El analizador devolvió una propuesta con forma inválida.', 'proposal_invalid')

        return () => {
          // Dentro de la transacción que cierra el trabajo. Cada mensaje lleva su área y plantilla.
          run(db, `INSERT INTO proposals (input_id, area_id, template_id, payload_json, units_json, model_call_id, created_at) VALUES (?, NULL, NULL, ?, ?, ?, ?)
                   ON CONFLICT(input_id) DO UPDATE SET payload_json = excluded.payload_json, units_json = excluded.units_json,
                     model_call_id = excluded.model_call_id, created_at = excluded.created_at`,
          inputId, JSON.stringify(propuesta), JSON.stringify((resultado.units ?? []).map((u) => ({ id: u.id, text: u.text }))), ultimaLlamada, now())
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
            const actual = get(db, 'SELECT status FROM inputs WHERE id = ?', inputId)?.status
            const codigo = error?.code && typeof error.code === 'string' ? error.code : null
            if (actual && actual !== 'cancelled' && actual !== 'published') transitionInput(db, inputId, 'failed', { error: String(error?.message ?? error), errorCode: codigo, now })
            events.publishForJob(job.id, { kind: 'done', data: { status: 'failed', error: String(error?.message ?? error), error_code: codigo, attachment_id: error?.attachmentId ?? null } })
          }
        })
      }
    },

    extract: {
      async run (job, ctx) {
        const { attachment_id: id } = parseJson(job.payload_json, {})
        const adjunto = get(db, 'SELECT * FROM attachments WHERE id = ?', id)
        if (!adjunto) throw permanent('El adjunto del trabajo ya no existe.', 'attachment_missing')
        const avanzar = medidor(job, ctx, 1)
        await extraerAdjunto(job, ctx, adjunto, (percent, frase) => avanzar(0, (percent ?? 0) / 100, frase || 'Leyendo adjunto'))
        return () => events.publishForJob(job.id, { kind: 'done', data: { status: 'done' } })
      },
      onFailure (job, error, outcome) {
        if (outcome.state === 'failed') events.publishForJob(job.id, { kind: 'done', data: { status: 'failed', error: String(error?.message ?? error), error_code: error?.code ?? null } })
      }
    }
  }

  return handlers
}
