// Server configuration. Every knob comes from an environment variable, with its default value
// and the source that justifies it (MASTER-SPEC §4.9: a number that governs operation
// is born declared). «MS» = docs/MASTER-SPEC.md; «I03», «I04», «I07» = docs/investigaciones/.
// No credential has a default value: keys are read from the environment and never stored.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Reads an integer; an empty or absent variable counts as undefined. */
function intVar (env, nameValue, fallback, { min = 0 } = {}) {
  const rawValue = env[nameValue]
  if (rawValue === undefined || rawValue === '') return fallback
  const n = Number(rawValue)
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`Variable ${nameValue} must be an integer greater than or equal to ${min} (value: «${rawValue}»).`)
  }
  return n
}

function decimal (env, nameValue, fallback, { min = 0, max = Infinity } = {}) {
  const rawValue = env[nameValue]
  if (rawValue === undefined || rawValue === '') return fallback
  const n = Number(rawValue)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`Variable ${nameValue} must be a number between ${min} and ${max} (value: «${rawValue}»).`)
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
  throw new Error(`Variable ${nameValue} must be true or false (value: «${rawValue}»).`)
}

function listValue (env, nameValue, fallback = []) {
  const rawValue = env[nameValue]
  if (rawValue === undefined || rawValue === '') return fallback
  return rawValue.split(',').map((s) => s.trim()).filter(Boolean)
}

function choiceVar (env, nameValue, allowedList, fallback) {
  const val = textValue(env, nameValue, fallback)
  if (!allowedList.includes(val)) {
    throw new Error(`Variable ${nameValue} must be one of: ${allowedList.join(', ')} (value: «${val}»).`)
  }
  return val
}

const MIB = 1024 * 1024
const GIB = 1024 * MIB

/**
 * Loads the configuration from an environment. `overrides` replaces already-resolved values
 * (used by the tests); it does not go through the environment validation.
 */
export function loadConfig (env = process.env, overrides = {}) {
  // The Dockerfile sets DATA_DIR=/data. Outside the container DATA_DIR is declared (the volume lives there).
  const dataDir = path.resolve(textValue(env, 'DATA_DIR', '/data'))

  const config = {
    rootDir,
    version: JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')).version,

    // ---- Red y servidor
    host: textValue(env, 'HOST', '0.0.0.0'), // inside a container; the compose file publishes the port on loopback
    port: intVar(env, 'PORT', 3000), // I04 §5: the service listens on 127.0.0.1:3000 and the compose file publishes that port on loopback
    nodeEnv: textValue(env, 'NODE_ENV', 'production'), // `development` enables POST /auth/dev-login
    // First Editor (installation): if there are no members, one is created with this email. The password comes from
    // ADMIN_PASSWORD or, if missing, one is generated and shown once in the startup log. Nothing is seeded with a fixed password.
    adminEmail: textValue(env, 'ADMIN_EMAIL', ''),
    adminPassword: textValue(env, 'ADMIN_PASSWORD', ''),
    projectName: textValue(env, 'PROJECT_NAME', 'Team'), // the panel shows it in the header
    apiPrefix: textValue(env, 'API_PREFIX', '/api'), // MS §7.8: the panel calls /api; JSON 404 under /api
    publicUrl: textValue(env, 'PUBLIC_URL', ''), // only the sso-redirect mode requires it
    logLevel: textValue(env, 'LOG_LEVEL', 'info'),
    // I04 §11 TRUSTED_PROXIES: Gitea's default; Fastify requires an exact list of IPs or CIDRs, never `true`.
    trustedProxies: listValue(env, 'TRUSTED_PROXIES', ['127.0.0.0/8', '::1/128']),
    // Origins of another frontend that may call the API (MS §4.11). Empty = same origin, no CORS.
    corsOrigins: listValue(env, 'CORS_ORIGINS', []),
    frameAncestors: textValue(env, 'FRAME_ANCESTORS', "'none'"), // widened only if the application lives in an iframe
    panelDist: path.resolve(textValue(env, 'PANEL_DIR', path.join(rootDir, 'panel', 'dist'))),
    // I03 §7.3: hashed assets, long immutable cache (@fastify/static README, 30 days in the report's
    // example; one year is what the project it was compared against in I07 §8 uses).
    assetsMaxAgeSeconds: intVar(env, 'ASSETS_MAX_AGE_SECONDS', 31536000),

    // ---- Data
    dataDir,
    dbFile: path.resolve(textValue(env, 'DB_PATH', path.join(dataDir, 'team.db'))),
    attachmentsDir: path.join(dataDir, 'attachments'),
    tmpDir: path.join(dataDir, 'tmp'),
    backupsDir: path.join(dataDir, 'backups'),
    templatesDir: path.resolve(textValue(env, 'TEMPLATES_DIR', path.join(rootDir, 'templates'))), // the initial set that gets installed
    editedTemplatesDir: path.join(dataDir, 'templates'), // a copy as files of the edited templates, on the volume (the database is authoritative)
    sqlite: {
      busyTimeoutMs: intVar(env, 'SQLITE_BUSY_TIMEOUT_MS', 5000), // MS §3, I03 §12: 0 errors against 19,040 with 0
      synchronous: choiceVar(env, 'SQLITE_SYNCHRONOUS', ['FULL', 'NORMAL'], 'FULL') // MS §3, I03 §2.3: FULL is durable
    },

    // ---- Queue (MS §7.3, I03 §12)
    worker: {
      mode: choiceVar(env, 'WORKER_MODE', ['inline', 'external', 'off'], 'inline'), // MS §7.3: same process by default
      leaseMs: intVar(env, 'QUEUE_LEASE_MS', 30000, { min: 1 }), // I03 §12: 30 s, as walq
      heartbeatMs: intVar(env, 'QUEUE_HEARTBEAT_MS', 10000, { min: 1 }), // I03 §12: pg-boss minimum heartbeat, 10 s
      maxAttempts: intVar(env, 'QUEUE_MAX_ATTEMPTS', 3, { min: 1 }), // I03 §12 and MS §7.3: pg-boss retryLimit plus the first attempt
      retryBaseMs: intVar(env, 'QUEUE_RETRY_BASE_MS', 1000, { min: 1 }),
      retryMaxMs: intVar(env, 'QUEUE_RETRY_MAX_MS', 60000, { min: 1 }), // I03 §12: derived from Groq's per-minute limit
      // Full jitter (the fraction of the delay that is subtracted at random). I03 §3.4 cites walq for the mechanism and
      // the AWS guide [F41] for the principle, without fixing the fraction: 1 is that guide's «full jitter».
      retryJitter: decimal(env, 'QUEUE_RETRY_JITTER', 1, { min: 0, max: 1 }),
      concurrency: intVar(env, 'QUEUE_CONCURRENCY', 1, { min: 1 }), // the only knob that is a convention (I03 §12)
      maxRuntimeMs: intVar(env, 'QUEUE_MAX_RUNTIME_MS', 900000, { min: 1 }), // pg-boss expireInSeconds: 900 s
      retentionDays: intVar(env, 'RETENTION_DAYS', 7, { min: 1 }), // I03 §12: pg-boss deleteAfterSeconds, 7 days
      // Courtesy: retention is measured in days, one sweep per hour meets it with room to spare. It does not govern the
      // operation of any job.
      retentionSweepMs: intVar(env, 'RETENTION_SWEEP_MS', 3600000, { min: 1 }), // declared courtesy, see above
      dataVersionPollMs: intVar(env, 'DATA_VERSION_POLL_MS', 100, { min: 1 }) // I03 §12: only with a separate worker
    },

    // ---- Events (MS §7.10)
    sse: {
      heartbeatMs: intVar(env, 'SSE_HEARTBEAT_MS', 15000, { min: 1 }) // I03 §5.1: the HTML standard's suggestion
    },

    // ---- Uploads. The per-type caps are the initial values from MS §7.8 / I07 §6.3; the video one and the
    // ---- «files per input» have no measurement of their own (see each line).
    uploads: {
      maxImageBytes: intVar(env, 'UPLOAD_MAX_IMAGE_BYTES', 7 * MIB, { min: 1 }), // MS §7.8: image 7 MB
      maxAudioBytes: intVar(env, 'UPLOAD_MAX_AUDIO_BYTES', 25 * MIB, { min: 1 }), // MS §7.8: audio 25 MB
      maxDocumentBytes: intVar(env, 'UPLOAD_MAX_DOCUMENT_BYTES', 24 * MIB, { min: 1 }), // MS §7.4, informe 05 §8.3: 24 MB, the extractor's own cap (DT-005)
      maxVideoBytes: intVar(env, 'UPLOAD_MAX_VIDEO_BYTES', 2 * GIB, { min: 1 }), // MS §7.4: video, tope 2 GB
      // I07 §6.1: Slack accepts up to 10 files dragged at once. It is the referent, not a measurement.
      maxFiles: intVar(env, 'UPLOAD_MAX_FILES', 10, { min: 1 }),
      maxLinks: intVar(env, 'UPLOAD_MAX_LINKS', 10, { min: 0 }), // I07 §6.1: same reference as files
      // I03 §7.2: the @fastify/multipart default is Fastify's bodyLimit, 1 MiB; a long text fits.
      maxTextBytes: intVar(env, 'UPLOAD_MAX_TEXT_BYTES', MIB, { min: 1 }),
      maxLinkLength: intVar(env, 'UPLOAD_MAX_LINK_LENGTH', 8000, { min: 1 }) // RFC 9110 §4.1: supporting URIs of at least 8000 octets is recommended
    },

    // ---- Lists. No measurement: MS §7.8 says nothing is virtualized until there are hundreds of rows.
    // Uniform pagination ?page=&limit= (the API's convention). The cap of 100 is set by «Martín» (2026-10-20).
    list: {
      pageSize: intVar(env, 'LIST_PAGE_SIZE', 50, { min: 1 }), // MS §7.8: not measured, no virtualization until there are hundreds of rows
      pageMax: 100 // Martín's decision 2026-10-20: page cap of the API
    },

    // ---- Proyecto (UD-024)
    project: {
      // The 100,000 input-token price step of the default model is ≈ 300,000 characters at 3 chars/token in Spanish.
      // 200,000 characters leave room for the input, the catalog and the team in the same call.
      descriptionMaxChars: intVar(env, 'PROJECT_DESCRIPTION_MAX_CHARS', 200000, { min: 1 }) // informe 02 §10.2: the 100,000-token price step, UD-024
    },

    // ---- Miembros
    members: {
      // Not a model limit: the whole profile travels to the analyzer (UD-023).
      profileMaxLength: 4000 // declared courtesy: two paragraphs ≈ 2,000 characters; 4,000 leaves room (UD-023)
    },

    // ---- Identidad (MS §7.7, I04 §11)
    identity: {
      provider: choiceVar(env, 'IDENTITY_PROVIDER', ['local', 'delegated'], 'local'),
      // same-origin: `__Host-` + SameSite=Lax. cross-origin: SameSite=None; Secure (a frontend on another origin).
      cookieMode: choiceVar(env, 'COOKIE_MODE', ['same-origin', 'cross-origin'], 'same-origin'),
      // Development over http only: removes Secure and the `__Host-` prefix (which requires it). Never with cross-origin.
      cookieInsecureDev: boolVar(env, 'COOKIE_INSECURE_DEV', false),
      argon2: {
        memoryKib: intVar(env, 'ARGON2_MEMORY_KIB', 19456, { min: 8 }), // OWASP minimum, I04 §1.1
        passes: intVar(env, 'ARGON2_PASSES', 2, { min: 1 }), // I04 §11: same OWASP row as memory
        parallelism: intVar(env, 'ARGON2_PARALLELISM', 1, { min: 1 }),
        saltBytes: intVar(env, 'ARGON2_SALT_BYTES', 16, { min: 8 }), // I04 §11, RFC 9106: 128-bit salt
        tagBytes: intVar(env, 'ARGON2_TAG_BYTES', 32, { min: 4 }), // I04 §11, RFC 9106: 256-bit tag
        pepper: textValue(env, 'ARGON2_PEPPER', '') // optional; the secret lives outside the database
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
        // Courtesy: avoids a commit with fsync per request. The inactivity error stays at one minute
        // out of 30 (3 %). It does not govern security: the absolute expiry does not depend on it.
        touchSeconds: intVar(env, 'SESSION_TOUCH_SECONDS', 60, { min: 1 })
      },
      login: {
        ipMax: intVar(env, 'LOGIN_IP_LIMIT', 3, { min: 1 }), // I04 §11: Better Auth's /sign-in/email, 3 per 10 s
        ipWindowMs: intVar(env, 'LOGIN_IP_WINDOW_MS', 10000, { min: 1 }), // I04 §11: the 10 s of the Better Auth rule
        backoffBaseSeconds: intVar(env, 'LOGIN_BACKOFF_BASE_SECONDS', 1, { min: 1 }), // OWASP Authentication
        // I04 has no source for the ceiling of the wait. It is derived from session inactivity (30 min): the
        // wait never exceeds what an idle session lasts (I04 §11).
        backoffMaxSeconds: intVar(env, 'LOGIN_BACKOFF_MAX_SECONDS', 30 * 60, { min: 1 }),
        hardCap: intVar(env, 'LOGIN_HARD_CAP', 100, { min: 1 }) // I04 §11: NIST SP 800-63B-4 3.2.2
      },
      delegated: {
        mode: choiceVar(env, 'DELEGATED_MODE', ['signed-header', 'jwt', 'sso-redirect', 'trusted-header'], 'signed-header'),
        secrets: listValue(env, 'DELEGATED_SECRETS', []), // two at a time during rotation (I04 §3.2)
        tsToleranceSeconds: intVar(env, 'DELEGATED_TS_TOLERANCE_SECONDS', 300, { min: 1 }), // Stripe: 5 min, never 0
        bindRequest: boolVar(env, 'DELEGATED_BIND_REQUEST', true), // the signature covers method and path (I04 §3.2)
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

    // ---- Modules written by other agents (src/contracts.md)
    modules: {
      analyze: textValue(env, 'ANALYZE_MODULE', './analyze/index.js'),
      extract: textValue(env, 'EXTRACT_MODULE', './extract/index.js'),
      providers: textValue(env, 'PROVIDERS_MODULE', './providers/index.js')
    },

    // What «Configuración» shows by default: the names `src/providers` reads from the environment (TEXT_*, VISION_*,
    // SPEECH_*, ANALYZER). Empty model = the provider's default value (MS §3). The keys are not here:
    // `createProviders(env)` reads them and they never go through the database (MS §4.6).
    providers: {
      analyzer: choiceVar(env, 'ANALYZER', ['api', 'harness'], 'api'),
      text: { provider: textValue(env, 'TEXT_PROVIDER', 'anthropic'), model: textValue(env, 'TEXT_MODEL', '') },
      vision: { provider: textValue(env, 'VISION_PROVIDER', ''), model: textValue(env, 'VISION_MODEL', '') }, // empty = inherits from text
      speech: { provider: textValue(env, 'SPEECH_PROVIDER', 'groq-speech'), model: textValue(env, 'SPEECH_MODEL', '') }
    }
  }

  const final = mergeDeep(config, overrides)
  validateConfig(final)
  return Object.freeze(final)
}

/** Merges `overrides` onto `base` deeply, leaving arrays untouched. */
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
      throw new Error('IDENTITY_PROVIDER=delegated with DELEGATED_MODE=signed-header requires DELEGATED_SECRETS.')
    }
    if (d.mode === 'jwt') {
      if (!d.jwt.jwksUrl && !d.jwt.secret) throw new Error('The jwt mode requires JWT_JWKS_URL or JWT_SECRET.')
      // I04 §3.3: without issuer and audience the SDK trusts on first use; it does not start like that.
      if (!d.jwt.issuer || !d.jwt.audience) throw new Error('The jwt mode requires JWT_ISSUER and JWT_AUDIENCE.')
    }
    if (d.mode === 'sso-redirect') {
      if (!d.sso.loginUrl || !d.sso.secret) throw new Error('The sso-redirect mode requires SSO_LOGIN_URL and SSO_SECRET.')
      if (!config.publicUrl) throw new Error('The sso-redirect mode requires PUBLIC_URL to build the return address.')
    }
  }
  if (config.worker.heartbeatMs >= config.worker.leaseMs) {
    throw new Error('QUEUE_HEARTBEAT_MS must be less than QUEUE_LEASE_MS.')
  }
  if (config.identity.password.minLength > config.identity.password.maxLength) {
    throw new Error('PASSWORD_MIN_LENGTH cannot exceed PASSWORD_MAX_LENGTH.')
  }
  if (config.identity.cookieMode === 'cross-origin' && config.corsOrigins.length === 0) {
    throw new Error('COOKIE_MODE=cross-origin requires CORS_ORIGINS with the origins of the other frontend.')
  }
  if (config.identity.cookieMode === 'cross-origin' && config.identity.cookieInsecureDev) {
    throw new Error('COOKIE_INSECURE_DEV cannot be combined with COOKIE_MODE=cross-origin: SameSite=None requires Secure.')
  }
  for (const originValue of config.corsOrigins) {
    let u
    try { u = new URL(originValue) } catch { throw new Error(`CORS_ORIGINS: «${originValue}» is not a valid origin.`) }
    if (u.origin !== originValue) throw new Error(`CORS_ORIGINS: «${originValue}» must be an origin with no path or trailing slash (${u.origin}).`)
  }
  if (!config.apiPrefix.startsWith('/') || config.apiPrefix.endsWith('/')) {
    throw new Error('API_PREFIX must start with / and not end with /.')
  }
}

/** Loads `.env` if it exists, without overriding variables already defined. Keys never live in the repository. */
export function loadEnvFile (file = path.join(rootDir, '.env')) {
  if (existsSync(file)) process.loadEnvFile(file)
}
