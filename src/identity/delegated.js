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

function buscarMiembro (db, email) {
  return get(db, 'SELECT id, email, name, role FROM members WHERE email = ?', email)
}

function comoIdentidad (miembro) {
  return { member_id: miembro.id, role: miembro.role, email: miembro.email, name: miembro.name }
}

/** UD-007: la identidad delegada sin fila en `members` recibe 403, nunca un alta automática. */
function exigirMiembro (db, email) {
  const miembro = buscarMiembro(db, email)
  if (!miembro) throw forbidden('La cuenta no está registrada en el equipo. Un editor debe agregarla.', 'member_not_registered')
  return miembro
}

const igualesSeguro = (a, b) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function firmarCabecera (secreto, { ts, method, pathname, email, bind }) {
  const mensaje = bind ? `${ts}.${method}.${pathname}.${email}` : `${ts}.${email}`
  return createHmac('sha256', secreto).update(mensaje).digest('hex')
}

function modoSignedHeader ({ db, config, now }) {
  const d = config.identity.delegated
  return {
    identify (request) {
      const email = request.headers['x-team-user']
      const ts = request.headers['x-team-ts']
      const firma = request.headers['x-team-sig']
      if (!email || !ts || !firma) return null
      const segundos = Number(ts)
      if (!Number.isFinite(segundos) || Math.abs(now() / 1000 - segundos) > d.tsToleranceSeconds) return null
      const pathname = request.raw.url.split('?')[0]
      const valida = d.secrets.some((secreto) =>
        igualesSeguro(firmarCabecera(secreto, { ts, method: request.method, pathname, email, bind: d.bindRequest }), String(firma)))
      return valida ? comoIdentidad(exigirMiembro(db, email)) : null
    }
  }
}

function modoJwt ({ db, config }) {
  const j = config.identity.delegated.jwt
  const algoritmos = j.algorithms.length > 0 ? j.algorithms : [j.jwksUrl ? 'RS256' : 'HS256']
  // createRemoteJWKSet vuelve a pedir las llaves cuando llega un `kid` desconocido (rotación de llaves).
  const clave = j.jwksUrl ? createRemoteJWKSet(new URL(j.jwksUrl), { cooldownDuration: j.jwksCooldownMs }) : new TextEncoder().encode(j.secret)
  return {
    async identify (request) {
      let ficha = request.headers[j.header]
      if (!ficha) return null
      if (j.header === 'authorization') {
        if (!/^Bearer\s+/i.test(ficha)) return null
        ficha = ficha.replace(/^Bearer\s+/i, '')
      }
      let payload
      try {
        ({ payload } = await jwtVerify(ficha, clave, { issuer: j.issuer, audience: j.audience, algorithms: algoritmos }))
      } catch (error) {
        if (error instanceof joseErrors.JOSEError) return null
        throw error
      }
      const email = payload[j.emailClaim]
      if (typeof email !== 'string' || email === '') return null
      return comoIdentidad(exigirMiembro(db, email))
    }
  }
}

function modoTrustedHeader ({ db, config }) {
  const d = config.identity.delegated
  const lista = new BlockList()
  for (const entrada of config.trustedProxies) {
    const [direccion, prefijo] = entrada.split('/')
    const familia = isIPv6(direccion) ? 'ipv6' : isIPv4(direccion) ? 'ipv4' : null
    if (!familia) throw new Error(`TRUSTED_PROXIES: «${entrada}» no es una IP ni un CIDR.`)
    if (prefijo === undefined) lista.addAddress(direccion, familia)
    else lista.addSubnet(direccion, Number(prefijo), familia)
  }
  return {
    identify (request) {
      const valor = request.headers[d.trustedHeaderName]
      if (!valor) return null
      const origen = request.socket?.remoteAddress
      if (!origen) return null
      const normal = origen.startsWith('::ffff:') ? origen.slice(7) : origen
      const familia = isIPv6(normal) ? 'ipv6' : 'ipv4'
      // Sin esto, cualquiera que alcance el puerto fijaría la cabecera a mano (informe 04 §3.1).
      if (!lista.check(normal, familia)) return null
      return comoIdentidad(exigirMiembro(db, String(valor)))
    }
  }
}

const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const firmaHex = (secreto, texto) => createHmac('sha256', secreto).update(texto).digest('hex')

function modoSso ({ db, config, sessions, now }) {
  const d = config.identity.delegated.sso
  const spec = cookieSpec(config)
  const nombreNonce = spec.name === '__Host-session' ? '__Host-sso' : 'sso-nonce'
  const vidaMs = d.nonceMinutes * 60 * 1000

  return {
    // La sesión es la misma que la del proveedor local.
    identify (request) {
      const miembro = sessions.lookup(readSessionCookie(request, config))
      return miembro ? { member_id: miembro.id, role: miembro.role, email: miembro.email, name: miembro.name } : null
    },
    routes (app) {
      // 1. Salida: nonce de uso único atado al navegador por una cookie corta.
      app.get('/auth/sso/start', { config: { public: true } }, async (request, reply) => {
        const nonce = randomBytes(24).toString('base64url')
        run(db, 'INSERT INTO sso_nonces (nonce, created_at) VALUES (?, ?)', nonce, now())
        const retorno = `${config.publicUrl.replace(/\/$/, '')}${config.apiPrefix}/auth/sso/callback`
        const sso = base64url({ nonce, return_sso_url: retorno })
        const destino = new URL(d.loginUrl)
        destino.searchParams.set('sso', sso)
        destino.searchParams.set('sig', firmaHex(d.secret, sso))
        reply.setCookie(nombreNonce, nonce, { ...spec.options, maxAge: Math.floor(vidaMs / 1000), sameSite: 'lax' })
        return reply.redirect(destino.toString(), 302)
      })

      // 2. Retorno: firma, nonce vigente y atado al navegador, correo verificado por el anfitrión.
      app.get('/auth/sso/callback', { config: { public: true } }, async (request, reply) => {
        const { sso, sig } = request.query
        if (typeof sso !== 'string' || typeof sig !== 'string' || !igualesSeguro(firmaHex(d.secret, sso), sig)) {
          throw forbidden('La respuesta del inicio de sesión no es válida.', 'sso_invalid')
        }
        let carga
        try { carga = JSON.parse(Buffer.from(sso, 'base64url').toString('utf8')) } catch { throw badRequest('La respuesta del inicio de sesión no se pudo leer.', 'sso_invalid') }
        const cookieNonce = request.cookies?.[nombreNonce]
        if (!carga.nonce || !cookieNonce || !igualesSeguro(String(carga.nonce), cookieNonce)) {
          throw forbidden('La respuesta no corresponde a este navegador.', 'sso_invalid')
        }
        // Uso único: se consume dentro de una transacción para que dos retornos simultáneos no pasen ambos.
        const consumido = tx(db, () => {
          const fila = get(db, 'SELECT created_at, used_at FROM sso_nonces WHERE nonce = ?', carga.nonce)
          if (!fila || fila.used_at !== null || fila.created_at + vidaMs < now()) return false
          run(db, 'UPDATE sso_nonces SET used_at = ? WHERE nonce = ?', now(), carga.nonce)
          return true
        })
        reply.clearCookie(nombreNonce, { path: '/', httpOnly: true, secure: spec.options.secure, sameSite: 'lax' })
        if (!consumido) throw forbidden('La respuesta del inicio de sesión venció o ya se usó.', 'sso_invalid')
        // DiscourseConnect: sin correo verificado por el anfitrión, la cuenta queda expuesta a ser tomada.
        if (carga.email_verified !== true) throw forbidden('El anfitrión no verificó el correo.', 'sso_unverified')
        if (typeof carga.email !== 'string' || !carga.email) throw badRequest('Falta el correo en la respuesta.', 'sso_invalid')

        // Mapeo por identificador externo estable; el correo sólo vale la primera vez.
        let miembro = null
        if (carga.external_id !== undefined && carga.external_id !== null && String(carga.external_id) !== '') {
          const externo = String(carga.external_id)
          const vinculo = get(db, "SELECT member_id FROM identity_links WHERE provider = 'sso' AND external_id = ?", externo)
          if (vinculo) miembro = get(db, 'SELECT id, email, name, role FROM members WHERE id = ?', vinculo.member_id)
          else {
            miembro = exigirMiembro(db, carga.email)
            run(db, "INSERT INTO identity_links (provider, external_id, member_id, created_at) VALUES ('sso', ?, ?, ?)", externo, miembro.id, now())
          }
        } else {
          miembro = exigirMiembro(db, carga.email)
        }
        const previo = readSessionCookie(request, config)
        if (previo) sessions.destroy(previo)
        setSessionCookie(reply, config, sessions.create(miembro.id).token)
        return reply.redirect('/', 302)
      })

      app.post('/auth/logout', { config: { public: true } }, async (request, reply) => {
        sessions.destroy(readSessionCookie(request, config))
        clearSessionCookie(reply, config)
        return reply.code(204).send()
      })
    }
  }
}

export function createDelegatedProvider (deps) {
  const modo = deps.config.identity.delegated.mode
  const fabricas = {
    'signed-header': modoSignedHeader,
    jwt: modoJwt,
    'sso-redirect': modoSso,
    'trusted-header': modoTrustedHeader
  }
  const implementacion = fabricas[modo]({ ...deps, now: deps.now ?? Date.now })
  return { name: `delegated:${modo}`, identify: implementacion.identify, routes: implementacion.routes ?? (() => {}) }
}
