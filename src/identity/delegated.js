// `delegated` sources (MASTER-SPEC §7.7, UD-002, report 04 §3): the host site says who the person is.
// Four modes under the same `identify(request)` contract; `IDENTITY_PROVIDER` may list several (H-3720).
// With IDENTITY_PROVISION=closed (default) the email has to exist in `members`, or the response is 403 (UD-007).
// With IDENTITY_PROVISION=host an unknown email is created on its first entry with the name and the role the host
// declares, and a declared role is applied on every entry; that member's role is then governed by the host
// (UD-254 amends UD-007 by its written condition). An undeclared or unknown role leaves the role to the database.
//
//   signed-header   X-Team-User, X-Team-Ts, X-Team-Sig. HMAC-SHA256 over
//                   `${ts}.${METHOD}.${path}.${email}` (or `${ts}.${email}` with DELEGATED_BIND_REQUEST=false).
//                   With X-Team-Role or X-Team-Name (percent-encoded UTF-8) the message continues with
//                   `\n${role}\n${name}` (raw header values; a header value cannot hold a newline).
//                   `ts` in Unix seconds; 5-minute tolerance (Stripe's webhook signing pattern).
//   jwt             A header (or the host's cookie JWT_COOKIE_NAME) with a JWT verified with `jose` against a JWKS or a
//                   secret, with issuer, audience and algorithms fixed in the configuration (never read from the token, RFC 8725).
//                   Role and name in JWT_ROLE_CLAIM and JWT_NAME_CLAIM; `exp` bounds the session of our own.
//   sso-redirect    Signed redirect with a single-use nonce (DiscourseConnect pattern), with `role` and `name` in the
//                   payload. After the return a session of our own is issued, the same as the local provider's.
//   trusted-header  Identity header injected by a proxy (Tailscale Serve). Only accepted if the connection
//                   comes from an address in TRUSTED_PROXIES. The name comes from TRUSTED_NAME_HEADER; no role.

import { BlockList, isIPv4, isIPv6 } from 'node:net'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose'
import { get, run, tx } from '../db/index.js'
import { badRequest, forbidden } from '../domain/errors.js'
import { audit } from '../domain/audit.js'
import { createMember } from '../domain/members.js'
import { cookieSpec, readSessionCookie, setSessionCookie } from './cookies.js'

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

const HOST_ROLES = ['member', 'editor']
const HOST_ROLE_LINK = 'host-role' // identity_links row: this member's role is governed by the host (H-3720)

/** Whether the host governs this member's role: the local Editor cannot change it (409 `role_managed_externally`). */
export function isRoleGoverned (db, memberId) {
  return Boolean(get(db, 'SELECT 1 AS g FROM identity_links WHERE provider = ? AND member_id = ?', HOST_ROLE_LINK, memberId))
}

/**
 * The member a host identity points to. `closed`: it must exist (UD-007). `host`: created on its first entry, and the
 * declared role (one of ROLES; anything else counts as undeclared) replaces the stored one on every entry.
 */
export function resolveMember (db, config, { email, name, role, issuedAt }, now = Date.now) {
  const provision = config.identity.provision === 'host'
  let declared = provision && HOST_ROLES.includes(role) ? role : null
  const stamped = Number.isFinite(issuedAt) ? issuedAt : null
  let memberRow = findMember(db, email)
  if (!memberRow) {
    if (!provision) throw forbidden('La cuenta no está registrada en el equipo. Un editor debe agregarla.', 'member_not_registered')
    const cleanName = typeof name === 'string' && name.trim() !== '' ? name.trim() : email.split('@')[0]
    tx(db, () => {
      if (findMember(db, email)) return // another request created it first
      const id = createMember(db, { email, name: cleanName, role: declared ?? 'member' }, { now })
      audit(db, { memberId: null, action: 'member.provision', entity: 'member', entityId: id, detail: { email, role: declared ?? 'member' }, now })
    })
    memberRow = findMember(db, email)
  }
  assertActive(memberRow)
  // A token older than the last one applied never overwrites a newer role (the host may have changed it since).
  if (declared && stamped !== null) {
    const last = get(db, 'SELECT host_role_iat AS iat FROM members WHERE id = ?', memberRow.id)?.iat
    if (last !== null && last !== undefined && stamped < last) declared = null
  }
  if (declared) {
    tx(db, () => {
      if (stamped !== null) run(db, 'UPDATE members SET host_role_iat = ? WHERE id = ? AND (host_role_iat IS NULL OR host_role_iat < ?)', stamped, memberRow.id, stamped)
      run(db, 'INSERT OR IGNORE INTO identity_links (provider, external_id, member_id, created_at) VALUES (?, ?, ?, ?)', HOST_ROLE_LINK, String(memberRow.id), memberRow.id, now())
      if (memberRow.role !== declared) {
        run(db, 'UPDATE members SET role = ? WHERE id = ?', declared, memberRow.id)
        audit(db, { memberId: null, action: 'member.role_from_host', entity: 'member', entityId: memberRow.id, detail: { from: memberRow.role, to: declared }, now })
      }
    })
    memberRow = { ...memberRow, role: declared }
  }
  return memberRow
}

const safeEqual = (a, b) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function signHeader (sharedSecret, { ts, method, pathname, email, bind, role, name }) {
  const base = bind ? `${ts}.${method}.${pathname}.${email}` : `${ts}.${email}`
  const msgRow = role !== undefined || name !== undefined ? `${base}\n${role ?? ''}\n${name ?? ''}` : base
  return createHmac('sha256', sharedSecret).update(msgRow).digest('hex')
}

const decodeName = (raw) => {
  if (typeof raw !== 'string') return undefined
  try { return decodeURIComponent(raw) } catch { return raw }
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
      const role = request.headers['x-team-role']
      const rawName = request.headers['x-team-name']
      const isValid = d.secrets.some((sharedSecret) =>
        safeEqual(signHeader(sharedSecret, { ts, method: request.method, pathname, email, bind: d.bindRequest, role, name: rawName }), String(signature)))
      if (!isValid) return null
      return asIdentity(resolveMember(db, config, { email, name: decodeName(rawName), role }, now))
    }
  }
}

function jwtMode ({ db, config, now }) {
  const j = config.identity.delegated.jwt
  const idc = config.identity
  const algs = j.algorithms.length > 0 ? j.algorithms : [j.jwksUrl ? 'RS256' : 'HS256']
  // createRemoteJWKSet fetches the keys again when an unknown `kid` arrives (key rotation).
  const lookupKey = j.jwksUrl ? createRemoteJWKSet(new URL(j.jwksUrl), { cooldownDuration: j.jwksCooldownMs }) : new TextEncoder().encode(j.secret)
  return {
    async identify (request) {
      let tokenValue = request.headers[j.header]
      if (tokenValue && j.header === 'authorization') {
        tokenValue = /^Bearer\s+/i.test(tokenValue) ? tokenValue.replace(/^Bearer\s+/i, '') : null
      }
      // The host that already has a session puts the same JWT in a cookie of its domain (JWT_COOKIE_NAME).
      if (!tokenValue && idc.jwtCookieName) tokenValue = request.cookies?.[idc.jwtCookieName]
      if (!tokenValue) return null
      let payload
      try {
        ({ payload } = await jwtVerify(tokenValue, lookupKey, { issuer: j.issuer, audience: j.audience, algorithms: algs }))
      } catch (error) {
        if (error instanceof joseErrors.JOSEError) return null
        throw error
      }
      const email = payload[j.emailClaim]
      if (typeof email !== 'string' || email === '') return null
      const memberRow = resolveMember(db, config, { email, name: payload[idc.jwtNameClaim], role: payload[idc.jwtRoleClaim], issuedAt: payload.iat }, now)
      return { ...asIdentity(memberRow), expiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : null }
    }
  }
}

function trustedHeaderMode ({ db, config, now }) {
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
      const nameValue = request.headers[config.identity.trustedNameHeader]
      return asIdentity(resolveMember(db, config, { email: String(val), name: typeof nameValue === 'string' ? nameValue : undefined }, now))
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
    // No header of its own: after the return the identity is the session of our own, read by the shared lookup.
    identify: () => null,
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
          if (linkRow) {
            const linked = assertActive(get(db, 'SELECT id, email, name, role, active FROM members WHERE id = ?', linkRow.member_id))
            memberRow = resolveMember(db, config, { email: linked.email, role: payloadData.role }, now)
          }
          else {
            memberRow = resolveMember(db, config, { email: payloadData.email, name: payloadData.name, role: payloadData.role }, now)
            run(db, "INSERT INTO identity_links (provider, external_id, member_id, created_at) VALUES ('sso', ?, ?, ?)", externalValue, memberRow.id, now())
          }
        } else {
          memberRow = resolveMember(db, config, { email: payloadData.email, name: payloadData.name, role: payloadData.role }, now)
        }
        const previous = readSessionCookie(request, config)
        if (previous) sessions.destroy(previous)
        setSessionCookie(reply, config, sessions.create(memberRow.id).token)
        return reply.redirect(config.ssoReturnPath, 302) // SSO_RETURN_PATH: the panel may live under a path (H-3721)
      })
    }
  }
}

const FACTORIES = {
  'signed-header': signedHeaderMode,
  jwt: jwtMode,
  'sso-redirect': ssoMode,
  'trusted-header': trustedHeaderMode
}

/** One delegated source by name. `identify` returns the identity (with `expiresAt` when the host's token has one) or null. */
export function createDelegatedSource (modeName, deps) {
  const strategy = FACTORIES[modeName]({ ...deps, now: deps.now ?? Date.now })
  return { name: modeName, identify: strategy.identify, routes: strategy.routes ?? (() => {}) }
}
