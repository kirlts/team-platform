// The read-only guarantee of the capture tool, in one place. Two users, the same policy:
//   · the browser, by network interception of the context (`installGuard`);
//   · the calls from Node that set the session up (`guardedFetch`).
// A request leaves only if it is for the origin being looked at AND it is GET, HEAD or OPTIONS, or it is one of the POST paths the host listed.
// Everything else is cut before it leaves and written down.
//
// This guard is the second layer. The first one belongs to the host: the account the tool signs in with should be one the server itself
// refuses to let write. What this adds is cutting before leaving, writing down what was cut and denying foreign destinations.
// The host declares in its adapter (`guard`):
//   browserPosts  paths of POST the page may make (a POST that only sets a cookie, for instance);
//   blockedGets   paths of GET that are not pure reads (they return a secret, mark something as read, record an export). Cut although they are GET;
//   sessionPosts  paths of POST that only Node makes while setting the session up (login), by name.

const READ = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * @param {{ method: string, url: string, origin: string, browserPosts?: RegExp[], blockedGets?: RegExp[] }} request
 * @returns {{ ok: boolean, reason?: string }}
 */
export function evaluate ({ method, url, origin, browserPosts = [], blockedGets = [] }) {
  let u
  try { u = new URL(url) } catch { return { ok: false, reason: 'unreadable address' } }
  if (['data:', 'blob:', 'about:'].includes(u.protocol)) return { ok: true }
  if (u.origin !== origin) return { ok: false, reason: `other destination (${u.host})` }
  const m = method.toUpperCase()
  if (READ.has(m)) {
    if (blockedGets.some((r) => r.test(u.pathname))) return { ok: false, reason: 'GET with an effect or a secret (blockedGets)' }
    return { ok: true }
  }
  if (m === 'POST' && browserPosts.some((r) => r.test(u.pathname))) return { ok: true }
  return { ok: false, reason: `method ${m} not allowed` }
}

/** Installs the guard on a Playwright context. Returns the record of what was cut and of the writes that were allowed to pass. */
export async function installGuard (context, { origin, browserPosts = [], blockedGets = [] }) {
  const cut = []
  const passed = { writes: [] }
  await context.route('**/*', (route) => {
    const request = route.request()
    const verdict = evaluate({ method: request.method(), url: request.url(), origin, browserPosts, blockedGets })
    if (!verdict.ok) {
      cut.push({ method: request.method(), url: request.url(), reason: verdict.reason })
      return route.abort('blockedbyclient')
    }
    if (!READ.has(request.method().toUpperCase())) passed.writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
    return route.continue()
  })
  // An open channel can carry writes with no method: none is opened.
  await context.routeWebSocket(/.*/, (ws) => { cut.push({ method: 'WS', url: ws.url(), reason: 'websocket' }); ws.close() })
  return { cut, passed }
}

/** `fetch` from Node under the same policy. `permit` is the list of POST paths of this call. */
export async function guardedFetch (url, { method = 'GET', permit = [], origin, blockedGets = [], ...init }) {
  const verdict = evaluate({ method, url, origin, browserPosts: permit, blockedGets })
  if (!verdict.ok) throw new Error(`read-only guard: ${method} ${new URL(url).pathname} cut (${verdict.reason})`)
  return fetch(url, { method, ...init })
}
