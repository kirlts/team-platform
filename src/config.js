// Configuración del servidor. Toda perilla sale de una variable de entorno, con su valor por
// omisión y la fuente que lo justifica (MASTER-SPEC §4.9: un número que gobierna la operación
// nace declarado). «MS» = docs/MASTER-SPEC.md; «I03», «I04», «I07» = docs/investigaciones/.
// Ninguna credencial tiene valor por omisión: las llaves se leen del entorno y nunca se guardan.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Lee un entero; una variable vacía o ausente cuenta como no definida. */
function intVar (env, nameValue, fallback, { min = 0 } = {}) {
  const rawValue = env[nameValue]
  if (rawValue === undefined || rawValue === '') return fallback
  const n = Number(rawValue)
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`La variable ${nameValue} debe ser un entero mayor o igual a ${min} (valor: «${rawValue}»).`)
  }
  return n
}

function decimal (env, nameValue, fallback, { min = 0, max = Infinity } = {}) {
  const rawValue = env[nameValue]
  if (rawValue === undefined || rawValue === '') return fallback
  const n = Number(rawValue)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`La variable ${nameValue} debe ser un número entre ${min} y ${max} (valor: «${rawValue}»).`)
  }
  return n
}

function textValue (env, nameValue, fallback = '') {
  const rawValue = env[nameValue]
  return rawValue === undefined || rawValue === '' ? fallback : rawValue
}

function boolVar (env, nameValue, fallback) {
  const rawValue = env[nameValue]
  if (rawValue === undefined || rawValue === '') return fallback
  if (['1', 'true', 'si', 'sí'].includes(rawValue.toLowerCase())) return true
  if (['0', 'false', 'no'].includes(rawValue.toLowerCase())) return false
  throw new Error(`La variable ${nameValue} debe ser true o false (valor: «${rawValue}»).`)
}

function listValue (env, nameValue, fallback = []) {
  const rawValue = env[nameValue]
  if (rawValue === undefined || rawValue === '') return fallback
  return rawValue.split(',').map((s) => s.trim()).filter(Boolean)
}

function choiceVar (env, nameValue, allowedList, fallback) {
  const val = textValue(env, nameValue, fallback)
  if (!allowedList.includes(val)) {
    throw new Error(`La variable ${nameValue} debe ser una de: ${allowedList.join(', ')} (valor: «${val}»).`)
  }
  return val
}

const MIB = 1024 * 1024
const GIB = 1024 * MIB

/**
 * Carga la configuración desde un entorno. `overrides` reemplaza valores ya resueltos
 * (lo usan las pruebas); no pasa por la validación del entorno.
 */
export function loadConfig (env = process.env, overrides = {}) {
  // El Dockerfile fija DATA_DIR=/data. Fuera del contenedor se declara DATA_DIR (el volumen vive ahí).
  const dataDir = path.resolve(textValue(env, 'DATA_DIR', '/data'))

  const config = {
    rootDir,
    version: JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version,

    // ---- Red y servidor
    host: textValue(env, 'HOST', '0.0.0.0'), // dentro de un contenedor; el compose publica el puerto en loopback
    port: intVar(env, 'PORT', 3000), // I04 §5: the service listens on 127.0.0.1:3000 and the compose file publishes that port on loopback
    nodeEnv: textValue(env, 'NODE_ENV', 'production'), // `development` habilita POST /auth/dev-login
    // Primer Editor (instalación): si no hay miembros, se crea con este correo. La contraseña viene de ADMIN_PASSWORD
    // o, si falta, se genera una y se muestra una sola vez en el registro de arranque. Nada se siembra con contraseña fija.
    adminEmail: textValue(env, 'ADMIN_EMAIL', ''),
    adminPassword: textValue(env, 'ADMIN_PASSWORD', ''),
    projectName: textValue(env, 'PROJECT_NAME', 'Team'), // lo muestra el panel en la cabecera
    apiPrefix: textValue(env, 'API_PREFIX', '/api'), // MS §7.8: el panel llama a /api; 404 JSON bajo /api
    publicUrl: textValue(env, 'PUBLIC_URL', ''), // sólo lo exige el modo sso-redirect
    logLevel: textValue(env, 'LOG_LEVEL', 'info'),
    // I04 §11 TRUSTED_PROXIES: omisión de Gitea; Fastify exige lista exacta de IP o CIDR, nunca `true`.
    trustedProxies: listValue(env, 'TRUSTED_PROXIES', ['127.0.0.0/8', '::1/128']),
    // Orígenes de otro frontend que pueden llamar a la API (MS §4.11). Vacía = mismo origen, sin CORS.
    corsOrigins: listValue(env, 'CORS_ORIGINS', []),
    frameAncestors: textValue(env, 'FRAME_ANCESTORS', "'none'"), // se amplía sólo si la aplicación vive en un iframe
    panelDist: path.resolve(textValue(env, 'PANEL_DIR', path.join(rootDir, 'panel', 'dist'))),
    // I03 §7.3: activos con hash, caché larga e inmutable (README de @fastify/static, 30 días en el ejemplo
    // del informe; un año es lo que usa el proyecto con el que se contrastó en I07 §8).
    assetsMaxAgeSeconds: intVar(env, 'ASSETS_MAX_AGE_SECONDS', 31536000),

    // ---- Datos
    dataDir,
    dbFile: path.resolve(textValue(env, 'DB_PATH', path.join(dataDir, 'team.db'))),
    attachmentsDir: path.join(dataDir, 'attachments'),
    tmpDir: path.join(dataDir, 'tmp'),
    backupsDir: path.join(dataDir, 'backups'),
    templatesDir: path.resolve(textValue(env, 'TEMPLATES_DIR', path.join(rootDir, 'templates'))), // el juego inicial que se instala
    editedTemplatesDir: path.join(dataDir, 'templates'), // copia en archivos de las plantillas editadas, en el volumen (la base manda)
    sqlite: {
      busyTimeoutMs: intVar(env, 'SQLITE_BUSY_TIMEOUT_MS', 5000), // MS §3, I03 §12: 0 errores contra 19.040 con 0
      synchronous: choiceVar(env, 'SQLITE_SYNCHRONOUS', ['FULL', 'NORMAL'], 'FULL') // MS §3, I03 §2.3: FULL es durable
    },

    // ---- Cola (MS §7.3, I03 §12)
    worker: {
      mode: choiceVar(env, 'WORKER_MODE', ['inline', 'external', 'off'], 'inline'), // MS §7.3: mismo proceso por omisión
      leaseMs: intVar(env, 'QUEUE_LEASE_MS', 30000, { min: 1 }), // I03 §12: 30 s, as walq
      heartbeatMs: intVar(env, 'QUEUE_HEARTBEAT_MS', 10000, { min: 1 }), // I03 §12: pg-boss minimum heartbeat, 10 s
      maxAttempts: intVar(env, 'QUEUE_MAX_ATTEMPTS', 3, { min: 1 }), // I03 §12 and MS §7.3: pg-boss retryLimit plus the first attempt
      retryBaseMs: intVar(env, 'QUEUE_RETRY_BASE_MS', 1000, { min: 1 }),
      retryMaxMs: intVar(env, 'QUEUE_RETRY_MAX_MS', 60000, { min: 1 }), // I03 §12: derivado del límite por minuto de Groq
      // Jitter completo (fracción del retraso que se resta al azar). I03 §3.4 cita a walq para el mecanismo y
      // la guía de AWS [F41] para el principio, sin fijar la fracción: 1 es el «full jitter» de esa guía.
      retryJitter: decimal(env, 'QUEUE_RETRY_JITTER', 1, { min: 0, max: 1 }),
      concurrency: intVar(env, 'QUEUE_CONCURRENCY', 1, { min: 1 }), // única perilla de convención (I03 §12)
      maxRuntimeMs: intVar(env, 'QUEUE_MAX_RUNTIME_MS', 900000, { min: 1 }), // expireInSeconds de pg-boss: 900 s
      retentionDays: intVar(env, 'RETENTION_DAYS', 7, { min: 1 }), // I03 §12: pg-boss deleteAfterSeconds, 7 days
      // Cortesía: la retención se mide en días, un barrido por hora la cumple con holgura. No gobierna la
      // operación de ningún trabajo.
      retentionSweepMs: intVar(env, 'RETENTION_SWEEP_MS', 3600000, { min: 1 }), // cortesía declarada, see above
      dataVersionPollMs: intVar(env, 'DATA_VERSION_POLL_MS', 100, { min: 1 }) // I03 §12: sólo con worker aparte
    },

    // ---- Eventos (MS §7.10)
    sse: {
      heartbeatMs: intVar(env, 'SSE_HEARTBEAT_MS', 15000, { min: 1 }) // I03 §5.1: sugerencia del estándar HTML
    },

    // ---- Subidas. Los topes por tipo son los valores iniciales de MS §7.8 / I07 §6.3; el de video y los
    // ---- «archivos por input» no tienen medición propia (ver cada línea).
    uploads: {
      maxImageBytes: intVar(env, 'UPLOAD_MAX_IMAGE_BYTES', 7 * MIB, { min: 1 }), // MS §7.8: imagen 7 MB
      maxAudioBytes: intVar(env, 'UPLOAD_MAX_AUDIO_BYTES', 25 * MIB, { min: 1 }), // MS §7.8: audio 25 MB
      maxDocumentBytes: intVar(env, 'UPLOAD_MAX_DOCUMENT_BYTES', 24 * MIB, { min: 1 }), // MS §7.4, informe 05 §8.3: 24 MB, the extractor's own cap (DT-005)
      maxVideoBytes: intVar(env, 'UPLOAD_MAX_VIDEO_BYTES', 2 * GIB, { min: 1 }), // MS §7.4: video, tope 2 GB
      // I07 §6.1: Slack acepta hasta 10 archivos arrastrados a la vez. Es el referente, no una medición.
      maxFiles: intVar(env, 'UPLOAD_MAX_FILES', 10, { min: 1 }),
      maxLinks: intVar(env, 'UPLOAD_MAX_LINKS', 10, { min: 0 }), // I07 §6.1: same reference as files
      // I03 §7.2: la omisión de @fastify/multipart es el bodyLimit de Fastify, 1 MiB; cabe un texto largo.
      maxTextBytes: intVar(env, 'UPLOAD_MAX_TEXT_BYTES', MIB, { min: 1 }),
      maxLinkLength: intVar(env, 'UPLOAD_MAX_LINK_LENGTH', 8000, { min: 1 }) // RFC 9110 §4.1: se recomienda soportar URI de al menos 8000 octetos
    },

    // ---- Listas. Sin medición: MS §7.8 dice que no se virtualiza hasta que haya cientos de filas.
    // Paginación uniforme ?page=&limit= (convención de la API). El tope de 100 lo fija Martín (2026-10-20).
    list: {
      pageSize: intVar(env, 'LIST_PAGE_SIZE', 50, { min: 1 }), // MS §7.8: not measured, no virtualization until there are hundreds of rows
      pageMax: 100 // decisión de Martín 2026-10-20: page cap of the API
    },

    // ---- Identidad (MS §7.7, I04 §11)
    identity: {
      provider: choiceVar(env, 'IDENTITY_PROVIDER', ['local', 'delegated'], 'local'),
      // same-origin: `__Host-` + SameSite=Lax. cross-origin: SameSite=None; Secure (un frontend en otro origen).
      cookieMode: choiceVar(env, 'COOKIE_MODE', ['same-origin', 'cross-origin'], 'same-origin'),
      // Sólo desarrollo por http: quita Secure y el prefijo `__Host-` (que lo exige). Nunca con cross-origin.
      cookieInsecureDev: boolVar(env, 'COOKIE_INSECURE_DEV', false),
      argon2: {
        memoryKib: intVar(env, 'ARGON2_MEMORY_KIB', 19456, { min: 8 }), // mínimo OWASP, I04 §1.1
        passes: intVar(env, 'ARGON2_PASSES', 2, { min: 1 }), // I04 §11: same OWASP row as memory
        parallelism: intVar(env, 'ARGON2_PARALLELISM', 1, { min: 1 }),
        saltBytes: intVar(env, 'ARGON2_SALT_BYTES', 16, { min: 8 }), // I04 §11, RFC 9106: 128-bit salt
        tagBytes: intVar(env, 'ARGON2_TAG_BYTES', 32, { min: 4 }), // I04 §11, RFC 9106: 256-bit tag
        pepper: textValue(env, 'ARGON2_PEPPER', '') // opcional; el secreto vive fuera de la base
      },
      password: {
        minLength: intVar(env, 'PASSWORD_MIN_LENGTH', 15, { min: 1 }), // I04 §11: NIST SP 800-63B-4 3.1.1.2, single factor
        maxLength: intVar(env, 'PASSWORD_MAX_LENGTH', 128, { min: 1 }), // I04 §11: NIST requires at least 64; 128 is Better Auth's
        // One password per line (I04 §1.5). Without the variable, the file that scripts/install.sh downloads into the data
        // directory (H-43) is used when it exists; with neither, there is no list.
        blocklistFile: textValue(env, 'PASSWORD_BLOCKLIST_FILE', existsSync(path.join(dataDir, 'password-blocklist.txt')) ? path.join(dataDir, 'password-blocklist.txt') : '')
      },
      session: {
        tokenBytes: intVar(env, 'SESSION_TOKEN_BYTES', 32, { min: 16 }), // MS §7.7
        idleMinutes: intVar(env, 'SESSION_IDLE_MINUTES', 30, { min: 1 }), // I04 §11: OWASP, upper end, low risk
        absoluteHours: intVar(env, 'SESSION_ABSOLUTE_HOURS', 8, { min: 1 }), // I04 §11: OWASP, office application
        // Cortesía: evita un commit con fsync por petición. El error de la inactividad queda en un minuto
        // sobre 30 (el 3 %). No gobierna la seguridad: el vencimiento absoluto no depende de él.
        touchSeconds: intVar(env, 'SESSION_TOUCH_SECONDS', 60, { min: 1 })
      },
      login: {
        ipMax: intVar(env, 'LOGIN_IP_LIMIT', 3, { min: 1 }), // I04 §11: /sign-in/email de Better Auth, 3 por 10 s
        ipWindowMs: intVar(env, 'LOGIN_IP_WINDOW_MS', 10000, { min: 1 }), // I04 §11: the 10 s of the Better Auth rule
        backoffBaseSeconds: intVar(env, 'LOGIN_BACKOFF_BASE_SECONDS', 1, { min: 1 }), // OWASP Authentication
        // Sin fuente en I04 para el techo de la espera. Se deriva de la inactividad de sesión (30 min): la
        // espera nunca supera lo que dura una sesión ociosa (I04 §11).
        backoffMaxSeconds: intVar(env, 'LOGIN_BACKOFF_MAX_SECONDS', 30 * 60, { min: 1 }),
        hardCap: intVar(env, 'LOGIN_HARD_CAP', 100, { min: 1 }) // I04 §11: NIST SP 800-63B-4 3.2.2
      },
      delegated: {
        mode: choiceVar(env, 'DELEGATED_MODE', ['signed-header', 'jwt', 'sso-redirect', 'trusted-header'], 'signed-header'),
        secrets: listValue(env, 'DELEGATED_SECRETS', []), // dos a la vez durante la rotación (I04 §3.2)
        tsToleranceSeconds: intVar(env, 'DELEGATED_TS_TOLERANCE_SECONDS', 300, { min: 1 }), // Stripe: 5 min, nunca 0
        bindRequest: boolVar(env, 'DELEGATED_BIND_REQUEST', true), // la firma cubre método y ruta (I04 §3.2)
        jwt: {
          header: textValue(env, 'JWT_HEADER', 'authorization'),
          jwksUrl: textValue(env, 'JWT_JWKS_URL', ''),
          // I04 §3.3: minimum between two JWKS downloads on an unknown `kid`. The `jose` default is 30 s (`cooldownDuration`).
          jwksCooldownMs: intVar(env, 'JWT_JWKS_COOLDOWN_MS', 30000),
          secret: textValue(env, 'JWT_SECRET', ''),
          algorithms: listValue(env, 'JWT_ALGORITHMS', []),
          issuer: textValue(env, 'JWT_ISSUER', ''),
          audience: textValue(env, 'JWT_AUDIENCE', ''),
          emailClaim: textValue(env, 'JWT_EMAIL_CLAIM', 'email')
        },
        sso: {
          loginUrl: textValue(env, 'SSO_LOGIN_URL', ''),
          secret: textValue(env, 'SSO_SECRET', ''),
          nonceMinutes: intVar(env, 'SSO_NONCE_MINUTES', 30, { min: 1 }) // I04 §11: DiscourseConnect nonce expiry
        },
        trustedHeaderName: textValue(env, 'TRUSTED_HEADER_NAME', 'tailscale-user-login').toLowerCase()
      }
    },

    // ---- Módulos que escriben otros agentes (src/contracts.md)
    modules: {
      analyze: textValue(env, 'ANALYZE_MODULE', './analyze/index.js'),
      extract: textValue(env, 'EXTRACT_MODULE', './extract/index.js'),
      providers: textValue(env, 'PROVIDERS_MODULE', './providers/index.js')
    },

    // Lo que Configuración muestra por omisión: los nombres que `src/providers` lee del entorno (TEXT_*, VISION_*,
    // SPEECH_*, ANALYZER). Vacío en modelo = el valor por omisión del proveedor (MS §3). Las llaves no están acá:
    // las lee `createProviders(env)` y nunca pasan por la base (MS §4.6).
    providers: {
      analyzer: choiceVar(env, 'ANALYZER', ['api', 'harness'], 'api'),
      text: { provider: textValue(env, 'TEXT_PROVIDER', 'anthropic'), model: textValue(env, 'TEXT_MODEL', '') },
      vision: { provider: textValue(env, 'VISION_PROVIDER', ''), model: textValue(env, 'VISION_MODEL', '') }, // vacío = hereda de texto
      speech: { provider: textValue(env, 'SPEECH_PROVIDER', 'groq-speech'), model: textValue(env, 'SPEECH_MODEL', '') }
    }
  }

  const final = mergeDeep(config, overrides)
  validateConfig(final)
  return Object.freeze(final)
}

/** Combina `overrides` sobre `base` en profundidad, sin tocar arreglos. */
function mergeDeep (base, extra) {
  const outText = { ...base }
  for (const [lookupKey, val] of Object.entries(extra)) {
    const current = outText[lookupKey]
    outText[lookupKey] = val && typeof val === 'object' && !Array.isArray(val) && current && typeof current === 'object' && !Array.isArray(current)
      ? mergeDeep(current, val)
      : val
  }
  return outText
}

function validateConfig (config) {
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
  if (config.identity.cookieMode === 'cross-origin' && config.corsOrigins.length === 0) {
    throw new Error('COOKIE_MODE=cross-origin exige CORS_ORIGINS con los orígenes del otro frontend.')
  }
  if (config.identity.cookieMode === 'cross-origin' && config.identity.cookieInsecureDev) {
    throw new Error('COOKIE_INSECURE_DEV no se combina con COOKIE_MODE=cross-origin: SameSite=None exige Secure.')
  }
  for (const originValue of config.corsOrigins) {
    let u
    try { u = new URL(originValue) } catch { throw new Error(`CORS_ORIGINS: «${originValue}» no es un origen válido.`) }
    if (u.origin !== originValue) throw new Error(`CORS_ORIGINS: «${originValue}» debe ser un origen sin ruta ni barra final (${u.origin}).`)
  }
  if (!config.apiPrefix.startsWith('/') || config.apiPrefix.endsWith('/')) {
    throw new Error('API_PREFIX debe empezar con / y no terminar con /.')
  }
}

/** Carga `.env` si existe, sin pisar variables ya definidas. Las llaves nunca viven en el repositorio. */
export function loadEnvFile (file = path.join(rootDir, '.env')) {
  if (existsSync(file)) process.loadEnvFile(file)
}
