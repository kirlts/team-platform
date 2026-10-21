// H-57: checks that the event stream reaches a client through whatever proxy sits in front of the server.
//   TEAM_EMAIL=… TEAM_PASSWORD=… node scripts/check-sse.mjs https://host:port
// Logs in, opens GET /api/events and measures when the first comment (`: conectado`) and the first heartbeat
// arrive. A proxy that buffers delays both: the check fails when the first byte takes more than 2 s or the
// heartbeat does not arrive within the server's heartbeat interval plus 5 s (15 s by default, so 20 s).
const base = (process.argv[2] ?? '').replace(/\/$/, '')
const { TEAM_EMAIL: email, TEAM_PASSWORD: password } = process.env
const heartbeatSeconds = Number(process.env.TEAM_SSE_HEARTBEAT_SECONDS ?? 15)
if (!base || !email || !password) {
  console.error('usage: TEAM_EMAIL=… TEAM_PASSWORD=… node scripts/check-sse.mjs <base url>')
  process.exit(2)
}

const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
if (!login.ok) { console.error(`login failed: HTTP ${login.status}`); process.exit(2) }
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

const limitMs = (heartbeatSeconds + 5) * 1000
const abort = new AbortController()
const timer = setTimeout(() => abort.abort(), limitMs)
const started = Date.now()
const res = await fetch(`${base}/api/events`, { headers: { cookie }, signal: abort.signal })
console.log(`HTTP ${res.status} content-type=${res.headers.get('content-type')} x-accel-buffering=${res.headers.get('x-accel-buffering')}`)

let firstByteMs = null
let heartbeatMs = null
const decoder = new TextDecoder()
try {
  for await (const chunk of res.body) {
    const at = Date.now() - started
    const text = decoder.decode(chunk)
    console.log(`${(at / 1000).toFixed(1)} s  ${JSON.stringify(text)}`)
    firstByteMs ??= at
    if (text.includes('heartbeat')) { heartbeatMs = at; break }
  }
} catch (error) {
  if (error.name !== 'AbortError') throw error
}
clearTimeout(timer)
abort.abort()

const ok = firstByteMs !== null && firstByteMs <= 2000 && heartbeatMs !== null
console.log(ok ? `PASS first byte ${firstByteMs} ms, first heartbeat ${heartbeatMs} ms` : `FAIL first byte ${firstByteMs ?? 'never'} ms, heartbeat ${heartbeatMs ?? 'never'} ms`)
process.exit(ok ? 0 : 1)
