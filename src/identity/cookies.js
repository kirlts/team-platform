// Session cookie (MASTER-SPEC §7.7). `__Host-` requires Secure, Path=/ and no Domain (report 04 §2.2).
//   same-origin    `__Host-session`, SameSite=Lax (panel and API share an origin).
//   cross-origin   `__Host-session`, SameSite=None; Secure, for a frontend on another origin (CORS_ORIGINS).
//   COOKIE_DOMAIN  shared with the host site (H-3720): `Domain=<value>`, so no `__Host-` prefix; the name is
//                  COOKIE_NAME (`team_session`), Secure, HttpOnly, SameSite=Lax (None with cross-origin).
//   COOKIE_INSECURE_DEV  development over http only: no prefix and no Secure, SameSite=Lax.

export function cookieSpec (config) {
  const maxAge = config.identity.session.absoluteHours * 3600
  const sameSite = config.identity.cookieMode === 'cross-origin' ? 'none' : 'lax'
  const secure = !config.identity.cookieInsecureDev
  if (config.identity.cookieDomain) {
    return { name: config.identity.cookieName, options: { path: '/', domain: config.identity.cookieDomain, httpOnly: true, secure, sameSite: secure ? sameSite : 'lax', maxAge } }
  }
  if (!secure) {
    return { name: 'session', options: { path: '/', httpOnly: true, secure: false, sameSite: 'lax', maxAge } }
  }
  return { name: '__Host-session', options: { path: '/', httpOnly: true, secure: true, sameSite, maxAge } }
}

/** `maxAgeSeconds` overrides the absolute lifetime, for a session that ends when the host's token does. */
export function setSessionCookie (reply, config, token, maxAgeSeconds = null) {
  const { name, options } = cookieSpec(config)
  reply.setCookie(name, token, maxAgeSeconds === null ? options : { ...options, maxAge: Math.max(0, Math.floor(maxAgeSeconds)) })
}

export function clearSessionCookie (reply, config) {
  const { name, options } = cookieSpec(config)
  const { maxAge, ...noExpiry } = options
  reply.clearCookie(name, noExpiry)
}

export function readSessionCookie (request, config) {
  return request.cookies?.[cookieSpec(config).name] ?? null
}
