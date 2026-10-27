// The read-only policy without a browser: the decision (`evaluate`), the Node side (`guardedFetch`) and the browser side with a context that records what
// it is asked (`installGuard`). The proof with a real browser, that a write does not reach a server, is in look.chromium.test.mjs.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { describe, it } from 'node:test'
import { evaluate, guardedFetch, installGuard } from './guard.js'

const origin = 'https://app.example'
const policy = { origin, browserPosts: [/^\/auth\/files$/], blockedGets: [/\/password$/, /\/export(\/|$)/] }
const ok = (method, url) => evaluate({ method, url, ...policy }).ok

describe('evaluate', () => {
  it('lets reads of the origin pass and cuts every other method', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) assert.equal(ok(m, `${origin}/orders`), true, m)
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(ok(m, `${origin}/orders`), false, m)
  })
  it('cuts another destination, including a different port or scheme of the same host', () => {
    assert.equal(ok('GET', 'https://example.org/'), false)
    assert.equal(ok('GET', 'http://app.example/orders'), false)
    assert.equal(ok('GET', 'https://app.example:8443/orders'), false)
  })
  it('lets data, blob and about pass', () => {
    for (const url of ['data:text/plain,hi', 'blob:https://app.example/x', 'about:blank']) assert.equal(ok('GET', url), true, url)
  })
  it('lets a POST pass only on the paths the host listed, and normalizes the path first', () => {
    assert.equal(ok('POST', `${origin}/auth/files`), true)
    assert.equal(ok('DELETE', `${origin}/auth/files`), false)
    assert.equal(ok('POST', `${origin}/other/../orders`), false)
    assert.equal(ok('POST', `${origin}/auth/files/../orders`), false, 'a path with ../ is read as the server will read it')
  })
  it('cuts the GET that is not a pure read (a secret, a mark of read, an export)', () => {
    assert.equal(ok('GET', `${origin}/users/1/password`), false)
    assert.equal(ok('GET', `${origin}/patients/9/export`), false)
    assert.equal(ok('GET', `${origin}/patients/9`), true)
  })
  it('cuts an address it cannot read', () => assert.equal(ok('GET', 'not a url'), false))
})

describe('guardedFetch', () => {
  it('throws before opening the connection for a POST outside the list', async () => {
    await assert.rejects(guardedFetch(`${origin}/orders`, { method: 'POST', origin, body: '{}' }), /read-only guard: POST \/orders cut/)
  })
  it('sends a listed POST and a GET to the origin', async () => {
    const seen = []
    const server = createServer((req, res) => { seen.push(`${req.method} ${req.url}`); res.end('ok') })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const local = `http://127.0.0.1:${server.address().port}`
    try {
      assert.equal((await guardedFetch(`${local}/login`, { method: 'POST', origin: local, permit: [/^\/login$/], body: '{}' })).status, 200)
      assert.equal((await guardedFetch(`${local}/orders`, { origin: local })).status, 200)
      await assert.rejects(guardedFetch(`${local}/orders`, { method: 'DELETE', origin: local, permit: [/^\/login$/] }), /read-only guard/)
    } finally { server.close() }
    assert.deepEqual(seen, ['POST /login', 'GET /orders'])
  })
})

describe('installGuard', () => {
  it('aborts what the policy cuts, continues what it lets pass, records both, and closes every websocket', async () => {
    let handler; let socketHandler
    const context = { route: async (_pattern, h) => { handler = h }, routeWebSocket: async (_pattern, h) => { socketHandler = h } }
    const { cut, passed } = await installGuard(context, policy)
    const request = (method, url) => { const result = { aborted: null, continued: false }; handler({ request: () => ({ method: () => method, url: () => url }), abort: (reason) => { result.aborted = reason }, continue: () => { result.continued = true } }); return result }
    assert.deepEqual(request('GET', `${origin}/orders`), { aborted: null, continued: true })
    assert.deepEqual(request('POST', `${origin}/orders`), { aborted: 'blockedbyclient', continued: false })
    assert.deepEqual(request('POST', `${origin}/auth/files`), { aborted: null, continued: true })
    assert.deepEqual(request('GET', 'https://example.org/'), { aborted: 'blockedbyclient', continued: false })
    assert.deepEqual(cut.map((c) => `${c.method} ${new URL(c.url).pathname}`), ['POST /orders', 'GET /'])
    assert.deepEqual(passed.writes, ['POST /auth/files'])
    let closed = false
    socketHandler({ url: () => 'wss://app.example/live', close: () => { closed = true } })
    assert.equal(closed, true)
    assert.equal(cut.at(-1).method, 'WS')
  })
})
