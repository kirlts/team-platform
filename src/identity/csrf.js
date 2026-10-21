// Defensa CSRF por `Sec-Fetch-Site` y `Origin` en un gancho `onRequest` (MASTER-SPEC §7.7, informe 04 §2.3).
// OWASP: SameSite solo no basta. JavaScript no puede fijar Sec-Fetch-Site; llega en los navegadores desde 2023.

import { forbidden } from '../domain/errors.js'

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function csrfGuard (config) {
  const permitidos = new Set(config.allowedOrigins)
  return async function csrf (request) {
    if (SEGUROS.has(request.method)) return
    const sitio = request.headers['sec-fetch-site']
    const origen = request.headers.origin

    if (sitio === 'same-origin' || sitio === 'none') return
    if (origen && permitidos.has(origen)) return
    if (sitio) throw forbidden('Petición de otro sitio rechazada.', 'csrf')

    // Navegadores sin Sec-Fetch-Site: se compara el origen con el anfitrión.
    if (origen) {
      let anfitrion = null
      try { anfitrion = new URL(origen).host } catch { /* origen «null» u opaco */ }
      if (anfitrion && anfitrion === request.headers.host) return
      throw forbidden('Petición de otro sitio rechazada.', 'csrf')
    }
    // Sin ninguno de los dos encabezados no hay navegador de por medio (curl, un sistema externo): no hay
    // credencial ambiente que un tercero pueda aprovechar.
  }
}
