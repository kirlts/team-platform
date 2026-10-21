// Session cookie (MASTER-SPEC §7.7). `__Host-` requires Secure, Path=/ and no Domain (report 04 §2.2).
//   same-origin    `__Host-session`, SameSite=Lax (panel and API share an origin).
//   cross-origin   `__Host-session`, SameSite=None; Secure, for a frontend on another origin (CORS_ORIGINS).
//   COOKIE_INSECURE_DEV  development over http only: no prefix and no Secure, SameSite=Lax.

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
