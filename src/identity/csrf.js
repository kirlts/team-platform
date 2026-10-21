// Defensa CSRF por `Sec-Fetch-Site` y `Origin` en un gancho `onRequest` (MASTER-SPEC §7.7, informe 04 §2.3).
// OWASP: SameSite solo no basta. JavaScript no puede fijar Sec-Fetch-Site; llega en los navegadores desde 2023.
//
//   same-origin    pasa lo que el navegador marca como mismo origen (o `none`: navegación directa), más los
//                  orígenes de CORS_ORIGINS si los hay.
//   cross-origin   el frontend vive en otro origen: pasa sólo un `Origin` listado en CORS_ORIGINS.
//
// Además, una petición no segura que trae la cookie de sesión debe traer la cabecera `X-Team-Request` (el panel
// manda `panel`): un formulario de otro sitio no puede fijarla, y entre orígenes obliga a un preflight CORS.

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
      // El navegador siempre manda Origin en una petición no segura entre orígenes.
      if (originValue) {
        if (allowedSet.has(originValue)) return
        throw forbidden(REJECTION, 'csrf')
      }
      if (site === undefined || site === 'none') return // cliente que no es un navegador
      throw forbidden(REJECTION, 'csrf')
    }

    if (site === 'same-origin' || site === 'none') return
    if (originValue && allowedSet.has(originValue)) return
    if (site) throw forbidden(REJECTION, 'csrf')

    // Navegadores sin Sec-Fetch-Site: se compara el origen con el anfitrión.
    if (originValue) {
      let hostName = null
      try { hostName = new URL(originValue).host } catch { /* origen «null» u opaco */ }
      if (hostName && hostName === request.headers.host) return
      throw forbidden(REJECTION, 'csrf')
    }
    // Sin ninguno de los dos encabezados no hay navegador de por medio (curl, un sistema externo): no hay
    // credencial ambiente que un tercero pueda aprovechar.
  }
}
