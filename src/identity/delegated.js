// `delegated` provider (MASTER-SPEC §7.7, UD-002, report 04 §3): the host site says who the person is.
// Four modes under the same `identify(request)` contract. None of them creates members (UD-007): the email
// has to exist in `members`, or the response is 403.
//
//   signed-header   X-Team-User, X-Team-Ts, X-Team-Sig. HMAC-SHA256 over
//                   `${ts}.${METHOD}.${path}.${email}` (or `${ts}.${email}` with DELEGATED_BIND_REQUEST=false).
//                   `ts` in Unix seconds; 5-minute tolerance (Stripe's webhook signing pattern).
//   jwt             A header with a JWT verified with `jose` against a JWKS or a secret, with issuer, audience and
//                   algorithms fixed in the configuration (never read from the token, RFC 8725).
//   sso-redirect    Signed redirect with a single-use nonce (DiscourseConnect pattern). After the return
//                   a session of our own is issued, the same as the local provider's.
//   trusted-header  Identity header injected by a proxy (Tailscale Serve). Only accepted if the connection
//                   comes from an address in TRUSTED_PROXIES.

import { BlockList, isIPv4, isIPv6 } from 'node:net'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose'
import { get, run, tx } from '../db/index.js'
import { badRequest, forbidden } from '../domain/errors.js'
import { clearSessionCookie, cookieSpec, readSessionCookie, setSessionCookie } from './cookies.js'

function findMember (db, email) {
  return get(db, 'SELECT id, email, name, role, active FROM members WHERE email = ?', email)
}

/** A deactivated member cannot enter through any provider; the history stays. */
function assertActive (memberRow) {
  if (memberRow && !memberRow.active) throw forbidden('La cuenta está desactivada. Un editor puede reactivarla.', 'account_inactive')
  return memberRow
}

function asIdentity (memberRow) {
  return { member_id: memberRow.id, role: memberRow.role, email: memberRow.email, name: memberRow.name }
}

/** UD-007: a delegated identity with no row in `members` gets 403, never an automatic sign-up. */
function demandMember (db, email) {
  const memberRow = findMember(db, email)
  if (!memberRow) throw forbidden('La cuenta no está registrada en el equipo. Un editor debe agregarla.', 'member_not_registered')
  return assertActive(memberRow)
}

const safeEqual = (a, b) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function signHeader (sharedSecret, { ts, method, pathname, email, bind }) {
  const msgRow = bind ? `${ts}.${method}.${pathname}.${email}` : `${ts}.${email}`
  return createHmac('sha256', sharedSecret).update(msgRow).digest('hex')
}

function signedHeaderMode ({ db, config, now }) {
  const d = config.identity.delegated
  return {
    identify (request) {
      const email = request.headers['x-team-user']
      const ts = request.headers['x-team-ts']
      const signature = request.headers['x-team-sig']
      if (!email || !ts || !signature) return null
      const secondsCount = Number(ts)
      if (!Number.isFinite(secondsCount) || Math.abs(now() / 1000 - secondsCount) > d.tsToleranceSeconds) return null
      const pathname = request.raw.url.split('?')[0]
      const isValid = d.secrets.some((sharedSecret) =>
        safeEqual(signHeader(sharedSecret, { ts, method: request.method, pathname, email, bind: d.bindRequest }), String(signature)))
      return isValid ? asIdentity(demandMember(db, email)) : null
    }
  }
}

function jwtMode ({ db, config }) {
  const j = config.identity.delegated.jwt
  const algs = j.algorithms.length > 0 ? j.algorithms : [j.jwksUrl ? 'RS256' : 'HS256']
  // createRemoteJWKSet fetches the keys again when an unknown `kid` arrives (key rotation).
  const lookupKey = j.jwksUrl ? createRemoteJWKSet(new URL(j.jwksUrl), { cooldownDuration: j.jwksCooldownMs }) : new TextEncoder().encode(j.secret)
  return {
    async identify (request) {
      let tokenValue = request.headers[j.header]
      if (!tokenValue) return null
      if (j.header === 'authorization') {
        if (!/^Bearer\s+/i.test(tokenValue)) return null
        tokenValue = tokenValue.replace(/^Bearer\s+/i, '')
      }
      let payload
      try {
        ({ payload } = await jwtVerify(tokenValue, lookupKey, { issuer: j.issuer, audience: j.audience, algorithms: algs }))
      } catch (error) {
        if (error instanceof joseErrors.JOSEError) return null
        throw error
      }
      const email = payload[j.emailClaim]
      if (typeof email !== 'string' || email === '') return null
      return asIdentity(demandMember(db, email))
    }
  }
}

function trustedHeaderMode ({ db, config }) {
  const d = config.identity.delegated
  const listValue = new BlockList()
  for (const loginResponse of config.trustedProxies) {
    const [addr, prefixPath] = loginResponse.split('/')
    const family = isIPv6(addr) ? 'ipv6' : isIPv4(addr) ? 'ipv4' : null
    if (!family) throw new Error(`TRUSTED_PROXIES: «${loginResponse}» is neither an IP nor a CIDR.`)
    if (prefixPath === undefined) listValue.addAddress(addr, family)
    else listValue.addSubnet(addr, Number(prefixPath), family)
  }
  return {
    identify (request) {
      const val = request.headers[d.trustedHeaderName]
      if (!val) return null
      const originValue = request.socket?.remoteAddress
      if (!originValue) return null
      const normal = originValue.startsWith('::ffff:') ? originValue.slice(7) : originValue
      const family = isIPv6(normal) ? 'ipv6' : 'ipv4'
      // Without this, anyone who can reach the port would set the header by hand (report 04 §3.1).
      if (!listValue.check(normal, family)) return null
      return asIdentity(demandMember(db, String(val)))
    }
  }
}

const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const signHex = (sharedSecret, textValue) => createHmac('sha256', sharedSecret).update(textValue).digest('hex')

function ssoMode ({ db, config, sessions, now }) {
  const d = config.identity.delegated.sso
  const spec = cookieSpec(config)
  const nonceCookieName = spec.name.startsWith('__Host-') ? '__Host-sso' : 'sso-nonce'
  const lifetimeMs = d.nonceMinutes * 60 * 1000

  return {
    // The session is the same as the local provider's.
    identify (request) {
      const memberRow = sessions.lookup(readSessionCookie(request, config))
      return memberRow ? { member_id: memberRow.id, role: memberRow.role, email: memberRow.email, name: memberRow.name } : null
    },
    routes (app) {
      // 1. Outbound: single-use nonce tied to the browser by a short-lived cookie.
      app.get('/auth/sso/start', { config: { public: true }, schema: { response: { 302: { type: 'null', description: 'Redirección firmada al inicio de sesión del anfitrión.' } } } }, async (request, reply) => {
        const nonce = randomBytes(24).toString('base64url')
        run(db, 'INSERT INTO sso_nonces (nonce, created_at) VALUES (?, ?)', nonce, now())
        const callbackRes = `${config.publicUrl.replace(/\/$/, '')}${config.apiPrefix}/auth/sso/callback`
        const sso = base64url({ nonce, return_sso_url: callbackRes })
        const target = new URL(d.loginUrl)
        target.searchParams.set('sso', sso)
        target.searchParams.set('sig', signHex(d.secret, sso))
        reply.setCookie(nonceCookieName, nonce, { ...spec.options, maxAge: Math.floor(lifetimeMs / 1000), sameSite: 'lax' })
        return reply.redirect(target.toString(), 302)
      })

      // 2. Return: signature, nonce still valid and tied to the browser, email verified by the host.
      app.get('/auth/sso/callback', { config: { public: true }, schema: { response: { 302: { type: 'null', description: 'Sesión creada; vuelve al panel.' } } } }, async (request, reply) => {
        const { sso, sig } = request.query
        if (typeof sso !== 'string' || typeof sig !== 'string' || !safeEqual(signHex(d.secret, sso), sig)) {
          throw forbidden('La respuesta del inicio de sesión no es válida.', 'sso_invalid')
        }
        let payloadData
        try { payloadData = JSON.parse(Buffer.from(sso, 'base64url').toString('utf8')) } catch { throw badRequest('La respuesta del inicio de sesión no se pudo leer.', 'sso_invalid') }
        const cookieNonce = request.cookies?.[nonceCookieName]
        if (!payloadData.nonce || !cookieNonce || !safeEqual(String(payloadData.nonce), cookieNonce)) {
          throw forbidden('La respuesta no corresponde a este navegador.', 'sso_invalid')
        }
        // Single use: consumed inside a transaction so two simultaneous returns cannot both pass.
        const consumed = tx(db, () => {
          const dbRow = get(db, 'SELECT created_at, used_at FROM sso_nonces WHERE nonce = ?', payloadData.nonce)
          if (!dbRow || dbRow.used_at !== null || dbRow.created_at + lifetimeMs < now()) return false
          run(db, 'UPDATE sso_nonces SET used_at = ? WHERE nonce = ?', now(), payloadData.nonce)
          return true
        })
        reply.clearCookie(nonceCookieName, { path: '/', httpOnly: true, secure: spec.options.secure, sameSite: 'lax' })
        if (!consumed) throw forbidden('La respuesta del inicio de sesión venció o ya se usó.', 'sso_invalid')
        // DiscourseConnect: without an email verified by the host, the account is exposed to takeover.
        if (payloadData.email_verified !== true) throw forbidden('El anfitrión no verificó el correo.', 'sso_unverified')
        if (typeof payloadData.email !== 'string' || !payloadData.email) throw badRequest('Falta el correo en la respuesta.', 'sso_invalid')

        // Mapping by stable external identifier; the email only counts the first time.
        let memberRow = null
        if (payloadData.external_id !== undefined && payloadData.external_id !== null && String(payloadData.external_id) !== '') {
          const externalValue = String(payloadData.external_id)
          const linkRow = get(db, "SELECT member_id FROM identity_links WHERE provider = 'sso' AND external_id = ?", externalValue)
          if (linkRow) memberRow = assertActive(get(db, 'SELECT id, email, name, role, active FROM members WHERE id = ?', linkRow.member_id))
          else {
            memberRow = demandMember(db, payloadData.email)
            run(db, "INSERT INTO identity_links (provider, external_id, member_id, created_at) VALUES ('sso', ?, ?, ?)", externalValue, memberRow.id, now())
          }
        } else {
          memberRow = demandMember(db, payloadData.email)
        }
        const previous = readSessionCookie(request, config)
        if (previous) sessions.destroy(previous)
        setSessionCookie(reply, config, sessions.create(memberRow.id).token)
        return reply.redirect(config.ssoReturnPath, 302) // SSO_RETURN_PATH: the panel may live under a path (H-3721)
      })

      app.post('/auth/logout', { config: { public: true }, schema: { response: { 204: { type: 'null', description: 'Sesión cerrada en el servidor.' } } } }, async (request, reply) => {
        sessions.destroy(readSessionCookie(request, config))
        clearSessionCookie(reply, config)
        return reply.code(204).send()
      })
    }
  }
}

export function createDelegatedProvider (deps) {
  const modeName = deps.config.identity.delegated.mode
  const factories = {
    'signed-header': signedHeaderMode,
    jwt: jwtMode,
    'sso-redirect': ssoMode,
    'trusted-header': trustedHeaderMode
  }
  const strategy = factories[modeName]({ ...deps, now: deps.now ?? Date.now })
  return { name: `delegated:${modeName}`, identify: strategy.identify, routes: strategy.routes ?? (() => {}) }
}
