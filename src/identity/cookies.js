// Cookie de sesión (MASTER-SPEC §7.7). `__Host-` obliga a Secure, Path=/ y sin Domain (informe 04 §2.2).
//   same-origin    `__Host-session`, SameSite=Lax (panel y API comparten origen).
//   cross-origin   `__Host-session`, SameSite=None; Secure, para un frontend en otro origen (CORS_ORIGINS).
//   COOKIE_INSECURE_DEV  sólo desarrollo por http: sin prefijo ni Secure, SameSite=Lax.

export function cookieSpec (config) {
  const maxAge = config.identity.session.absoluteHours * 3600
  if (config.identity.cookieInsecureDev) {
    return { name: 'session', options: { path: '/', httpOnly: true, secure: false, sameSite: 'lax', maxAge } }
  }
  const sameSite = config.identity.cookieMode === 'cross-origin' ? 'none' : 'lax'
  return { name: '__Host-session', options: { path: '/', httpOnly: true, secure: true, sameSite, maxAge } }
}

export function setSessionCookie (reply, config, token) {
  const { name, options } = cookieSpec(config)
  reply.setCookie(name, token, options)
}

export function clearSessionCookie (reply, config) {
  const { name, options } = cookieSpec(config)
  const { maxAge, ...noExpiry } = options
  reply.clearCookie(name, noExpiry)
}

export function readSessionCookie (request, config) {
  return request.cookies?.[cookieSpec(config).name] ?? null
}
