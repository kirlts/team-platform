// What compressing costs and saves, per payload: size and time of gzip and Brotli at several levels, over the answers of a local
// server seeded by bench/seed-panel-speed.mjs, the built bundle and the host's theme. Time is the mean of 5 runs of the same call.
//   node bench/compression-cost.mjs --base http://127.0.0.1:3900 --dev-login bench@example.org --theme /path/theme.css > bench/results/2026-10-24-compression.json
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []))
const BASE = args.base ?? 'http://127.0.0.1:3900'
const here = dirname(fileURLToPath(import.meta.url))
const login = await fetch(`${BASE}/api/auth/dev-login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-team-request': 'panel' }, body: JSON.stringify({ email: args['dev-login'] }) })
const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

const payloads = {}
for (const p of ['/api/inputs?mine=1&order=desc', '/api/inputs?mine=1&order=desc&compact=1', '/api/messages?for=me', '/api/messages/summary', '/api/areas', '/api/me']) {
  payloads[p] = Buffer.from(await (await fetch(BASE + p, { headers: { cookie } })).text())
}
const assets = resolve(here, '../panel/dist/assets')
payloads['bundle.js'] = readFileSync(resolve(assets, readdirSync(assets).find((f) => /\.js$/.test(f))))
if (args.theme) payloads['theme.css'] = readFileSync(args.theme)

const variants = {
  gzip1: (b) => gzipSync(b, { level: 1 }), gzip6: (b) => gzipSync(b, { level: 6 }),
  br1: (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 1 } }),
  br4: (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }),
  br5: (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }),
  br11: (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
}
const out = { when: new Date().toISOString(), node: process.version, payloads: {} }
for (const [name, body] of Object.entries(payloads)) {
  const row = { bytes: body.length }
  for (const [v, f] of Object.entries(variants)) {
    const t = process.hrtime.bigint()
    let r
    for (let i = 0; i < 5; i++) r = f(body)
    row[v] = { bytes: r.length, ms: Number((Number(process.hrtime.bigint() - t) / 5e6).toFixed(2)) }
  }
  out.payloads[name] = row
}
console.log(JSON.stringify(out, null, 1))
