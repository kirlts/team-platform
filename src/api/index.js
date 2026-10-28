// The API (MASTER-SPEC §7.1, §4.11): Fastify 5, the only door. It also serves the static panel and publishes its
// OpenAPI 3.1 contract generated from the route schemas (`GET /api/openapi.json`).
// Routes under `config.apiPrefix` (/api by default, §7.8); /health also at the root for Docker probes.

import { createHash } from 'node:crypto'
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
import { getProjectName, getProviderSettings, getUiTelemetryEnabled } from '../domain/settings.js'
import { installErrorHandler, schemaErrorFormatter } from './errors.js'
import { installSecurityHeaders } from './security.js'
import { installCompression } from './compression.js'
import { mountedIndex } from './mount.js'
import { cookieSpec } from '../identity/cookies.js'
import { hostEntryUrl, identitySources } from '../config.js'
import { noAccessPage, THEME_SCRIPT } from './notice-page.js'
import { registerIdentity } from '../identity/index.js'
import { isRoleGoverned } from '../identity/delegated.js'
import { loadBlocklist } from '../identity/password.js'
import { registerEventRoutes } from '../events/routes.js'
import { changeOfWrite } from '../events/changes.js'
import { registerInputRoutes } from './routes/inputs.js'
import { registerMessageRoutes } from './routes/messages.js'
import { registerAreaRoutes } from './routes/areas.js'
import { registerHostRoutes } from './routes/host.js'
import { registerMemberRoutes } from './routes/members.js'
import { registerConnectionRoutes } from './routes/connections.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerAttachmentRoutes } from './routes/attachments.js'
import { registerOpsRoutes } from './routes/ops.js'
import { registerTelemetryRoutes } from './routes/telemetry.js'
import { errorSchema, member as memberSchema } from './schemas.js'
import { createVault, loadMasterKey } from '../domain/vault.js'
import { buriedHandoffs } from '../domain/escalation.js'
import { installAgentAuth } from '../execute/agent-auth.js'
import { CONTRACT_VERSION } from '../execute/contract-version.js'
import { registerExecuteRoutes } from '../execute/routes.js'
import { isActivePerson } from '../domain/members.js'
import { machineHealth } from '../execute/machines.js'


const LABELS = { telemetry: 'Telemetry', auth: 'Session', me: 'Session', inputs: 'Inputs', messages: 'Messages', areas: 'Areas and templates', templates: 'Areas and templates', members: 'Team', settings: 'Settings', attachments: 'Attachments', events: 'Events', jobs: 'Operations', ops: 'Operations', audit: 'Operations', health: 'Operations', openapi: 'Operations' }

/**
 * Builds the application. `deps`: { db, config, queue, events, modules, logger }. It neither listens nor starts the worker.
 * `logger`: a pino instance, `true` to create one from the configuration, or `false` for silence (tests).
 * Returns { app, domainEvents, identity, openapi }.
 */
const THEME_ASSET_TYPES = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

export async function buildApp ({ db, config, queue, events, modules = {}, logger = false, now = Date.now, telemetry = null }) {
  const { version } = config
  const app = Fastify({
    ...(logger === false ? { logger: false } : { loggerInstance: logger === true ? createLogger(config) : logger }),
    trustProxy: config.trustedProxies, // exact list of IPs or CIDRs, never `true` (report 04 §2.4)
    forceCloseConnections: true, // an open SSE stream hangs `app.close()` (report 03, M5)
    connectionTimeout: config.uploads.idleTimeoutMs, // a client that went silent does not keep an upload and its temporary file for ever
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', useDefaults: true, allErrors: false } },
    schemaErrorFormatter
  })
  const domainEvents = new EventEmitter() // 'template.saved': the analyzer warms its schema on the event
  installErrorHandler(app)
  installSecurityHeaders(app, config)
  installCompression(app, config.compression)

  // ---- OpenAPI 3.1 contract, generated from the route schemas. It is registered before them.
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'team-platform API',
        version,
        description: 'The only door of the system: the panel and any other client use this same contract. Ids travel as text; every list is { items, page, limit, total } capped at 100; every destructive operation requires ?confirm=true.'
      },
      servers: [{ url: '/' }],
      components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: cookieSpec(config).name, description: 'Session cookie issued by POST /api/auth/login.' } } },
      security: [{ session: [] }]
    },
    transform ({ schema, url, route }) {
      const copyOf = { ...schema }
      const lookupKey = url.replace(config.apiPrefix, '').split('/').filter(Boolean)[0] ?? 'health'
      copyOf.tags = [LABELS[lookupKey] ?? 'Other']
      if (route?.config?.public) copyOf.security = []
      // Errors share one shape; they are declared once in each documented route.
      copyOf.response = { '4XX': { description: 'Error: { code, message }.', ...errorSchema }, ...(schema.response ?? {}) }
      if (route?.method === 'POST' && url === `${config.apiPrefix}/inputs`) {
        // The upload is multipart and the handler reads it; the schema only serves the documentation.
        copyOf.consumes = ['multipart/form-data']
        copyOf.body = {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text of the input.' },
            files: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Attached files (image, video, audio, document).' },
            links: { type: 'array', items: { type: 'string', format: 'uri' }, description: 'Links.' }
          }
        }
      }
      if (route?.method === 'POST' && /\/messages\/\{id\}\/replies$|\/messages\/:id\/replies$/.test(url)) {
        // Besides JSON, a reply accepts multipart with media; the handler reads it, the schema only documents it.
        copyOf.body = {
          ...copyOf.body,
          content: {
            ...copyOf.body?.content,
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  body: { type: 'string', description: 'Texto de la respuesta; puede faltar si hay archivos o enlaces.' },
                  kind: { type: 'string', enum: ['answer', 'fix', 'clarification'] },
                  files: { type: 'array', items: { type: 'string', format: 'binary' }, description: 'Archivos adjuntos.' },
                  links: { type: 'array', items: { type: 'string', format: 'uri' }, description: 'Enlaces.' }
                }
              }
            }
          }
        }
      }
      if (route?.method === 'PATCH' && url === `${config.apiPrefix}/settings/project`) {
        // Besides JSON, the description may come as a .md file; the handler reads it, the schema only documents it.
        copyOf.body = {
          ...copyOf.body,
          content: {
            ...copyOf.body?.content,
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary', description: 'Archivo .md que reemplaza la descripción.' },
                  description: { type: 'string', description: 'Texto markdown que reemplaza la descripción (alternativa al archivo).' }
                }
              }
            }
          }
        }
      }
      return { schema: copyOf, url }
    }
  })

  // ---- Cross-origin: only if origins are declared (CORS_ORIGINS). Empty = same origin, no CORS.
  if (config.corsOrigins.length > 0) {
    await app.register(fastifyCors, {
      origin: config.corsOrigins,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['content-type', 'accept', 'last-event-id', 'x-team-request'],
      exposedHeaders: ['retry-after', 'content-range', 'accept-ranges']
    })
  }

  // ---- Static panel under BASE_PATH (H-3721). It is registered before the route policies: its files are public.
  const basePath = config.basePath
  const indexFile = path.join(config.panelDist, 'index.html')
  const hasPanel = existsSync(indexFile)
  if (hasPanel) {
    await app.register(fastifyStatic, {
      root: config.panelDist,
      prefix: basePath,
      wildcard: false, // only files that exist; everything else falls to the 404 handler
      index: false,
      // The build leaves each asset next to its .br and .gz (panel/scripts/precompress.mjs): the one the browser accepts is sent
      // as it is, and the compressed copies are not routes of their own.
      preCompressed: true,
      globIgnore: ['**/*.br', '**/*.gz'],
      // index.html always goes through the 404 handler, which writes the mount point into it.
      allowedPath: (pathName) => pathName !== '/index.html',
      // Hashed assets: long, immutable cache. index.html: no cache (report 03 §7.3, I07 §8).
      setHeaders (reply, routePath) {
        reply.header('cache-control', path.relative(config.panelDist, routePath).startsWith(`assets${path.sep}`)
          ? `public, max-age=${config.assetsMaxAgeSeconds}, immutable`
          : 'no-cache')
      }
    })
  } else {
    app.log.warn(`No compiled panel at ${config.panelDist}; only the API is served.`)
  }
  if (config.themeCss) {
    // The host's tokens (THEME_CSS), read on each request so that editing the file needs no restart.
    // `no-cache` with a validator: the browser asks every time and the answer is a 304 with no body while the file is the same.
    app.get(`${basePath}theme.css`, { config: { public: true }, schema: { hide: true } }, async (request, reply) => {
      const css = readFileSync(config.themeCss)
      const etag = `W/"${createHash('sha256').update(css).digest('base64url')}"`
      reply.header('cache-control', 'no-cache').header('etag', etag)
      if (request.headers['if-none-match'] === etag) return reply.code(304).send()
      return reply.type('text/css; charset=utf-8').send(css)
    })
    // Fonts and images next to the theme file, so the sheet can say url(theme/<file>) under font-src 'self'.
    const themeDir = path.dirname(config.themeCss)
    app.get(`${basePath}theme/:file`, { config: { public: true }, schema: { hide: true } }, async (request, reply) => {
      const file = request.params.file
      const type = THEME_ASSET_TYPES[path.extname(file).toLowerCase()]
      const full = path.join(themeDir, file)
      if (!type || file !== path.basename(file) || !existsSync(full)) return reply.code(404).send({ error: 'not_found' })
      return reply.header('cache-control', 'public, max-age=86400').type(type).send(readFileSync(full))
    })
  }
  const apiPrefixPath = config.apiPrefix
  const hostEntry = identitySources(config.identity).includes('sso-redirect') ? null : hostEntryUrl(config.identity) // UD-308
  // The theme script of the server's own pages (notice-page.js): script-src is 'self', so it cannot be inline.
  app.get(`${basePath}notice-theme.js`, { config: { public: true }, schema: { hide: true } }, async (request, reply) => reply.header('cache-control', 'no-cache').type('text/javascript; charset=utf-8').send(THEME_SCRIPT))
  app.setNotFoundHandler(async (request, reply) => {
    const routePath = request.raw.url.split('?')[0]
    const isApi = routePath === apiPrefixPath || routePath.startsWith(`${apiPrefixPath}/`)
    const isAsset = routePath.startsWith(`${basePath}assets/`)
    const inPanel = routePath.startsWith(basePath) || `${routePath}/` === basePath
    // SPA routes: index.html only for GET under BASE_PATH, outside the API and the assets (a missing asset is a real 404).
    if (hasPanel && inPanel && !isApi && !isAsset && (request.method === 'GET' || request.method === 'HEAD')) {
      // UD-308: with a host governing identity, a page without a valid session goes to the host's entry, never to a form of our own.
      if (hostEntry) {
        let found = null
        try { found = await identity.provider.identify(request) } catch { /* an invalid credential counts as none */ }
        if (!found) {
          // The entry is this very installation (the default `/session/login` in a mode with no entry of its own): redirecting would loop.
          if (hostEntry.startsWith('/') && !hostEntry.startsWith('//') && routePath === hostEntry.split('?')[0]) {
            const trustedName = config.identity.delegated.trustedHeaderName
            request.log.warn({ address: request.ip, header: trustedName in request.headers ? 'present' : 'absent' }, 'identity: a page reached the host entry address with no host identity (header absent, or its address is outside TRUSTED_PROXIES)')
            return reply.code(401).header('cache-control', 'no-store').type('text/html; charset=utf-8').send(noAccessPage(config, request))
          }
          const sep = hostEntry.includes('?') ? '&' : '?'
          return reply.header('cache-control', 'no-store').redirect(`${hostEntry}${sep}next=${encodeURIComponent(request.raw.url)}`, 302)
        }
      }
      return reply.header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(mountedIndex(readFileSync(indexFile, 'utf8'), config))
    }
    return reply.code(404).send({ code: 'not_found', message: isApi ? 'La ruta de la API no existe.' : 'No se encontró el recurso.' })
  })

  await app.register(fastifyMultipart, {
    // I03 §7.2: without setting the five limits, the default is 1 MiB per file and 1,000 parts.
    limits: {
      fileSize: Math.max(config.uploads.maxVideoBytes, config.uploads.maxImageBytes, config.uploads.maxAudioBytes, config.uploads.maxDocumentBytes),
      files: config.uploads.maxFiles,
      fieldSize: config.uploads.maxTextBytes,
      fields: 2 + config.uploads.maxLinks + 1, // I03 §7.2: text or body, kind (replies, UD-017), each link and a one-field margin
      parts: config.uploads.maxFiles + config.uploads.maxLinks + 3 // I03 §7.2: files, links, the text field, kind and a one-field margin
    }
  })

  // ---- Identity. From here on each route must declare its policy.
  const identity = await registerIdentity(app, { db, config, now })
  const { requireRole } = identity
  // Agent members enter by a signed header with their own secret (UD-255); the hook runs before every `requireRole`.
  const vault = modules.vault ?? createVault(loadMasterKey({ dataDir: config.dataDir }))
  installAgentAuth(app, { db, config, vault, now })
  const blocklist = loadBlocklist(config.identity.password.blocklistFile)
  let eventStreams = { closeAll () {} }
  const ctx = { db, config, queue, events, requireRole, identity, modules, blocklist, domainEvents, telemetry, vault }

  const healthHandler = async (request) => {
    const migrated = userVersion(db) === latestVersion()
    get(db, 'SELECT 1 AS ok') // if the database does not respond, this throws and /health returns 500: it is what must be able to turn red
    if (!migrated) throw new AppError(503, 'unavailable', 'La base no está migrada.')
    // UD-269 invariant: a message whose latest result from the agent asks for a person and that nobody holds. Zero when healthy; the probe turns `degraded`.
    const buried = buriedHandoffs(db)
    // B4 invariant: a machine whose DESTROY ran and did not exit 0 is still alive and costing. Zero when healthy; the probe turns `degraded` (it is tried again when the worker starts).
    const machines = machineHealth(db)
    const basic = { status: buried.length === 0 && machines.failed.length === 0 ? 'ok' : 'degraded', version, contract_version: CONTRACT_VERSION }
    // The detail (database, queue, providers) is for an active person of the team: an anonymous probe only sees whether the service is alive.
    let caller = null
    try { caller = await identity.provider.identify(request) } catch { /* no identity: basic response */ }
    if (!caller || !isActivePerson(db, caller.member_id)) return basic
    return {
      ...basic,
      db: { status: 'ok', schema_version: userVersion(db), journal_mode: db.prepare('PRAGMA journal_mode').get().journal_mode },
      queue: queue.stats(),
      worker: config.worker.mode,
      providers: (modules.getProviders?.()?.describe?.() ?? []).map((s) => ({ slot: s.slot, provider: s.provider, model: s.model, available: s.available, reason: s.reason })),
      analyzer: getProviderSettings(db, config).analyzer,
      handoffs: { buried: buried.length, messages: buried.map((b) => ({ message_id: String(b.message_id), result: b.result })) },
      machines: { open: machines.open, destroy_failed: machines.failed.length, failed: machines.failed }
    }
  }
  const healthSchema = {
    summary: 'Service status (the detail of database, queue and providers is for a person of the team only)',
    response: {
      200: {
        type: 'object',
        properties: {
          status: { type: 'string' }, version: { type: 'string' }, contract_version: { type: 'integer', description: 'Version of the host contract this core implements (docs/CONTRATO-DE-ANFITRION.md).' },
          db: { type: 'object', additionalProperties: true }, queue: { type: 'object', additionalProperties: true }, worker: { type: 'string' },
          providers: { type: 'array', items: { type: 'object', additionalProperties: true } }, analyzer: { type: 'string' }, handoffs: { type: 'object', additionalProperties: true },
          machines: { type: 'object', additionalProperties: true, description: 'Machines of the execute job without a recorded destruction: `open` (the ones of running jobs included) and `failed`, those whose DESTROY did not exit 0 (the status turns degraded).' }
        }
      },
      503: { description: 'The database is not migrated or does not respond.', ...errorSchema }
    }
  }

  let openapiDoc = null
  await app.register(async (api) => {
    // A write that went through leaves its screens stale: the team learns it by the event stream (src/events/changes.js).
    api.addHook('onResponse', async (request, reply) => {
      const change = changeOfWrite({ method: request.method, routeUrl: request.routeOptions?.url, params: request.params ?? {}, status: reply.statusCode, prefix: apiPrefixPath })
      if (change) events.publish({ kind: 'message', data: change })
    })
    identity.registerRoutes(api)
    api.get('/me', {
      onRequest: [requireRole('member')],
      schema: {
        summary: 'The signed-in person and the project name',
        response: { 200: { type: 'object', properties: { ...memberSchema.properties, project_name: { type: 'string' }, provider: { type: 'string' }, source: { type: 'string', description: 'De dónde salió la identidad en esta petición: session (la cookie propia) o la fuente del anfitrión (jwt, signed-header, trusted-header).' }, role_managed_externally: { type: 'boolean' }, logout_url: { type: ['string', 'null'] }, password_min_length: { type: 'integer' }, ui_telemetry: { type: 'object', properties: { enabled: { type: 'boolean' }, max_events: { type: 'integer' } } } } } }
      }
    }, async (request) => {
      const dbRow = get(db, `SELECT ${MEMBER_COLUMNS} FROM members WHERE id = ?`, request.member.id)
      // The minimum length is the server's (PASSWORD_MIN_LENGTH): the panel says it before the person types, it does not repeat a number of its own.
      return { ...toMember(dbRow), project_name: getProjectName(db, config), provider: identity.provider.name, source: request.member.source, role_managed_externally: isRoleGoverned(db, request.member.id), logout_url: config.identity.logoutUrl || null, password_min_length: config.identity.password.minLength, ui_telemetry: { enabled: getUiTelemetryEnabled(db, config), max_events: config.uiTelemetry.maxEvents } }
    })
    api.get('/health', { config: { public: true }, schema: healthSchema }, healthHandler)
    api.get('/openapi.json', {
      config: { public: true },
      schema: { hide: true, summary: 'OpenAPI 3.1 contract of this API', response: { 200: { type: 'object', additionalProperties: true } } }
    }, async () => { openapiDoc ??= app.swagger(); return openapiDoc })
    registerInputRoutes(api, ctx)
    registerMessageRoutes(api, ctx)
    registerAreaRoutes(api, ctx)
    registerMemberRoutes(api, ctx)
    registerHostRoutes(api, ctx)
    registerSettingsRoutes(api, ctx)
    registerConnectionRoutes(api, ctx)
    registerAttachmentRoutes(api, ctx)
    registerOpsRoutes(api, ctx)
    registerExecuteRoutes(api, ctx)
    registerTelemetryRoutes(api, ctx)
    eventStreams = await registerEventRoutes(api, { db, config, events, requireRole })
  }, { prefix: apiPrefixPath })
  app.get('/health', { config: { public: true }, schema: { hide: true, ...healthSchema } }, healthHandler)

  app.addHook('preClose', async () => eventStreams.closeAll())
  return { app, domainEvents, identity }
}
