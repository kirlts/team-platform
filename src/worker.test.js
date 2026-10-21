import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from './db/index.js'
import { Deferred } from './domain/pipeline.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from './testing/helpers.js'

const rapido = { identity: { login: { ipMax: 1000 } }, worker: { retryBaseMs: 5, retryMaxMs: 20 } }

async function entorno (opts = {}) {
  const env = await makeEnv({ config: rapido, ...opts, config: { ...rapido, ...(opts.config ?? {}), worker: { ...rapido.worker, ...(opts.config?.worker ?? {}) } } })
  await addMember(env, { email: 'ana@x.org' })
  env.ana = await login(env, 'ana@x.org')
  env.enviar = async (texto, archivos = []) => (await postInput(env, env.ana, { text: texto }, archivos)).json()
  env.input = (id) => get(env.db, 'SELECT * FROM inputs WHERE id = ?', id)
  env.estado = (id) => env.input(id).status
  return env
}
const txt = (n = 'a.txt') => ({ field: 'files', name: n, type: 'text/plain', content: 'contenido' })

test('éxito: el avance sale de pasos completados y termina en 100 con done', async () => {
  const env = await entorno({ worker: true })
  const { input_id: id, job_id: jobId } = await env.enviar('hola', [txt('1.txt'), txt('2.txt')].map((a, i) => ({ ...a, content: `c${i}` })))
  await until(() => env.estado(id) === 'proposed')
  const progresos = all(env.db, "SELECT percent, phrase FROM job_events WHERE job_id = ? AND kind = 'progress' ORDER BY seq", jobId)
  const porcentajes = progresos.map((p) => p.percent)
  assert.deepEqual([...porcentajes].sort((a, b) => a - b), porcentajes) // nunca retrocede
  assert.equal(porcentajes.at(-1), 100)
  assert.ok(porcentajes.every((p) => Number.isInteger(p) && p >= 0 && p <= 100))
  assert.ok(progresos.some((p) => /Leyendo adjunto 2 de 2/.test(p.phrase)))
  assert.ok(progresos.some((p) => p.phrase === 'Analizando' || p.phrase === 'Propuesta lista'))
  const hecho = get(env.db, "SELECT * FROM job_events WHERE job_id = ? AND kind = 'done'", jobId)
  assert.equal(JSON.parse(hecho.data_json).status, 'done')
  assert.equal(get(env.db, 'SELECT status FROM jobs WHERE id = ?', jobId).status, 'done')
  // La propuesta queda con sus mensajes y las unidades.
  assert.equal(JSON.parse(get(env.db, 'SELECT payload_json FROM proposals').payload_json).messages.length, 1)
  await env.close()
})

test('extractores y análisis reciben el contrato: adjunto con ruta absoluta, sin config de la aplicación', async () => {
  const vistos = {}
  const env = await entorno({
    worker: true,
    modules: {
      extract: async (a, opts) => { vistos.extract = { a, claves: Object.keys(opts).sort() }; return { text: 'x', meta: {} } },
      analyze: async (bundle, opts) => { vistos.analyze = { bundle, claves: Object.keys(opts).sort() }; return fakeAnalyze(bundle, opts) },
      getAnalyzer: () => 'harness'
    }
  })
  const { input_id: id } = await env.enviar('texto', [txt()])
  await until(() => env.estado(id) === 'proposed')
  assert.ok(vistos.extract.a.path.startsWith('/'))
  assert.deepEqual(vistos.extract.claves, ['onProgress', 'providers', 'signal'])
  assert.deepEqual(Object.keys(vistos.extract.a).sort(), ['id', 'input_id', 'kind', 'mime', 'name', 'path', 'sha256', 'size'])
  assert.deepEqual(vistos.analyze.claves, ['analyzer', 'onProgress', 'providers', 'signal'])
  assert.equal(vistos.analyze.bundle.templates[0].body_markdown.startsWith('---'), true)
  assert.ok(vistos.analyze.bundle.areas.every((a) => a.position !== undefined))
  assert.equal(typeof vistos.analyze.bundle.members[0].domains, 'string')
  await env.close()
})

test('un ExtractError definitivo falla de inmediato, con su código y el nombre del adjunto, sin reintentos', async () => {
  const env = await entorno({
    worker: true,
    modules: { extract: async () => { throw Object.assign(new Error('El video supera los 20 minutos.'), { name: 'ExtractError', code: 'video_too_long' }) } }
  })
  const { input_id: id, job_id: jobId } = await env.enviar('x', [txt('clase.txt')])
  await until(() => env.estado(id) === 'failed')
  const fila = env.input(id)
  assert.equal(fila.error_code, 'video_too_long')
  assert.match(fila.error, /«clase\.txt»: El video supera los 20 minutos\./)
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 1)
  const hecho = JSON.parse(get(env.db, "SELECT data_json FROM job_events WHERE kind = 'done'").data_json)
  assert.equal(hecho.status, 'failed')
  assert.equal(hecho.error_code, 'video_too_long')
  const vista = (await env.app.inject({ url: `/api/inputs/${id}`, headers: { cookie: env.ana } })).json()
  assert.equal(vista.error_code, 'video_too_long') // el código llega al cliente
  await env.close()
})

test('un fallo transitorio se reintenta con retroceso y termina bien; el input vuelve a «queued» mientras espera', async () => {
  let llamadas = 0
  const estados = []
  const env = await entorno({
    worker: true,
    modules: { analyze: async (b, o) => { llamadas++; estados.push(llamadas); if (llamadas < 3) throw new Error('503 del proveedor'); return fakeAnalyze(b, o) } }
  })
  const { input_id: id, job_id: jobId } = await env.enviar('x')
  await until(() => env.estado(id) === 'proposed')
  assert.equal(llamadas, 3)
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 3)
  const frases = all(env.db, "SELECT phrase FROM job_events WHERE job_id = ? AND kind = 'progress'", jobId).map((f) => f.phrase)
  assert.ok(frases.some((f) => /Falló el intento 1 de 3; se reintenta/.test(f)))
  await env.close()
})

test('agotados los intentos el input falla con el último motivo', async () => {
  const env = await entorno({ worker: true, modules: { analyze: async () => { throw new Error('el proveedor no responde') } } })
  const { input_id: id, job_id: jobId } = await env.enviar('x')
  await until(() => env.estado(id) === 'failed')
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 3)
  assert.equal(env.input(id).error, 'el proveedor no responde')
  await env.close()
})

test('los errores de configuración del proveedor y del analizador no se reintentan; las llamadas hechas quedan en llm_calls', async () => {
  const env = await entorno({
    worker: true,
    modules: {
      analyze: async () => {
        throw Object.assign(new Error('Falta ANTHROPIC_API_KEY'), { code: 'config', calls: [{ step: 'classify', provider: 'anthropic', model: 'claude-haiku-5-5', usage: { input_tokens: 500, output_tokens: 0 }, duration_ms: 5 }] })
      }
    }
  })
  const { input_id: id, job_id: jobId } = await env.enviar('x')
  await until(() => env.estado(id) === 'failed')
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 1)
  assert.equal(env.input(id).error_code, 'config')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM llm_calls WHERE job_id = ?', jobId).n, 1) // cuesta aunque el trabajo falle
  await env.close()
})

test('resultados de dominio del analizador que no son ok (refusal, max_tokens, invalid) fallan con el motivo, sin reintento', async () => {
  const casos = [
    [{ status: 'refusal', explanation: 'política de contenido' }, /rechazó analizar el contenido: política de contenido/, 'refusal'],
    [{ status: 'max_tokens' }, /se cortó por tamaño/, 'max_tokens'],
    [{ status: 'invalid', reason: 'mece_conflict' }, /solapes ni huecos/, 'invalid'],
    [{ status: 'invalid', errors: ['falta area_id'] }, /salida inválida.*falta area_id/, 'invalid']
  ]
  for (const [resultado, motivo, codigo] of casos) {
    const env = await entorno({ worker: true, modules: { analyze: async () => ({ ...resultado, units: [], calls: [{ provider: 'p', model: 'm', usage: { input_tokens: 1 } }] }) } })
    const { input_id: id, job_id: jobId } = await env.enviar('x')
    await until(() => env.estado(id) === 'failed')
    assert.match(env.input(id).error, motivo)
    assert.equal(env.input(id).error_code, codigo)
    assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 1)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM llm_calls').n, 1)
    await env.close()
  }
})

test('un analizador que aún devuelve área y plantilla en la raíz se normaliza a una por mensaje', async () => {
  const env = await entorno({
    worker: true,
    modules: {
      analyze: async (b) => {
        const r = await fakeAnalyze(b)
        const { area_id, template_id, ...m } = r.proposal.messages[0]
        return { ...r, proposal: { area_id, template_id, messages: [m], discarded: [] } }
      }
    }
  })
  const { input_id: id } = await env.enviar('x')
  await until(() => env.estado(id) === 'proposed')
  const payload = JSON.parse(get(env.db, 'SELECT payload_json FROM proposals').payload_json)
  assert.ok(Number.isInteger(payload.messages[0].area_id) && Number.isInteger(payload.messages[0].template_id))
  assert.equal(payload.area_id, undefined)
  await env.close()
})

test('una propuesta con forma inválida falla con motivo propio', async () => {
  const env = await entorno({ worker: true, modules: { analyze: async () => ({ status: 'ok', proposal: { messages: [{ title: 'sin área' }] }, calls: [] }) } })
  const { input_id: id } = await env.enviar('x')
  await until(() => env.estado(id) === 'failed')
  assert.equal(env.input(id).error_code, 'proposal_invalid')
  await env.close()
})

test('las llamadas de los extractores (meta.calls) quedan en llm_calls con su costo; el audio se cobra por tiempo', async () => {
  const env = await entorno({
    worker: true,
    modules: {
      extract: async () => ({
        text: 'transcripción',
        meta: { calls: [{ modality: 'vision', usage: { input_tokens: 2000, output_tokens: 100 } }, { modality: 'speech', audioSeconds: 1800, requests: 3 }] }
      }),
      getProviders: () => ({ describe: () => [{ slot: 'vision', provider: 'anthropic', model: 'claude-haiku-5-5' }, { slot: 'speech', provider: 'groq-speech', model: 'whisper-large-v3-turbo' }] })
    }
  })
  const { input_id: id } = await env.enviar('x', [txt()])
  await until(() => env.estado(id) === 'proposed')
  const llamadas = all(env.db, "SELECT * FROM llm_calls WHERE provider <> 'doble' ORDER BY id")
  assert.equal(llamadas.length, 2)
  assert.equal(llamadas[0].modality, 'vision')
  assert.ok(Math.abs(llamadas[0].cost_usd - (2000 * 0.10 + 100 * 0.50) / 1e6) < 1e-12)
  assert.equal(llamadas[1].modality, 'speech')
  assert.equal(llamadas[1].provider, 'groq-speech')
  assert.ok(Math.abs(llamadas[1].cost_usd - 0.02) < 1e-12) // 0,5 h a 0,04 USD por hora
  await env.close()
})

test('el presupuesto de audio aplaza el trabajo sin gastar el intento y lo retoma cuando hay cupo', async () => {
  let cupo = false
  const consultas = []
  const env = await entorno({
    worker: true,
    modules: {
      estimateAudioSeconds: async (a) => (a.kind === 'audio' ? 600 : 0),
      audioBudget: { check: (s) => { consultas.push(s); return cupo ? { allowed: true, waitMs: 0 } : { allowed: false, waitMs: 30, reason: 'window_full' } }, record: (s) => consultas.push(`record ${s}`) }
    }
  })
  const { input_id: id, job_id: jobId } = await env.enviar('x', [{ field: 'files', name: 'a.mp3', type: 'audio/mpeg', content: 'sonido' }])
  await until(() => get(env.db, "SELECT COUNT(*) AS n FROM job_events WHERE phrase = 'Esperando cupo de transcripción'").n > 0)
  assert.equal(env.estado(id), 'queued')
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 0) // intento reembolsado
  cupo = true
  await until(() => env.estado(id) === 'proposed')
  assert.ok(consultas.includes('record 600'))
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 1)
  await env.close()
})

test('un audio que nunca cabría en el presupuesto falla con su código', async () => {
  const env = await entorno({
    worker: true,
    modules: { estimateAudioSeconds: async () => 99999, audioBudget: { check: () => ({ allowed: false, waitMs: Infinity, reason: 'exceeds_budget' }), record () {} } }
  })
  const { input_id: id } = await env.enviar('x', [{ field: 'files', name: 'a.mp3', type: 'audio/mpeg', content: 'sonido' }])
  await until(() => env.estado(id) === 'failed')
  assert.equal(env.input(id).error_code, 'audio_budget_exceeded')
  await env.close()
})

test('sin módulo de análisis el trabajo falla con module_unavailable y un mensaje claro', async () => {
  const env = await entorno({ worker: true, modules: { analyze: null } })
  const { input_id: id } = await env.enviar('x')
  await until(() => env.estado(id) === 'failed')
  assert.equal(env.input(id).error_code, 'module_unavailable')
  assert.match(env.input(id).error, /análisis no está disponible/)
  await env.close()
})

test('cancelar con el trabajo en curso lo aborta: no queda propuesta ni cambia el estado', async () => {
  let liberar
  const detenido = new Promise((r) => { liberar = r })
  let abortada = false
  const env = await entorno({
    worker: true,
    modules: {
      analyze: async (b, o) => {
        o.signal.addEventListener('abort', () => { abortada = true })
        await detenido
        return fakeAnalyze(b, o)
      }
    }
  })
  const { input_id: id, job_id: jobId } = await env.enviar('x')
  await until(() => env.estado(id) === 'analyzing')
  const r = await env.app.inject({ method: 'POST', url: `/api/inputs/${id}/cancel`, headers: { cookie: env.ana, 'x-team-request': 'panel' } })
  assert.equal(r.statusCode, 200)
  await until(() => abortada) // la señal llega de inmediato, sin esperar al latido
  liberar()
  await until(() => env.worker.active === 0)
  assert.equal(env.estado(id), 'cancelled')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM proposals').n, 0)
  assert.equal(get(env.db, 'SELECT status FROM jobs WHERE id = ?', jobId).status, 'cancelled')
  await env.close()
})

test('apagar con un trabajo en curso lo devuelve a la cola con el intento reembolsado, sin esperarlo', async () => {
  const env = await entorno({
    worker: true,
    modules: { analyze: (b, o) => new Promise((resolve, reject) => o.signal.addEventListener('abort', () => reject(o.signal.reason))) }
  })
  const { input_id: id, job_id: jobId } = await env.enviar('x')
  await until(() => env.estado(id) === 'analyzing')
  const t0 = Date.now()
  await env.worker.stop()
  assert.ok(Date.now() - t0 < 1000)
  const trabajo = get(env.db, 'SELECT * FROM jobs WHERE id = ?', jobId)
  assert.equal(trabajo.status, 'queued')
  assert.equal(trabajo.attempts, 0)
  // Un worker nuevo retoma el trabajo (como tras reiniciar el proceso).
  let completado = false
  env.modules.analyze = async (b, o) => { completado = true; return fakeAnalyze(b, o) }
  const { createWorker } = await import('./worker.js')
  const { createPipeline } = await import('./domain/pipeline.js')
  const otro = createWorker({ db: env.db, queue: env.queue, events: env.events, config: env.config, handlers: createPipeline({ db: env.db, config: env.config, queue: env.queue, events: env.events, modules: env.modules }) })
  otro.start()
  await until(() => env.estado(id) === 'proposed')
  assert.ok(completado)
  await otro.stop()
  await env.close()
})

test('un worker que muere con el trabajo reclamado: el arriendo vence y otro lo recupera', async () => {
  const env = await entorno({ config: { worker: { leaseMs: 60, heartbeatMs: 20 } } })
  const { input_id: id, job_id: jobId } = await env.enviar('x')
  const reclamado = env.queue.claim('worker-muerto') // reclama y «muere»: nunca latirá ni cerrará
  assert.equal(String(reclamado.id), jobId)
  const { createWorker } = await import('./worker.js')
  const { createPipeline } = await import('./domain/pipeline.js')
  const vivo = createWorker({ db: env.db, queue: env.queue, events: env.events, config: env.config, handlers: createPipeline({ db: env.db, config: env.config, queue: env.queue, events: env.events, modules: env.modules }) })
  vivo.start()
  await until(() => env.estado(id) === 'proposed', { timeoutMs: 4000 })
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 2)
  await vivo.stop()
  await env.close()
})

test('límite de tiempo por trabajo: se aborta y falla con el motivo', async () => {
  const env = await entorno({
    worker: true,
    config: { worker: { maxRuntimeMs: 40, maxAttempts: 1 } },
    modules: { analyze: (b, o) => new Promise((resolve, reject) => o.signal.addEventListener('abort', () => reject(new Error('abortado')))) }
  })
  const { input_id: id } = await env.enviar('x')
  await until(() => env.estado(id) === 'failed')
  assert.match(env.input(id).error, /superó el tiempo máximo/)
  await env.close()
})

test('la concurrencia configurada acota los trabajos simultáneos', async () => {
  let enCurso = 0
  let maximo = 0
  const env = await entorno({
    worker: true,
    config: { worker: { concurrency: 2 } },
    modules: { analyze: async (b, o) => { enCurso++; maximo = Math.max(maximo, enCurso); await new Promise((r) => setTimeout(r, 60)); enCurso--; return fakeAnalyze(b, o) } }
  })
  const ids = []
  for (let i = 0; i < 5; i++) ids.push((await env.enviar(`texto ${i}`)).input_id)
  await until(() => ids.every((id) => env.estado(id) === 'proposed'))
  assert.equal(maximo, 2)
  await env.close()
})

test('Deferred es la señal interna del aplazamiento', () => {
  const d = new Deferred(100, 'x')
  assert.equal(d.deferMs, 100)
})

test('reprocesar: el editor vuelve a encolar el análisis conservando las extracciones', async () => {
  let extracciones = 0
  const env = await entorno({ worker: true, modules: { extract: async () => { extracciones++; return { text: 'x', meta: {} } } } })
  await addMember(env, { email: 'ed@x.org', role: 'editor' })
  const editor = await login(env, 'ed@x.org')
  const { input_id: id } = await env.enviar('x', [txt()])
  await until(() => env.estado(id) === 'proposed')
  const req = (cookie, url) => env.app.inject({ method: 'POST', url: `/api/inputs/${id}${url}`, headers: { cookie, 'x-team-request': 'panel' } })
  assert.equal((await req(env.ana, '/reprocess')).statusCode, 403) // sólo el editor
  const r = await req(editor, '/reprocess')
  assert.equal(r.statusCode, 202)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM proposals').n, 0)
  await until(() => env.estado(id) === 'proposed' && get(env.db, 'SELECT COUNT(*) AS n FROM proposals').n === 1)
  assert.equal(extracciones, 1) // no se extrajo de nuevo
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'input.reprocess'").n, 1)
  // Un input publicado no se reprocesa.
  const v = (await env.app.inject({ url: `/api/inputs/${id}`, headers: { cookie: env.ana } })).json()
  await env.app.inject({ method: 'POST', url: `/api/inputs/${id}/publish`, headers: { cookie: env.ana, 'x-team-request': 'panel' }, payload: { messages: v.proposal.messages } })
  assert.equal((await req(editor, '/reprocess')).statusCode, 409)
  await env.close()
})
