// La API (MASTER-SPEC §7.1, §4.11): Fastify 5, la única puerta. Sirve también el panel estático.
// Rutas bajo `config.apiPrefix` (/api por omisión, §7.8); /health además en la raíz para los sondeos de Docker.

import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { get } from '../db/index.js'
import { installErrorHandler, schemaErrorFormatter } from './errors.js'
import { installSecurityHeaders } from './security.js'
import { registerIdentity } from '../identity/index.js'
import { loadBlocklist } from '../identity/password.js'
import { registerEventRoutes } from '../events/routes.js'
import { registerInputRoutes } from './routes/inputs.js'
import { registerMessageRoutes } from './routes/messages.js'
import { registerAreaRoutes } from './routes/areas.js'
import { registerMemberRoutes } from './routes/members.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerAttachmentRoutes } from './routes/attachments.js'
import { member as memberSchema } from './schemas.js'

const version = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8')).version

/**
 * Arma la aplicación. `deps`: { db, config, queue, events, modules, logger }. No escucha ni arranca el worker.
 * Devuelve { app, domainEvents, eventStreams }.
 */
export async function buildApp ({ db, config, queue, events, modules = {}, logger = false, now = Date.now }) {
  const app = Fastify({
    logger: logger === false ? false : { level: config.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie'] },
    trustProxy: config.trustedProxies, // lista exacta de IP o CIDR, nunca `true` (informe 04 §2.4)
    forceCloseConnections: true, // un flujo SSE abierto cuelga `app.close()` (informe 03, M5)
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', useDefaults: true, allErrors: false } },
    schemaErrorFormatter
  })
  const domainEvents = new EventEmitter() // 'template.saved': el analizador calienta su esquema por evento
  installErrorHandler(app)
  installSecurityHeaders(app, config)

  // ---- Panel estático. Se registra antes de las políticas de ruta: sus archivos son públicos.
  const hayPanel = existsSync(path.join(config.panelDist, 'index.html'))
  if (hayPanel) {
    await app.register(fastifyStatic, {
      root: config.panelDist,
      wildcard: false, // sólo los archivos que existen; lo demás cae al manejador de 404
      index: false,
      // Activos con hash: caché larga e inmutable. index.html: sin caché (informe 03 §7.3, I07 §8).
      setHeaders (res, ruta) {
        res.setHeader('cache-control', ruta.includes(`${path.sep}assets${path.sep}`)
          ? `public, max-age=${config.assetsMaxAgeSeconds}, immutable`
          : 'no-cache')
      }
    })
  } else {
    app.log.warn(`No hay panel compilado en ${config.panelDist}; sólo se sirve la API.`)
  }
  const prefijoApi = config.apiPrefix
  app.setNotFoundHandler((request, reply) => {
    const ruta = request.raw.url.split('?')[0]
    const esApi = ruta === prefijoApi || ruta.startsWith(`${prefijoApi}/`)
    const esActivo = ruta.startsWith('/assets/')
    // Rutas de la SPA: index.html sólo a GET fuera de /api y de /assets (un activo ausente es un 404 de verdad).
    if (hayPanel && !esApi && !esActivo && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(readFileSync(path.join(config.panelDist, 'index.html')))
    }
    return reply.code(404).send({ code: 'not_found', message: esApi ? 'La ruta de la API no existe.' : 'No se encontró el recurso.' })
  })

  await app.register(fastifyMultipart, {
    // I03 §7.2: sin fijar los cinco límites, la omisión es 1 MiB por archivo y 1.000 partes.
    limits: {
      fileSize: Math.max(config.uploads.maxVideoBytes, config.uploads.maxImageBytes, config.uploads.maxAudioBytes, config.uploads.maxDocumentBytes),
      files: config.uploads.maxFiles,
      fieldSize: config.uploads.maxTextBytes,
      fields: 1 + config.uploads.maxLinks + 1, // text, cada enlace y un margen de un campo
      parts: config.uploads.maxFiles + config.uploads.maxLinks + 2
    }
  })

  // ---- Identidad. A partir de acá cada ruta debe declarar su política.
  const identity = await registerIdentity(app, { db, config, now })
  const { requireRole } = identity
  const blocklist = loadBlocklist(config.identity.password.blocklistFile)
  let eventStreams = { closeAll () {} }
  const ctx = { db, config, queue, events, requireRole, identity, modules, blocklist, domainEvents }

  await app.register(async (api) => {
    identity.registerRoutes(api)
    api.get('/me', {
      onRequest: [requireRole('member')],
      schema: { response: { 200: { type: 'object', properties: { ...memberSchema.properties, provider: { type: 'string' } } } } }
    }, async (request) => {
      const fila = get(db, 'SELECT id, email, name, role, responsibilities, domains, created_at FROM members WHERE id = ?', request.member.id)
      return { ...fila, created_at: new Date(fila.created_at).toISOString(), provider: identity.provider.name }
    })
    api.get('/health', { config: { public: true } }, async () => healthBody(db))
    registerInputRoutes(api, ctx)
    registerMessageRoutes(api, ctx)
    registerAreaRoutes(api, ctx)
    registerMemberRoutes(api, ctx)
    registerSettingsRoutes(api, ctx)
    registerAttachmentRoutes(api, ctx)
    eventStreams = await registerEventRoutes(api, { db, config, events, requireRole })
  }, { prefix: prefijoApi })
  app.get('/health', { config: { public: true } }, async () => healthBody(db))

  app.addHook('preClose', async () => eventStreams.closeAll())
  return { app, domainEvents, identity }
}

function healthBody (db) {
  get(db, 'SELECT 1 AS ok') // si la base no responde, esto lanza y /health devuelve 500: es lo que debe poder ponerse rojo
  return { status: 'ok', version }
}
