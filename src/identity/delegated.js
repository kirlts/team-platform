// Proveedor `delegated` (MASTER-SPEC §7.7, UD-002, informe 04 §3): el sitio anfitrión dice quién es la persona.
// Cuatro modos bajo el mismo contrato `identify(request)`. Ninguno da de alta miembros (UD-007): el correo
// tiene que existir en `members`, o la respuesta es 403.
//
//   signed-header   X-Team-User, X-Team-Ts, X-Team-Sig. HMAC-SHA256 sobre
//                   `${ts}.${MÉTODO}.${ruta}.${correo}` (o `${ts}.${correo}` con DELEGATED_BIND_REQUEST=false).
//                   `ts` en segundos Unix; tolerancia de 5 minutos (patrón de firma de webhooks de Stripe).
//   jwt             Cabecera con un JWT verificado con `jose` contra JWKS o secreto, con issuer, audience y
//                   algoritmos fijados en la configuración (nunca leídos de la ficha, RFC 8725).
//   sso-redirect    Redirección firmada con nonce de uso único (patrón DiscourseConnect). Tras el retorno se
//                   emite una sesión propia, igual que la del proveedor local.
//   trusted-header  Cabecera de identidad que inyecta un proxy (Tailscale Serve). Sólo se acepta si la conexión
//                   llega desde una dirección de TRUSTED_PROXIES.

import { BlockList, isIPv4, isIPv6 } from 'node:net'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose'
import { get, run, tx } from '../db/index.js'
import { badRequest, forbidden } from '../domain/errors.js'
import { clearSessionCookie, cookieSpec, readSessionCookie, setSessionCookie } from './cookies.js'

function findMember (db, email) {
  return get(db, 'SELECT id, email, name, role FROM members WHERE email = ?', email)
}

function asIdentity (memberRow) {
  return { member_id: memberRow.id, role: memberRow.role, email: memberRow.email, name: memberRow.name }
}

/** UD-007: la identidad delegada sin fila en `members` recibe 403, nunca un alta automática. */
function demandMember (db, email) {
  const memberRow = findMember(db, email)
  if (!memberRow) throw forbidden('La cuenta no está registrada en el equipo. Un editor debe agregarla.', 'member_not_registered')
  return memberRow
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
  // createRemoteJWKSet vuelve a pedir las llaves cuando llega un `kid` desconocido (rotación de llaves).
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
    if (!family) throw new Error(`TRUSTED_PROXIES: «${loginResponse}» no es una IP ni un CIDR.`)
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
      // Sin esto, cualquiera que alcance el puerto fijaría la cabecera a mano (informe 04 §3.1).
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
    // La sesión es la misma que la del proveedor local.
    identify (request) {
      const memberRow = sessions.lookup(readSessionCookie(request, config))
      return memberRow ? { member_id: memberRow.id, role: memberRow.role, email: memberRow.email, name: memberRow.name } : null
    },
    routes (app) {
      // 1. Salida: nonce de uso único atado al navegador por una cookie corta.
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

      // 2. Retorno: firma, nonce vigente y atado al navegador, correo verificado por el anfitrión.
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
        // Uso único: se consume dentro de una transacción para que dos retornos simultáneos no pasen ambos.
        const consumed = tx(db, () => {
          const dbRow = get(db, 'SELECT created_at, used_at FROM sso_nonces WHERE nonce = ?', payloadData.nonce)
          if (!dbRow || dbRow.used_at !== null || dbRow.created_at + lifetimeMs < now()) return false
          run(db, 'UPDATE sso_nonces SET used_at = ? WHERE nonce = ?', now(), payloadData.nonce)
          return true
        })
        reply.clearCookie(nonceCookieName, { path: '/', httpOnly: true, secure: spec.options.secure, sameSite: 'lax' })
        if (!consumed) throw forbidden('La respuesta del inicio de sesión venció o ya se usó.', 'sso_invalid')
        // DiscourseConnect: sin correo verificado por el anfitrión, la cuenta queda expuesta a ser tomada.
        if (payloadData.email_verified !== true) throw forbidden('El anfitrión no verificó el correo.', 'sso_unverified')
        if (typeof payloadData.email !== 'string' || !payloadData.email) throw badRequest('Falta el correo en la respuesta.', 'sso_invalid')

        // Mapeo por identificador externo estable; el correo sólo vale la primera vez.
        let memberRow = null
        if (payloadData.external_id !== undefined && payloadData.external_id !== null && String(payloadData.external_id) !== '') {
          const externalValue = String(payloadData.external_id)
          const linkRow = get(db, "SELECT member_id FROM identity_links WHERE provider = 'sso' AND external_id = ?", externalValue)
          if (linkRow) memberRow = get(db, 'SELECT id, email, name, role FROM members WHERE id = ?', linkRow.member_id)
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
        return reply.redirect('/', 302)
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
