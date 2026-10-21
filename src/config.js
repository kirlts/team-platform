// Configuración del servidor. Toda perilla sale de una variable de entorno, con su valor por
// omisión y la fuente que lo justifica (MASTER-SPEC §4.9: un número que gobierna la operación
// nace declarado). «MS» = docs/MASTER-SPEC.md; «I03», «I04», «I07» = docs/investigaciones/.
// Ninguna credencial tiene valor por omisión: las llaves se leen del entorno y nunca se guardan.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Lee un entero; una variable vacía o ausente cuenta como no definida. */
function entero (env, nombre, omision, { min = 0 } = {}) {
  const crudo = env[nombre]
  if (crudo === undefined || crudo === '') return omision
  const n = Number(crudo)
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`La variable ${nombre} debe ser un entero mayor o igual a ${min} (valor: «${crudo}»).`)
  }
  return n
}

function decimal (env, nombre, omision, { min = 0, max = Infinity } = {}) {
  const crudo = env[nombre]
  if (crudo === undefined || crudo === '') return omision
  const n = Number(crudo)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`La variable ${nombre} debe ser un número entre ${min} y ${max} (valor: «${crudo}»).`)
  }
  return n
}

function texto (env, nombre, omision = '') {
  const crudo = env[nombre]
  return crudo === undefined || crudo === '' ? omision : crudo
}

function booleano (env, nombre, omision) {
  const crudo = env[nombre]
  if (crudo === undefined || crudo === '') return omision
  if (['1', 'true', 'si', 'sí'].includes(crudo.toLowerCase())) return true
  if (['0', 'false', 'no'].includes(crudo.toLowerCase())) return false
  throw new Error(`La variable ${nombre} debe ser true o false (valor: «${crudo}»).`)
}

function lista (env, nombre, omision = []) {
  const crudo = env[nombre]
  if (crudo === undefined || crudo === '') return omision
  return crudo.split(',').map((s) => s.trim()).filter(Boolean)
}

function opcion (env, nombre, permitidas, omision) {
  const valor = texto(env, nombre, omision)
  if (!permitidas.includes(valor)) {
    throw new Error(`La variable ${nombre} debe ser una de: ${permitidas.join(', ')} (valor: «${valor}»).`)
  }
  return valor
}

const MIB = 1024 * 1024
const GIB = 1024 * MIB

/**
 * Carga la configuración desde un entorno. `overrides` reemplaza valores ya resueltos
 * (lo usan las pruebas); no pasa por la validación del entorno.
 */
export function loadConfig (env = process.env, overrides = {}) {
  const dataDir = path.resolve(texto(env, 'DATA_DIR', path.join(raiz, 'data')))

  const config = {
    raiz,

    // ---- Red y servidor
    host: texto(env, 'HOST', '0.0.0.0'), // dentro de un contenedor; el compose publica el puerto en loopback
    port: entero(env, 'PORT', 3000),
    apiPrefix: texto(env, 'API_PREFIX', '/api'), // MS §7.8: el panel llama a /api; 404 JSON bajo /api
    publicUrl: texto(env, 'PUBLIC_URL', ''), // sólo lo exige el modo sso-redirect
    logLevel: texto(env, 'LOG_LEVEL', 'info'),
    // I04 §11 TRUSTED_PROXIES: omisión de Gitea; Fastify exige lista exacta de IP o CIDR, nunca `true`.
    trustedProxies: lista(env, 'TRUSTED_PROXIES', ['127.0.0.0/8', '::1/128']),
    allowedOrigins: lista(env, 'ALLOWED_ORIGINS', []), // orígenes extra aceptados por la defensa CSRF
    frameAncestors: texto(env, 'FRAME_ANCESTORS', "'none'"), // se amplía sólo si la aplicación vive en un iframe
    panelDist: path.resolve(texto(env, 'PANEL_DIST', path.join(raiz, 'panel', 'dist'))),
    // I03 §7.3: activos con hash, caché larga e inmutable (README de @fastify/static, 30 días en el ejemplo
    // del informe; un año es lo que usa el proyecto con el que se contrastó en I07 §8).
    assetsMaxAgeSeconds: entero(env, 'ASSETS_MAX_AGE_SECONDS', 31536000),

    // ---- Datos
    dataDir,
    dbFile: path.resolve(texto(env, 'DB_FILE', path.join(dataDir, 'team.db'))),
    attachmentsDir: path.join(dataDir, 'attachments'),
    tmpDir: path.join(dataDir, 'tmp'),
    backupsDir: path.join(dataDir, 'backups'),
    templatesDir: path.resolve(texto(env, 'TEMPLATES_DIR', path.join(raiz, 'templates'))),
    sqlite: {
      busyTimeoutMs: entero(env, 'SQLITE_BUSY_TIMEOUT_MS', 5000), // MS §3, I03 §12: 0 errores contra 19.040 con 0
      synchronous: opcion(env, 'SQLITE_SYNCHRONOUS', ['FULL', 'NORMAL'], 'FULL') // MS §3, I03 §2.3: FULL es durable
    },

    // ---- Cola (MS §7.3, I03 §12)
    worker: {
      mode: opcion(env, 'WORKER_MODE', ['inline', 'external', 'off'], 'inline'), // MS §7.3: mismo proceso por omisión
      leaseMs: entero(env, 'QUEUE_LEASE_MS', 30000, { min: 1 }),
      heartbeatMs: entero(env, 'QUEUE_HEARTBEAT_MS', 10000, { min: 1 }), // mínimo de latido de pg-boss: 10 s
      maxAttempts: entero(env, 'QUEUE_MAX_ATTEMPTS', 3, { min: 1 }), // retryLimit de pg-boss más el primer intento
      retryBaseMs: entero(env, 'QUEUE_RETRY_BASE_MS', 1000, { min: 1 }),
      retryMaxMs: entero(env, 'QUEUE_RETRY_MAX_MS', 60000, { min: 1 }), // I03 §12: derivado del límite por minuto de Groq
      // Jitter completo (fracción del retraso que se resta al azar). I03 §3.4 cita a walq para el mecanismo y
      // la guía de AWS [F41] para el principio, sin fijar la fracción: 1 es el «full jitter» de esa guía.
      retryJitter: decimal(env, 'QUEUE_RETRY_JITTER', 1, { min: 0, max: 1 }),
      concurrency: entero(env, 'QUEUE_CONCURRENCY', 1, { min: 1 }), // única perilla de convención (I03 §12)
      maxRuntimeMs: entero(env, 'QUEUE_MAX_RUNTIME_MS', 900000, { min: 1 }), // expireInSeconds de pg-boss: 900 s
      retentionDays: entero(env, 'RETENTION_DAYS', 7, { min: 1 }), // deleteAfterSeconds de pg-boss: 7 días
      // Cortesía: la retención se mide en días, un barrido por hora la cumple con holgura. No gobierna la
      // operación de ningún trabajo.
      retentionSweepMs: entero(env, 'RETENTION_SWEEP_MS', 3600000, { min: 1 }),
      dataVersionPollMs: entero(env, 'DATA_VERSION_POLL_MS', 100, { min: 1 }) // I03 §12: sólo con worker aparte
    },

    // ---- Eventos (MS §7.10)
    sse: {
      heartbeatMs: entero(env, 'SSE_HEARTBEAT_MS', 15000, { min: 1 }) // I03 §5.1: sugerencia del estándar HTML
    },

    // ---- Subidas. Los topes por tipo son los valores iniciales de MS §7.8 / I07 §6.3; el de video y los
    // ---- «archivos por input» no tienen medición propia (ver cada línea).
    uploads: {
      maxImageBytes: entero(env, 'UPLOAD_MAX_IMAGE_BYTES', 7 * MIB, { min: 1 }), // MS §7.8: imagen 7 MB
      maxAudioBytes: entero(env, 'UPLOAD_MAX_AUDIO_BYTES', 25 * MIB, { min: 1 }), // MS §7.8: audio 25 MB
      maxDocumentBytes: entero(env, 'UPLOAD_MAX_DOCUMENT_BYTES', 25 * MIB, { min: 1 }), // MS §7.8: documento 25 MB
      maxVideoBytes: entero(env, 'UPLOAD_MAX_VIDEO_BYTES', 2 * GIB, { min: 1 }), // MS §7.4: video, tope 2 GB
      // I07 §6.1: Slack acepta hasta 10 archivos arrastrados a la vez. Es el referente, no una medición.
      maxFiles: entero(env, 'UPLOAD_MAX_FILES', 10, { min: 1 }),
      maxLinks: entero(env, 'UPLOAD_MAX_LINKS', 10, { min: 0 }), // mismo referente que los archivos
      // I03 §7.2: la omisión de @fastify/multipart es el bodyLimit de Fastify, 1 MiB; cabe un texto largo.
      maxTextBytes: entero(env, 'UPLOAD_MAX_TEXT_BYTES', MIB, { min: 1 }),
      maxLinkLength: entero(env, 'UPLOAD_MAX_LINK_LENGTH', 8000, { min: 1 }) // RFC 9110 §4.1: se recomienda soportar URI de al menos 8000 octetos
    },

    // ---- Listas. Sin medición: MS §7.8 dice que no se virtualiza hasta que haya cientos de filas.
    list: {
      pageSize: entero(env, 'LIST_PAGE_SIZE', 50, { min: 1 }),
      pageMax: entero(env, 'LIST_PAGE_MAX', 200, { min: 1 })
    },

    // ---- Identidad (MS §7.7, I04 §11)
    identity: {
      provider: opcion(env, 'IDENTITY_PROVIDER', ['local', 'delegated'], 'local'),
      cookieMode: opcion(env, 'COOKIE_MODE', ['host', 'iframe', 'insecure-dev'], 'host'),
      argon2: {
        memoryKib: entero(env, 'ARGON2_MEMORY_KIB', 19456, { min: 8 }), // mínimo OWASP, I04 §1.1
        passes: entero(env, 'ARGON2_PASSES', 2, { min: 1 }),
        parallelism: entero(env, 'ARGON2_PARALLELISM', 1, { min: 1 }),
        saltBytes: entero(env, 'ARGON2_SALT_BYTES', 16, { min: 8 }), // RFC 9106: sal de 128 bits
        tagBytes: entero(env, 'ARGON2_TAG_BYTES', 32, { min: 4 }), // RFC 9106: etiqueta de 256 bits
        pepper: texto(env, 'ARGON2_PEPPER', '') // opcional; el secreto vive fuera de la base
      },
      password: {
        minLength: entero(env, 'PASSWORD_MIN_LENGTH', 15, { min: 1 }), // NIST SP 800-63B-4 3.1.1.2, un solo factor
        maxLength: entero(env, 'PASSWORD_MAX_LENGTH', 128, { min: 1 }), // NIST exige ≥ 64; 128 es el de Better Auth
        blocklistFile: texto(env, 'PASSWORD_BLOCKLIST_FILE', '') // lista local, una contraseña por línea (I04 §1.5)
      },
      session: {
        tokenBytes: entero(env, 'SESSION_TOKEN_BYTES', 32, { min: 16 }), // MS §7.7
        idleMinutes: entero(env, 'SESSION_IDLE_MINUTES', 30, { min: 1 }), // OWASP: extremo superior, riesgo bajo
        absoluteHours: entero(env, 'SESSION_ABSOLUTE_HOURS', 8, { min: 1 }), // OWASP: aplicación de oficina
        // Cortesía: evita un commit con fsync por petición. El error de la inactividad queda en un minuto
        // sobre 30 (el 3 %). No gobierna la seguridad: el vencimiento absoluto no depende de él.
        touchSeconds: entero(env, 'SESSION_TOUCH_SECONDS', 60, { min: 1 })
      },
      login: {
        ipMax: entero(env, 'LOGIN_IP_LIMIT', 3, { min: 1 }), // I04 §11: /sign-in/email de Better Auth, 3 por 10 s
        ipWindowMs: entero(env, 'LOGIN_IP_WINDOW_MS', 10000, { min: 1 }),
        backoffBaseSeconds: entero(env, 'LOGIN_BACKOFF_BASE_SECONDS', 1, { min: 1 }), // OWASP Authentication
        // Sin fuente en I04 para el techo de la espera. Se deriva de la inactividad de sesión (30 min): la
        // espera nunca supera lo que dura una sesión ociosa.
        backoffMaxSeconds: entero(env, 'LOGIN_BACKOFF_MAX_SECONDS', 30 * 60, { min: 1 }),
        hardCap: entero(env, 'LOGIN_HARD_CAP', 100, { min: 1 }) // NIST SP 800-63B-4 3.2.2
      },
      delegated: {
        mode: opcion(env, 'DELEGATED_MODE', ['signed-header', 'jwt', 'sso-redirect', 'trusted-header'], 'signed-header'),
        secrets: lista(env, 'DELEGATED_SECRETS', []), // dos a la vez durante la rotación (I04 §3.2)
        tsToleranceSeconds: entero(env, 'DELEGATED_TS_TOLERANCE_SECONDS', 300, { min: 1 }), // Stripe: 5 min, nunca 0
        bindRequest: booleano(env, 'DELEGATED_BIND_REQUEST', true), // la firma cubre método y ruta (I04 §3.2)
        jwt: {
          header: texto(env, 'JWT_HEADER', 'authorization'),
          jwksUrl: texto(env, 'JWT_JWKS_URL', ''),
          secret: texto(env, 'JWT_SECRET', ''),
          algorithms: lista(env, 'JWT_ALGORITHMS', []),
          issuer: texto(env, 'JWT_ISSUER', ''),
          audience: texto(env, 'JWT_AUDIENCE', ''),
          emailClaim: texto(env, 'JWT_EMAIL_CLAIM', 'email')
        },
        sso: {
          loginUrl: texto(env, 'SSO_LOGIN_URL', ''),
          secret: texto(env, 'SSO_SECRET', ''),
          nonceMinutes: entero(env, 'SSO_NONCE_MINUTES', 30, { min: 1 }) // DiscourseConnect
        },
        trustedHeaderName: texto(env, 'TRUSTED_HEADER_NAME', 'tailscale-user-login').toLowerCase()
      }
    },

    // ---- Módulos que escriben otros agentes (src/contracts.md)
    modules: {
      analyze: texto(env, 'ANALYZE_MODULE', './analyze/index.js'),
      extract: texto(env, 'EXTRACT_MODULE', './extract/index.js'),
      providers: texto(env, 'PROVIDERS_MODULE', './providers/index.js')
    },

    // Valores por omisión de Configuración > proveedores (MS §3). Las llaves se leen del entorno en
    // src/providers y nunca pasan por la base (MS §4.6).
    providers: {
      analyzer: opcion(env, 'ANALYZER', ['api', 'harness'], 'api'),
      text: { provider: texto(env, 'PROVIDER_TEXT', 'anthropic'), model: texto(env, 'MODEL_TEXT', 'claude-haiku-5-5') },
      vision: { provider: texto(env, 'PROVIDER_VISION', 'anthropic'), model: texto(env, 'MODEL_VISION', 'claude-haiku-5-5') },
      speech: { provider: texto(env, 'PROVIDER_SPEECH', 'groq-speech'), model: texto(env, 'MODEL_SPEECH', 'whisper-large-v3-turbo') }
    }
  }

  const final = mezclar(config, overrides)
  validar(final)
  return Object.freeze(final)
}

/** Combina `overrides` sobre `base` en profundidad, sin tocar arreglos. */
function mezclar (base, extra) {
  const salida = { ...base }
  for (const [clave, valor] of Object.entries(extra)) {
    const actual = salida[clave]
    salida[clave] = valor && typeof valor === 'object' && !Array.isArray(valor) && actual && typeof actual === 'object' && !Array.isArray(actual)
      ? mezclar(actual, valor)
      : valor
  }
  return salida
}

function validar (config) {
  const d = config.identity.delegated
  if (config.identity.provider === 'delegated') {
    if (['signed-header'].includes(d.mode) && d.secrets.length === 0) {
      throw new Error('IDENTITY_PROVIDER=delegated con DELEGATED_MODE=signed-header exige DELEGATED_SECRETS.')
    }
    if (d.mode === 'jwt') {
      if (!d.jwt.jwksUrl && !d.jwt.secret) throw new Error('El modo jwt exige JWT_JWKS_URL o JWT_SECRET.')
      // I04 §3.3: sin issuer y audience el SDK confía en el primer uso; no se arranca así.
      if (!d.jwt.issuer || !d.jwt.audience) throw new Error('El modo jwt exige JWT_ISSUER y JWT_AUDIENCE.')
    }
    if (d.mode === 'sso-redirect') {
      if (!d.sso.loginUrl || !d.sso.secret) throw new Error('El modo sso-redirect exige SSO_LOGIN_URL y SSO_SECRET.')
      if (!config.publicUrl) throw new Error('El modo sso-redirect exige PUBLIC_URL para armar la dirección de retorno.')
    }
  }
  if (config.worker.heartbeatMs >= config.worker.leaseMs) {
    throw new Error('QUEUE_HEARTBEAT_MS debe ser menor que QUEUE_LEASE_MS.')
  }
  if (config.identity.password.minLength > config.identity.password.maxLength) {
    throw new Error('PASSWORD_MIN_LENGTH no puede superar PASSWORD_MAX_LENGTH.')
  }
  if (!config.apiPrefix.startsWith('/') || config.apiPrefix.endsWith('/')) {
    throw new Error('API_PREFIX debe empezar con / y no terminar con /.')
  }
}

/** Carga `.env` si existe, sin pisar variables ya definidas. Las llaves nunca viven en el repositorio. */
export function loadEnvFile (file = path.join(raiz, '.env')) {
  if (existsSync(file)) process.loadEnvFile(file)
}
