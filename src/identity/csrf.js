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

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])
const RECHAZO = 'Petición de otro sitio rechazada.'

export function csrfGuard (config) {
  const permitidos = new Set(config.corsOrigins)
  const cruzado = config.identity.cookieMode === 'cross-origin'
  const nombreCookie = cookieSpec(config).name
  return async function csrf (request) {
    if (SEGUROS.has(request.method)) return
    if (request.cookies?.[nombreCookie] && !request.headers['x-team-request']) {
      throw forbidden('Falta la cabecera X-Team-Request en una petición con sesión.', 'csrf')
    }
    const sitio = request.headers['sec-fetch-site']
    const origen = request.headers.origin

    if (cruzado) {
      // El navegador siempre manda Origin en una petición no segura entre orígenes.
      if (origen) {
        if (permitidos.has(origen)) return
        throw forbidden(RECHAZO, 'csrf')
      }
      if (sitio === undefined || sitio === 'none') return // cliente que no es un navegador
      throw forbidden(RECHAZO, 'csrf')
    }

    if (sitio === 'same-origin' || sitio === 'none') return
    if (origen && permitidos.has(origen)) return
    if (sitio) throw forbidden(RECHAZO, 'csrf')

    // Navegadores sin Sec-Fetch-Site: se compara el origen con el anfitrión.
    if (origen) {
      let anfitrion = null
      try { anfitrion = new URL(origen).host } catch { /* origen «null» u opaco */ }
      if (anfitrion && anfitrion === request.headers.host) return
      throw forbidden(RECHAZO, 'csrf')
    }
    // Sin ninguno de los dos encabezados no hay navegador de por medio (curl, un sistema externo): no hay
    // credencial ambiente que un tercero pueda aprovechar.
  }
}
