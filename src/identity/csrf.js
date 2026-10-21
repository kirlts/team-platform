// CSRF defense by `Sec-Fetch-Site` and `Origin` in an `onRequest` hook (MASTER-SPEC §7.7, report 04 §2.3).
// OWASP: SameSite alone is not enough. JavaScript cannot set Sec-Fetch-Site; browsers send it since 2023.
//
//   same-origin    whatever the browser marks as same origin passes (or `none`: direct navigation), plus the
//                  origins in CORS_ORIGINS if there are any.
//   cross-origin   the frontend lives on another origin: only an `Origin` listed in CORS_ORIGINS passes.
//
// In addition, an unsafe request that carries the session cookie must carry the `X-Team-Request` header (the panel
// sends `panel`): a form on another site cannot set it, and across origins it forces a CORS preflight.

import { forbidden } from '../domain/errors.js'
import { cookieSpec } from './cookies.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const REJECTION = 'Petición de otro sitio rechazada.'

export function csrfGuard (config) {
  const allowedSet = new Set(config.corsOrigins)
  const crossOrigin = config.identity.cookieMode === 'cross-origin'
  const cookieName = cookieSpec(config).name
  return async function csrf (request) {
    if (SAFE_METHODS.has(request.method)) return
    if (request.cookies?.[cookieName] && !request.headers['x-team-request']) {
      throw forbidden('Falta la cabecera X-Team-Request en una petición con sesión.', 'csrf')
    }
    const site = request.headers['sec-fetch-site']
    const originValue = request.headers.origin

    if (crossOrigin) {
      // The browser always sends Origin on an unsafe cross-origin request.
      if (originValue) {
        if (allowedSet.has(originValue)) return
        throw forbidden(REJECTION, 'csrf')
      }
      if (site === undefined || site === 'none') return // a client that is not a browser
      throw forbidden(REJECTION, 'csrf')
    }

    if (site === 'same-origin' || site === 'none') return
    if (originValue && allowedSet.has(originValue)) return
    if (site) throw forbidden(REJECTION, 'csrf')

    // Browsers without Sec-Fetch-Site: the origin is compared with the host.
    if (originValue) {
      let hostName = null
      try { hostName = new URL(originValue).host } catch { /* a «null» or opaque origin */ }
      if (hostName && hostName === request.headers.host) return
      throw forbidden(REJECTION, 'csrf')
    }
    // With neither header there is no browser involved (curl, an external system): there is no ambient
    // credential for a third party to exploit.
  }
}
