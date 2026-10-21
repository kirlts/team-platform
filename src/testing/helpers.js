// Utilidades de las pruebas: base SQLite efímera en disco (WAL no existe en :memory:), aplicación completa con
// dobles del analizador y los extractores, y ayudas para iniciar sesión y subir archivos. Es soporte de pruebas:
// nada de acá se importa desde el código de producción.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../api/index.js'
import { loadConfig } from '../config.js'
import { initializeDatabase, openInitialized } from '../db/index.js'
import { seedDefaults } from '../db/seed.js'
import { createMember } from '../domain/members.js'
import { createPipeline } from '../domain/pipeline.js'
import { parseTemplate } from '../domain/template-file.js'
import { createEvents } from '../events/index.js'
import { hashPassword } from '../identity/password.js'
import { createQueue } from '../queue/index.js'
import { createWorker } from '../worker.js'
import { run } from '../db/index.js'

export const CLAVE = 'una clave larga de prueba 1' // 27 caracteres: cumple el mínimo de 15

/** Directorio temporal propio de la prueba, dentro de TMPDIR (el de la sesión, no /tmp). */
export function tempDir () {
  return mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-platform-test-'))
}

export function testConfig (dir, overrides = {}) {
  return loadConfig({ DATA_DIR: dir, LOG_LEVEL: "silent" }, overrides)
}

/**
 * Analizador doble con la forma del contrato real: { status, proposal, units, calls, stats }. Elige la primera
 * área con plantilla y devuelve un mensaje con todo el texto y todos los adjuntos.
 */
export const fakeAnalyze = async (bundle, { onProgress } = {}) => {
  onProgress?.({ percent: 50, phrase: 'Analizando' })
  const area = bundle.areas[0]
  const plantilla = bundle.templates.find((t) => t.area_id === area.id)
  return {
    status: 'ok',
    proposal: {
      messages: [{
        area_id: area.id,
        template_id: plantilla.id,
        title: 'Mensaje de prueba',
        body: `${bundle.text}${bundle.attachments.map((a) => `\n[${a.kind}] ${a.extracted}`).join('')}`,
        // Los campos obligatorios de la plantilla elegida, llenados como lo haría el analizador real.
        fields: Object.fromEntries(parseTemplate(plantilla.body_markdown).fields.filter((f) => f.required).map((f) => [f.name, 'dato'])),
        assignee_ids: bundle.members.slice(0, 1).map((m) => m.id),
        attachment_ids: bundle.attachments.map((a) => a.id),
        unit_ids: []
      }],
      discarded: []
    },
    units: [],
    calls: [{ step: 'classify', provider: 'doble', model: 'claude-haiku-5-5', usage: { input_tokens: 1000, output_tokens: 200, cached_tokens: 0 }, duration_ms: 12, outcome: 'ok' }],
    stats: {}
  }
}

/** Extractor doble: devuelve el texto «extraído de <nombre>» y avanza por pasos. */
export const fakeExtract = async (attachment, { onProgress } = {}) => {
  onProgress?.(40, 'leyendo')
  onProgress?.(100, 'listo')
  return { text: `extraído de ${attachment.kind}`, meta: { kind: attachment.kind, calls: [] } }
}

/**
 * Entorno completo. `modules` reemplaza los dobles; `worker: true` arranca un worker (por omisión no, para que
 * la prueba controle cuándo corre). Devuelve todo lo necesario y un `close()`.
 */
export async function makeEnv ({ config: overrides = {}, modules = {}, worker = false, seed = true, clock = false } = {}) {
  const dir = tempDir()
  const config = testConfig(dir, overrides)
  await initializeDatabase(config, { seed: seed ? seedDefaults : null })
  const db = openInitialized(config)
  const events = createEvents({ db })
  const queue = createQueue({ db, config, events })
  const mods = {
    analyze: fakeAnalyze, extract: fakeExtract, getProviders: () => ({ describe: () => [] }), getAnalyzer: () => 'api',
    buildProviders: () => ({}), audioBudget: null, estimateAudioSeconds: null, warmTemplate: null, ...modules
  }
  // `clock`: reloj controlable para la identidad (esperas de login, vencimiento de sesión) sin dormir de verdad.
  const reloj = { t: Date.now() }
  const { app, domainEvents, identity } = await buildApp({ db, config, queue, events, modules: mods, ...(clock ? { now: () => reloj.t } : {}) })
  const handlers = createPipeline({ db, config, queue, events, modules: mods })
  const w = createWorker({ db, queue, events, config, handlers })
  if (worker) w.start()
  return {
    dir, config, db, events, queue, app, clock: reloj, domainEvents, identity, worker: w, modules: mods,
    async close () {
      await w.stop()
      events.stopPolling()
      await app.close()
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** Alta directa de un miembro con contraseña (saltando la API). */
export async function addMember (env, { email, name = email.split('@')[0], role = 'member', password = CLAVE } = {}) {
  const id = createMember(env.db, { email, name, role })
  const hash = await hashPassword(password, env.config.identity.argon2)
  run(env.db, 'INSERT INTO credentials (member_id, password_hash, updated_at) VALUES (?, ?, ?)', id, hash, Date.now())
  return id
}

/** Inicia sesión por la API y devuelve la cabecera Cookie lista para usar. */
export async function login (env, email, password = CLAVE) {
  const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  if (res.statusCode !== 200) throw new Error(`login ${res.statusCode}: ${res.body}`)
  const c = res.cookies[0]
  return `${c.name}=${c.value}`
}

/** Cuerpo multipart para `inject`, armado con FormData de Node. */
export async function multipart (campos = {}, archivos = []) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) for (const valor of [].concat(v)) fd.append(k, valor)
  for (const a of archivos) fd.append(a.field ?? 'files', new Blob([a.content], { type: a.type }), a.name)
  const res = new Response(fd)
  return { payload: Buffer.from(await res.arrayBuffer()), headers: { 'content-type': res.headers.get('content-type') } }
}

export async function postInput (env, cookie, campos, archivos = []) {
  const { payload, headers } = await multipart(campos, archivos)
  return env.app.inject({ method: 'POST', url: '/api/inputs', payload, headers: { ...headers, cookie, 'x-team-request': 'panel' } })
}

/** Espera a que `fn` devuelva un valor verdadero, reintentando sobre un evento de la cola (sin reloj fijo). */
export async function until (fn, { timeoutMs = 5000, everyMs = 10 } = {}) {
  const limite = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > limite) throw new Error('until: se agotó el tiempo esperando la condición')
    await new Promise((r) => setTimeout(r, everyMs))
  }
}
