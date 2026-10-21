// Cookie de sesión (MASTER-SPEC §7.7). `__Host-` obliga a Secure, Path=/ y sin Domain (informe 04 §2.2).
// Modo iframe: SameSite=None; Secure; Partitioned (CHIPS). Modo insecure-dev: sin prefijo ni Secure, sólo
// para desarrollo por http en navegadores que no tratan localhost como contexto seguro.

export function cookieSpec (config) {
  const modo = config.identity.cookieMode
  const maxAge = config.identity.session.absoluteHours * 3600
  if (modo === 'insecure-dev') {
    return { name: 'session', options: { path: '/', httpOnly: true, secure: false, sameSite: 'lax', maxAge } }
  }
  if (modo === 'iframe') {
    return { name: '__Host-session', options: { path: '/', httpOnly: true, secure: true, sameSite: 'none', partitioned: true, maxAge } }
  }
  return { name: '__Host-session', options: { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge } }
}

export function setSessionCookie (reply, config, token) {
  const { name, options } = cookieSpec(config)
  reply.setCookie(name, token, options)
}

export function clearSessionCookie (reply, config) {
  const { name, options } = cookieSpec(config)
  const { maxAge, ...sinVencimiento } = options
  reply.clearCookie(name, sinVencimiento)
}

export function readSessionCookie (request, config) {
  return request.cookies?.[cookieSpec(config).name] ?? null
}
