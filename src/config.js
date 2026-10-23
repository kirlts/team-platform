// Server configuration. Every knob comes from an environment variable, with its default value
// and the source that justifies it (MASTER-SPEC §4.9: a number that governs operation
// is born declared). «MS» = docs/MASTER-SPEC.md; «I03», «I04», «I07» = docs/investigaciones/.
// No credential has a default value: keys are read from the environment and never stored.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROVIDER_LIMIT_DEFAULTS } from './providers/limiter.js'
import { MAX_EVENT_BYTES } from './telemetry/ui-spec.js'

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

/**
 * EXECUTE_OTEL_ENV (UD-262): KEY=VALUE pairs separated by whitespace, split at the first `=`. A key must be an
 * environment variable name and may not start with TEAM_ (those carry the agent secret). Values cannot hold spaces.
 */
export function otelPairs (raw, name = 'EXECUTE_OTEL_ENV') {
  const out = {}
  for (const pair of String(raw ?? '').split(/\s+/).filter(Boolean)) {
    const i = pair.indexOf('=')
    const key = i > 0 ? pair.slice(0, i) : ''
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || key.startsWith('TEAM_') || key === 'TRACEPARENT') throw new Error(`${name}: «${pair.slice(0, 40)}» no es un par CLAVE=valor válido.`)
    out[key] = pair.slice(i + 1)
  }
  return out
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

/** `team`, `/team` and `/team/` all mean `/team/`; empty or `/` is the root. */
function basePathValue (rawValue) {
  const trimmed = rawValue.trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}/` : '/'
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

    // ---- Network and server
    host: textValue(env, 'HOST', '0.0.0.0'), // inside a container; the compose file publishes the port on loopback
    port: intVar(env, 'PORT', 3000), // I04 §5: the service listens on 127.0.0.1:3000 and the compose file publishes that port on loopback
    nodeEnv: textValue(env, 'NODE_ENV', 'production'), // `development` enables POST /auth/dev-login
    // First Editor (installation): if there are no members, one is created with this email. The password comes from
    // ADMIN_PASSWORD or, if missing, one is generated and shown once in the startup log. Nothing is seeded with a fixed password.
    adminEmail: textValue(env, 'ADMIN_EMAIL', ''),
    adminPassword: textValue(env, 'ADMIN_PASSWORD', ''),
    projectName: textValue(env, 'PROJECT_NAME', 'Team'), // the panel shows it in the header
    apiPrefix: textValue(env, 'API_PREFIX', '/api'), // MS §7.8: the panel calls /api; JSON 404 under /api
    instanceName: textValue(env, 'INSTANCE_NAME', ''), // label of the instance in the rows of `execute_runs` (UD-262); empty = the host of PUBLIC_URL, or «local»
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
    // H-3721: the panel mounted under a path of another site. BASE_PATH is where the panel and its assets live (the API
    // keeps API_PREFIX); `/` is the root, as before. Normalized to start and end with `/`.
    basePath: basePathValue(textValue(env, 'BASE_PATH', '/')),
    // Extra sources of `connect-src` (an API on another origin); empty keeps `'self'` alone (MS §4.1).
    cspConnectSrc: listValue(env, 'CSP_CONNECT_SRC', []),
    // Where the SSO return lands after the session is set (delegated sso-redirect mode).
    ssoReturnPath: textValue(env, 'SSO_RETURN_PATH', '/'),
    // A .css file on the server's disk the host uses to redefine the panel's tokens; empty serves none.
    themeCss: textValue(env, 'THEME_CSS', '') ? path.resolve(textValue(env, 'THEME_CSS', '')) : '',

    // ---- Data
    dataDir,
    dbFile: path.resolve(textValue(env, 'DB_PATH', path.join(dataDir, 'team.db'))),
    attachmentsDir: path.join(dataDir, 'attachments'),
    tmpDir: path.join(dataDir, 'tmp'),
    backupsDir: path.join(dataDir, 'backups'),
    templatesDir: path.resolve(textValue(env, 'TEMPLATES_DIR', path.join(rootDir, 'templates'))), // the initial set that gets installed
    examplesDir: path.resolve(textValue(env, 'EXAMPLES_DIR', path.join(rootDir, 'ejemplos'))), // the sample set of POST /ops/seed
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
      concurrency: intVar(env, 'QUEUE_CONCURRENCY', 8, { min: 1 }), // `docs/investigaciones/mediciones/2026-10-21-concurrencia-de-la-cola.md` (measurement 2026-10-21, UD-025, H-83): lowest p95 at N=16 with no input failed by a provider, behind the provider cap of PROVIDER_MAX_INFLIGHT_*
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
      maxDocumentBytes: intVar(env, 'UPLOAD_MAX_DOCUMENT_BYTES', 24 * MIB, { min: 1 }), // MS §7.4, report 05 §8.3: 24 MB, the extractor's own cap (DT-005)
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

    // ---- Context of the analysis: the author's other inputs that are not published yet (UD-025)
    recentInputs: {
      // The largest burst measured in the concurrency bench is 8 inputs at once (`docs/investigaciones/mediciones/2026-10-21-concurrencia-de-la-cola.md`):
      // 8 covers the 7 others of that burst with one to spare; a burst bigger than the one measured gets the newest 8.
      max: intVar(env, 'RECENT_INPUTS_MAX', 8, { min: 0 }), // measurement 2026-10-21, UD-025: the largest burst measured
      // Courtesy value, not measured: twice the idle time of a session (SESSION_IDLE_MINUTES, 30 min, I04 §11), so the
      // inputs of one working stretch with a break in the middle are context and the ones of yesterday are not.
      maxAgeMinutes: intVar(env, 'RECENT_INPUTS_MAX_AGE_MINUTES', 60, { min: 1 }),
      // Courtesy value, not measured: about one paragraph of text (≈ 200 tokens at 3 chars/token); with the 8 inputs
      // above the context grows by at most 4,800 characters, far below the 100,000-token price step (report 02 §10.2).
      excerptChars: intVar(env, 'RECENT_INPUTS_EXCERPT_CHARS', 600, { min: 1 })
    },

    // ---- Proyecto (UD-024)
    project: {
      // The 100,000 input-token price step of the default model is ≈ 300,000 characters at 3 chars/token in Spanish.
      // 200,000 characters leave room for the input, the catalog and the team in the same call.
      descriptionMaxChars: intVar(env, 'PROJECT_DESCRIPTION_MAX_CHARS', 200000, { min: 1 }), // report 02 §10.2: the 100,000-token price step, UD-024
      // H-3722, declared courtesy (a knob, not a measurement): the header shows the name on one line next to the brand.
      nameMaxChars: intVar(env, 'PROJECT_NAME_MAX_CHARS', 80, { min: 1 }) // declared courtesy, H-3722
    },

    // ---- Analysis framing (H-3722). One paragraph at the head of every system prompt. 2,000 characters are ≈ 670 tokens at
    // the 3 characters per token of the analyzer (`charsPerToken`), ten times the default framing; a longer context is
    // the project description's job (UD-024). Declared courtesy, not measured.
    analysis: {
      framingMaxChars: intVar(env, 'ANALYSIS_FRAMING_MAX_CHARS', 2000, { min: 1 }) // declared courtesy, H-3722
    },

    // ---- Interface telemetry (UD-091, MASTER-SPEC §7.10 ter). Every number cites its source or is declared a courtesy.
    uiTelemetry: {
      // UD-091: on by default (report 09 §6 and §8.12: no cookies, storage, persistent identifier or content); the Editor
      // turns it off in Configuración and the variable sets the initial value.
      enabledDefault: boolVar(env, 'UI_TELEMETRY', true),
      // Informe 09 §5 (fetch.spec.whatwg.org, 2026-10-19): the body quota of requests with `keepalive` is 64 KiB. A batch
      // that fits it can be sent while the page closes.
      maxBodyBytes: intVar(env, 'UI_TELEMETRY_MAX_BODY_BYTES', 64 * 1024, { min: 1 }), // report 09 §5: 64 KiB keepalive quota
      // PostHog leaves 20 % of the keepalive quota free (report 09 §5, posthog.com/docs, 2026-10-21): events per batch =
      // 80 % of the body over the longest possible event (MAX_EVENT_BYTES, measured from the schema).
      maxEvents: intVar(env, 'UI_TELEMETRY_MAX_EVENTS', Math.floor((0.8 * 64 * 1024) / MAX_EVENT_BYTES), { min: 1 }), // report 09 §5, PostHog 80 %
      // PostHog's client allows 10 events a second with a burst of 100 (report 09 §9, 2026-10-21); at most one event per
      // request, so 100 requests in a 10 s window is the same sustained rate and the same burst.
      rateMax: intVar(env, 'UI_TELEMETRY_RATE_MAX', 100, { min: 1 }), // report 09 §9: PostHog, burst of 100
      rateWindowMs: intVar(env, 'UI_TELEMETRY_RATE_WINDOW_MS', 10000, { min: 1 }) // report 09 §9: PostHog, 10 events per second
    },

    // ---- Miembros
    members: {
      // Not a model limit: the whole profile travels to the analyzer (UD-023).
      profileMaxLength: 4000 // declared courtesy: two paragraphs ≈ 2,000 characters; 4,000 leaves room (UD-023)
    },

    // ---- Identidad (MS §7.7, I04 §11)
    identity: {
      // One source or a comma list in order (H-3720): local, delegated (= DELEGATED_MODE), signed-header, jwt,
      // sso-redirect, trusted-header. The first one that identifies the request wins; `identitySources` validates it.
      provider: textValue(env, 'IDENTITY_PROVIDER', 'local'),
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
      },
      // ---- Identity governed by the host site (H-3720, UD-254 amends UD-007)
      // closed: an unknown email gets 403 `member_not_registered`. host: it is created on its first entry with the name and
      // the role the host declares (`member` if it declares none), and a declared role is applied on every entry.
      provision: choiceVar(env, 'IDENTITY_PROVISION', ['closed', 'host'], 'closed'),
      jwtRoleClaim: textValue(env, 'JWT_ROLE_CLAIM', 'role'),
      jwtNameClaim: textValue(env, 'JWT_NAME_CLAIM', 'name'),
      // A host that already has its own session puts its signed JWT in a cookie of its domain; empty = header only.
      jwtCookieName: textValue(env, 'JWT_COOKIE_NAME', ''),
      trustedNameHeader: textValue(env, 'TRUSTED_NAME_HEADER', 'tailscale-user-name').toLowerCase(),
      // Session cookie shared with the host: with a Domain the `__Host-` prefix is not allowed (RFC 6265bis), so the name is this one.
      cookieDomain: textValue(env, 'COOKIE_DOMAIN', ''),
      cookieName: textValue(env, 'COOKIE_NAME', 'team_session'),
      // The host's own sign-out: POST /auth/logout answers it so the panel goes there after closing its own session.
      logoutUrl: textValue(env, 'LOGOUT_URL', '')
    },

    // ---- Unattended Claude Code session for agent members (UD-254, UD-255, MS §7.5 «Ejecución»)
    execute: {
      runner: choiceVar(env, 'EXECUTE_RUNNER', ['local', 'machine'], 'local'), // local: this machine; machine: one the host creates per job
      bin: textValue(env, 'EXECUTE_CLAUDE_BIN', 'claude'), // the `claude` executable of the local runner
      machineBin: textValue(env, 'EXECUTE_MACHINE_CLAUDE_BIN', 'claude'), // the `claude` executable inside the machine
      repoDir: textValue(env, 'EXECUTE_REPO_DIR', ''), // the host repository; the session works on a worktree of it, branch tp/<message_id>
      workRoot: textValue(env, 'EXECUTE_WORK_ROOT', ''), // where each job's directory is created; empty = $DATA_DIR/tmp
      teamUrl: textValue(env, 'EXECUTE_TEAM_URL', ''), // the API address the session calls with `team`; empty = http://127.0.0.1:$PORT
      model: textValue(env, 'EXECUTE_MODEL', 'claude-sonnet-5-5'), // UD-255: Sonnet 5.5
      effort: choiceVar(env, 'EXECUTE_EFFORT', ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'), // UD-255: medium reasoning; `claude --help` 2.1.284 lists these levels for --effort
      maxBudgetUsd: decimal(env, 'EXECUTE_MAX_BUDGET_USD', 10, { min: 0.01 }), // UD-255: 10 USD per message to start
      // UD-256: 10 USD per day in total across `execute` jobs; the day is the server's local day (TZ, UTC when unset).
      dailyBudgetUsd: decimal(env, 'EXECUTE_DAILY_BUDGET_USD', 10, { min: 0 }),
      maxMachines: intVar(env, 'EXECUTE_MAX_MACHINES', 0, { min: 0 }), // 0 = no bound; the host sets the machines its quota holds
      capacityWaitMs: intVar(env, 'EXECUTE_CAPACITY_WAIT_MS', 30_000, { min: 1000 }), // measured 2026-10-22: creating a harness machine took 32 s (UD-262 timing); looking again sooner finds nothing free
      machineCostUsd: decimal(env, 'EXECUTE_MACHINE_COST_USD', 0, { min: 0 }), // fixed cost of each machine-runner job; host site: 0.07
      maxTurns: intVar(env, 'EXECUTE_MAX_TURNS', 60, { min: 1 }), // H-3724 brief: 60 turns; the budget cap is what governs spend
      hostInstructions: textValue(env, 'EXECUTE_HOST_INSTRUCTIONS', ''), // path to a host .md file appended to the prompt; the host's rules
      maxSubagents: intVar(env, 'EXECUTE_MAX_SUBAGENTS', 3, { min: 0 }), // UD-255: up to three subagents per message
      // UD-255: one run can cost up to the budget; a queue retry would spend it again, so one attempt by default.
      maxAttempts: intVar(env, 'EXECUTE_MAX_ATTEMPTS', 1, { min: 1 }),
      // Declared courtesy: it bounds a machine or a session that hangs; the spend is bounded by EXECUTE_MAX_BUDGET_USD.
      // It is the job's own cap and replaces QUEUE_MAX_RUNTIME_MS for `execute` jobs.
      timeoutMs: intVar(env, 'EXECUTE_TIMEOUT_MS', 3600000, { min: 1 }), // declared courtesy, see above
      // Declared courtesy: after SIGTERM the run gets this long to exit (code 143) before SIGKILL.
      killGraceMs: intVar(env, 'EXECUTE_KILL_GRACE_MS', 10000, { min: 1 }), // declared courtesy, see above
      machineCreate: textValue(env, 'EXECUTE_MACHINE_CREATE', ''), // shell command; {job_id}, {workdir}; last stdout line = {machine}
      machineRun: textValue(env, 'EXECUTE_MACHINE_RUN', ''), // shell command; {job_id}, {workdir}, {machine}; its stdout is the NDJSON stream
      machineDestroy: textValue(env, 'EXECUTE_MACHINE_DESTROY', ''), // shell command; {job_id}, {workdir}, {machine}; runs always
      machineCollect: textValue(env, 'EXECUTE_MACHINE_COLLECT', ''), // optional shell command; {machine}, {job_id}; last stdout line = where it left the session transcript (UD-262)
      runsRetentionDays: intVar(env, 'EXECUTE_RUNS_RETENTION_DAYS', 365, { min: 1 }), // UD-262: the history of runs outlives the 7 days of the spans; a year lets a change be compared with the previous ones
      // UD-263: the delivery is a separate job without AI. Empty command = no separate delivery: `execute` publishes its final reply as before.
      deliverCommand: textValue(env, 'EXECUTE_DELIVER_COMMAND', ''), // shell command; {message_id}, {job_id}, {branch}, {workdir}; exit 0 = in production (last stdout line = reference), 75 = not now, other = failed
      // Declared courtesy: it bounds a verification or a deploy that hangs; a delivery that runs long fails with its output.
      deliverTimeoutMs: intVar(env, 'EXECUTE_DELIVER_TIMEOUT_MS', 900000, { min: 1 }), // declared courtesy, see above
      deliverRetries: intVar(env, 'EXECUTE_DELIVER_RETRIES', 1, { min: 0 }), // UD-263: a failed verification returns to Claude once; a second failure is reported
      // UD-263: the command is idempotent by contract, so a delivery whose worker died runs once more; exit 75 never spends an attempt.
      deliverMaxAttempts: intVar(env, 'EXECUTE_DELIVER_MAX_ATTEMPTS', 2, { min: 1 }),
      // Measurement 2026-10-23-tokens-y-cache.md: any other variable of the session (CLAUDE_CODE_PROMPT_CACHE_TTL=1h, CLAUDE_CODE_DISABLE_CLAUDE_MDS=1…), same format.
      // UD-268: screenshots of the interface in the replies. The size cap is the one of an image upload (UPLOAD_MAX_IMAGE_BYTES); the count is declared here.
      captures: {
        max: intVar(env, 'EXECUTE_CAPTURES_MAX', 3, { min: 0 }), // declared courtesy: one view and its dialog, per reply; it never reaches UPLOAD_MAX_FILES (10), the cap of files in a reply
        openZone: textValue(env, 'EXECUTE_CAPTURES_OPEN_ZONE', 'ninguna') // the only value of the output's `zone` with which an unmasked capture is attached; the platform knows no other zone
      },
      sessionEnv: otelPairs(env.EXECUTE_SESSION_ENV, 'EXECUTE_SESSION_ENV'),
      // Measurement 2026-10-23-tokens-y-cache.md: the part of the prompt that is the same for every job goes in `--append-system-prompt-file`, which the API caches
      // across sessions; in the user message it is written again by each session (measured 2026-10-23, 2026-10-23-tokens-y-cache.md).
      stableAsSystem: boolVar(env, 'EXECUTE_STABLE_AS_SYSTEM', false),
      otelEnv: otelPairs(env.EXECUTE_OTEL_ENV) // UD-262: KEY=VALUE pairs given to `claude -p` for its own telemetry (CLAUDE_CODE_ENABLE_TELEMETRY, OTEL_*)
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
      speech: { provider: textValue(env, 'SPEECH_PROVIDER', 'groq-speech'), model: textValue(env, 'SPEECH_MODEL', '') },
      // Simultaneous requests of the whole process to each provider (src/providers/limiter.js, H-83); 0 = no cap. The
      // defaults are the ones of PROVIDER_LIMIT_DEFAULTS, which cites the measurement
      // `docs/investigaciones/mediciones/2026-10-21-concurrencia-de-la-cola.md` (measurement 2026-10-21).
      maxInflight: {
        anthropic: intVar(env, 'PROVIDER_MAX_INFLIGHT_ANTHROPIC', PROVIDER_LIMIT_DEFAULTS.anthropic), // measurement 2026-10-21, see PROVIDER_LIMIT_DEFAULTS
        groq: intVar(env, 'PROVIDER_MAX_INFLIGHT_GROQ', PROVIDER_LIMIT_DEFAULTS.groq), // measurement 2026-10-21, see PROVIDER_LIMIT_DEFAULTS
        openaiCompatible: intVar(env, 'PROVIDER_MAX_INFLIGHT_OPENAI_COMPATIBLE', PROVIDER_LIMIT_DEFAULTS.openaiCompatible) // measurement 2026-10-21, see PROVIDER_LIMIT_DEFAULTS
      },
      // Deadline of each request of a probe (key replacement, function change, diagnosis; UD-120). 30 s is what the project that
      // inspired the screen measured for its own probe and half of LiteLLM's 60 s (report 11 §6 point 8); the probe sends one token.
      probe: { timeoutMs: intVar(env, 'PROVIDER_PROBE_TIMEOUT_MS', 30000, { min: 1 }) }, // informe 11 §6 punto 8, consultado 2026-10-21
      // Adaptive backoff after a 429 on the cap: wait one cooldown, then give back one request per restore step.
      backoff: {
        cooldownMs: intVar(env, 'PROVIDER_BACKOFF_COOLDOWN_MS', PROVIDER_LIMIT_DEFAULTS.cooldownMs, { min: 1 }), // measurement 2026-10-21, see PROVIDER_LIMIT_DEFAULTS
        restoreStepMs: intVar(env, 'PROVIDER_BACKOFF_RESTORE_STEP_MS', PROVIDER_LIMIT_DEFAULTS.restoreStepMs, { min: 1 }) // measurement 2026-10-21, see PROVIDER_LIMIT_DEFAULTS
      }
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

export const IDENTITY_SOURCES = ['local', 'signed-header', 'jwt', 'sso-redirect', 'trusted-header']

/**
 * The identity sources in order (H-3720). `IDENTITY_PROVIDER` is one name or a comma list; `delegated` stands for
 * DELEGATED_MODE, so `IDENTITY_PROVIDER=delegated` keeps meaning what it meant. An unknown name stops the startup.
 */
export function identitySources (identity) {
  const list = String(identity.provider).split(',').map((x) => x.trim()).filter(Boolean)
    .map((x) => (x === 'delegated' ? identity.delegated.mode : x))
  if (list.length === 0) throw new Error('IDENTITY_PROVIDER is empty.')
  for (const x of list) {
    if (!IDENTITY_SOURCES.includes(x)) throw new Error(`IDENTITY_PROVIDER: «${x}» is not one of: delegated, ${IDENTITY_SOURCES.join(', ')}.`)
  }
  return [...new Set(list)]
}

function validateConfig (config) {
  const d = config.identity.delegated
  const sources = identitySources(config.identity)
  {
    if (sources.includes('signed-header') && d.secrets.length === 0) {
      throw new Error('IDENTITY_PROVIDER=delegated with DELEGATED_MODE=signed-header requires DELEGATED_SECRETS.')
    }
    if (sources.includes('jwt')) {
      if (!d.jwt.jwksUrl && !d.jwt.secret) throw new Error('The jwt mode requires JWT_JWKS_URL or JWT_SECRET.')
      // I04 §3.3: without issuer and audience the SDK trusts on first use; it does not start like that.
      if (!d.jwt.issuer || !d.jwt.audience) throw new Error('The jwt mode requires JWT_ISSUER and JWT_AUDIENCE.')
    }
    if (sources.includes('sso-redirect')) {
      if (!d.sso.loginUrl || !d.sso.secret) throw new Error('The sso-redirect mode requires SSO_LOGIN_URL and SSO_SECRET.')
      if (!config.publicUrl) throw new Error('The sso-redirect mode requires PUBLIC_URL to build the return address.')
    }
  }
  const x = config.execute
  if (x.runner === 'machine' && (!x.machineCreate || !x.machineRun || !x.machineDestroy)) {
    throw new Error('EXECUTE_RUNNER=machine requires EXECUTE_MACHINE_CREATE, EXECUTE_MACHINE_RUN and EXECUTE_MACHINE_DESTROY.')
  }
  if (config.worker.heartbeatMs >= config.worker.leaseMs) {
    throw new Error('QUEUE_HEARTBEAT_MS must be less than QUEUE_LEASE_MS.')
  }
  if (config.identity.password.minLength > config.identity.password.maxLength) {
    throw new Error('PASSWORD_MIN_LENGTH cannot exceed PASSWORD_MAX_LENGTH.')
  }
  if (config.identity.cookieDomain && !/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(config.identity.cookieName)) {
    throw new Error(`COOKIE_NAME: «${config.identity.cookieName}» is not a valid cookie name.`)
  }
  if (config.identity.cookieDomain && /^__Host-/i.test(config.identity.cookieName)) {
    throw new Error('COOKIE_NAME cannot start with __Host- when COOKIE_DOMAIN is set: the prefix forbids Domain.')
  }
  if (config.identity.logoutUrl) {
    try { new URL(config.identity.logoutUrl) } catch { throw new Error(`LOGOUT_URL: «${config.identity.logoutUrl}» is not an absolute URL.`) }
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
  if (/[?#\s]/.test(config.basePath) || config.basePath.includes('//')) {
    throw new Error(`BASE_PATH: «${config.basePath}» must be a plain path such as /team/.`)
  }
  if (!config.ssoReturnPath.startsWith('/') || config.ssoReturnPath.startsWith('//')) {
    throw new Error('SSO_RETURN_PATH must be a path of this site that starts with a single /.')
  }
  if (config.themeCss && !existsSync(config.themeCss)) {
    throw new Error(`THEME_CSS: the file ${config.themeCss} does not exist.`)
  }
}

/** Loads `.env` if it exists, without overriding variables already defined. Keys never live in the repository. */
export function loadEnvFile (file = path.join(rootDir, '.env')) {
  if (existsSync(file)) process.loadEnvFile(file)
}
