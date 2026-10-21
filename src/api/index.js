// La API (MASTER-SPEC §7.1, §4.11): Fastify 5, la única puerta. Sirve también el panel estático y publica su
// contrato OpenAPI 3.1 generado de los esquemas de las rutas (`GET /api/openapi.json`).
// Rutas bajo `config.apiPrefix` (/api por omisión, §7.8); /health además en la raíz para los sondeos de Docker.

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyMultipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import fastifySwagger from '@fastify/swagger'
import { EventEmitter } from 'node:events'
import { get, latestVersion, userVersion } from '../db/index.js'
import { AppError } from '../domain/errors.js'
import { MEMBER_COLUMNS, toMember } from '../domain/members.js'
import { createLogger } from '../log.js'
import { getProviderSettings } from '../domain/settings.js'
import { installErrorHandler, schemaErrorFormatter } from './errors.js'
import { installSecurityHeaders } from './security.js'
import { cookieSpec } from '../identity/cookies.js'
import { registerIdentity } from '../identity/index.js'
import { loadBlocklist } from '../identity/password.js'
import { registerEventRoutes } from '../events/routes.js'
import { registerInputRoutes } from './routes/inputs.js'
import { registerMessageRoutes } from './routes/messages.js'
import { registerAreaRoutes } from './routes/areas.js'
import { registerMemberRoutes } from './routes/members.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerAttachmentRoutes } from './routes/attachments.js'
import { registerOpsRoutes } from './routes/ops.js'
import { errorSchema, member as memberSchema } from './schemas.js'


const LABELS = { auth: 'Sesión', me: 'Sesión', inputs: 'Inputs', messages: 'Mensajes', areas: 'Áreas y plantillas', templates: 'Áreas y plantillas', members: 'Equipo', settings: 'Configuración', attachments: 'Adjuntos', events: 'Eventos', jobs: 'Operación', audit: 'Operación', health: 'Operación', openapi: 'Operación' }

/**
 * Arma la aplicación. `deps`: { db, config, queue, events, modules, logger }. No escucha ni arranca el worker.
 * `logger`: instancia pino, `true` para crear una desde la configuración, o `false` para silencio (pruebas).
 * Devuelve { app, domainEvents, identity, openapi }.
 */
export async function buildApp ({ db, config, queue, events, modules = {}, logger = false, now = Date.now, telemetry = null }) {
  const { version } = config
  const app = Fastify({
    ...(logger === false ? { logger: false } : { loggerInstance: logger === true ? createLogger(config) : logger }),
    trustProxy: config.trustedProxies, // lista exacta de IP o CIDR, nunca `true` (informe 04 §2.4)
    forceCloseConnections: true, // un flujo SSE abierto cuelga `app.close()` (informe 03, M5)
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', useDefaults: true, allErrors: false } },
    schemaErrorFormatter
  })
  const domainEvents = new EventEmitter() // 'template.saved': el analizador calienta su esquema por evento
  installErrorHandler(app)
  installSecurityHeaders(app, config)

  // ---- Contrato OpenAPI 3.1, generado de los esquemas de las rutas. Se registra antes que ellas.
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'team-platform API',
        version,
        description: 'La única puerta del sistema: el panel y cualquier otro cliente usan este mismo contrato. Los ids viajan como texto; toda lista es { items, page, limit, total } con tope de 100; toda operación destructiva exige ?confirm=true.'
      },
      servers: [{ url: '/' }],
      components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: cookieSpec(config).name, description: 'Cookie de sesión que entrega POST /api/auth/login.' } } },
      security: [{ session: [] }]
    },
    transform ({ schema, url, route }) {
      const copyOf = { ...schema }
      const lookupKey = url.replace(config.apiPrefix, '').split('/').filter(Boolean)[0] ?? 'health'
      copyOf.tags = [LABELS[lookupKey] ?? 'Otros']
      if (route?.config?.public) copyOf.security = []
      // Los errores comparten una forma; se declaran una vez en cada ruta documentada.
      copyOf.response = { '4XX': { description: 'Error: { code, message }.', ...errorSchema }, ...(schema.response ?? {}) }
      if (route?.method === 'POST' && url === `${config.apiPrefix}/inputs`) {
        // La subida es multipart y la lee el manejador; el esquema sólo sirve a la documentación.
        copyOf.consumes = ['multipart/form-data']
        copyOf.body = {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Texto del input.' },
            files: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Archivos adjuntos (imagen, video, audio, documento).' },
            links: { type: 'array', items: { type: 'string', format: 'uri' }, description: 'Enlaces.' }
          }
        }
      }
      return { schema: copyOf, url }
    }
  })

  // ---- Origen cruzado: sólo si se declaran orígenes (CORS_ORIGINS). Vacío = mismo origen, sin CORS.
  if (config.corsOrigins.length > 0) {
    await app.register(fastifyCors, {
      origin: config.corsOrigins,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['content-type', 'accept', 'last-event-id', 'x-team-request'],
      exposedHeaders: ['retry-after', 'content-range', 'accept-ranges']
    })
  }

  // ---- Panel estático. Se registra antes de las políticas de ruta: sus archivos son públicos.
  const hasPanel = existsSync(path.join(config.panelDist, 'index.html'))
  if (hasPanel) {
    await app.register(fastifyStatic, {
      root: config.panelDist,
      wildcard: false, // sólo los archivos que existen; lo demás cae al manejador de 404
      index: false,
      // Activos con hash: caché larga e inmutable. index.html: sin caché (informe 03 §7.3, I07 §8).
      setHeaders (reply, routePath) {
        reply.header('cache-control', path.relative(config.panelDist, routePath).startsWith(`assets${path.sep}`)
          ? `public, max-age=${config.assetsMaxAgeSeconds}, immutable`
          : 'no-cache')
      }
    })
  } else {
    app.log.warn(`No hay panel compilado en ${config.panelDist}; sólo se sirve la API.`)
  }
  const apiPrefixPath = config.apiPrefix
  app.setNotFoundHandler((request, reply) => {
    const routePath = request.raw.url.split('?')[0]
    const isApi = routePath === apiPrefixPath || routePath.startsWith(`${apiPrefixPath}/`)
    const isAsset = routePath.startsWith('/assets/')
    // Rutas de la SPA: index.html sólo a GET fuera de /api y de /assets (un activo ausente es un 404 de verdad).
    if (hasPanel && !isApi && !isAsset && (request.method === 'GET' || request.method === 'HEAD')) {
      return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(readFileSync(path.join(config.panelDist, 'index.html')))
    }
    return reply.code(404).send({ code: 'not_found', message: isApi ? 'La ruta de la API no existe.' : 'No se encontró el recurso.' })
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
  const ctx = { db, config, queue, events, requireRole, identity, modules, blocklist, domainEvents, telemetry }

  const healthHandler = async (request) => {
    const migrated = userVersion(db) === latestVersion()
    get(db, 'SELECT 1 AS ok') // si la base no responde, esto lanza y /health devuelve 500: es lo que debe poder ponerse rojo
    if (!migrated) throw new AppError(503, 'unavailable', 'La base no está migrada.')
    const basic = { status: 'ok', version }
    // El detalle (base, cola, proveedores) es del editor: un sondeo anónimo sólo ve si el servicio vive.
    let caller = null
    try { caller = await identity.provider.identify(request) } catch { /* sin identidad: respuesta básica */ }
    if (caller?.role !== 'editor') return basic
    return {
      ...basic,
      db: { status: 'ok', schema_version: userVersion(db), journal_mode: db.prepare('PRAGMA journal_mode').get().journal_mode },
      queue: queue.stats(),
      worker: config.worker.mode,
      providers: (modules.getProviders?.()?.describe?.() ?? []).map((s) => ({ slot: s.slot, provider: s.provider, model: s.model, available: s.available, reason: s.reason })),
      analyzer: getProviderSettings(db, config).analyzer
    }
  }
  const healthSchema = {
    summary: 'Estado del servicio (el detalle de base, cola y proveedores, sólo para el editor)',
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' }, version: { type: 'string' },
          db: { type: 'object', additionalProperties: true }, queue: { type: 'object', additionalProperties: true }, worker: { type: 'string' },
          providers: { type: 'array', items: { type: 'object', additionalProperties: true } }, analyzer: { type: 'string' }
        }
      },
      503: { description: 'La base no está migrada o no responde.', ...errorSchema }
    }
  }

  let openapiDoc = null
  await app.register(async (api) => {
    identity.registerRoutes(api)
    api.get('/me', {
      onRequest: [requireRole('member')],
      schema: {
        summary: 'La persona con sesión y el nombre del proyecto',
        response: { 200: { type: 'object', properties: { ...memberSchema.properties, project_name: { type: 'string' }, provider: { type: 'string' } } } }
      }
    }, async (request) => {
      const dbRow = get(db, `SELECT ${MEMBER_COLUMNS} FROM members WHERE id = ?`, request.member.id)
      return { ...toMember(dbRow), project_name: config.projectName, provider: identity.provider.name }
    })
    api.get('/health', { config: { public: true }, schema: healthSchema }, healthHandler)
    api.get('/openapi.json', {
      config: { public: true },
      schema: { hide: true, summary: 'Contrato OpenAPI 3.1 de esta API', response: { 200: { type: 'object', additionalProperties: true } } }
    }, async () => { openapiDoc ??= app.swagger(); return openapiDoc })
    registerInputRoutes(api, ctx)
    registerMessageRoutes(api, ctx)
    registerAreaRoutes(api, ctx)
    registerMemberRoutes(api, ctx)
    registerSettingsRoutes(api, ctx)
    registerAttachmentRoutes(api, ctx)
    registerOpsRoutes(api, ctx)
    eventStreams = await registerEventRoutes(api, { db, config, events, requireRole })
  }, { prefix: apiPrefixPath })
  app.get('/health', { config: { public: true }, schema: { hide: true, ...healthSchema } }, healthHandler)

  app.addHook('preClose', async () => eventStreams.closeAll())
  return { app, domainEvents, identity }
}
