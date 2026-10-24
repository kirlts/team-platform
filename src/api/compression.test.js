// Response compression: JSON, the mounted index.html and the host's theme leave compressed when the browser accepts it; the
// panel's own files leave as the build left them (.br and .gz next to each one); streams, small answers and media are not touched.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib'
import { makeEnv, tempDir } from '../testing/helpers.js'
import { negotiate } from './compression.js'

const BUNDLE = `console.log(${JSON.stringify('x'.repeat(5000))})`

function panelDist () {
  const dir = tempDir()
  mkdirSync(path.join(dir, 'assets'), { recursive: true })
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>Panel</title></head><body><div id="root"></div></body></html>')
  writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), BUNDLE)
  writeFileSync(path.join(dir, 'assets', 'app-abc123.js.br'), brotliCompressSync(Buffer.from(BUNDLE)))
  writeFileSync(path.join(dir, 'assets', 'app-abc123.js.gz'), gzipSync(Buffer.from(BUNDLE)))
  return dir
}

test('negotiate: Brotli first, gzip second, nothing for identity or for a refused coding', () => {
  assert.equal(negotiate('gzip, deflate, br, zstd'), 'br')
  assert.equal(negotiate('gzip'), 'gzip')
  assert.equal(negotiate('br;q=0, gzip;q=0.5'), 'gzip')
  assert.equal(negotiate('identity'), null)
  assert.equal(negotiate('*'), 'br')
  assert.equal(negotiate('br;q=0, gzip;q=0'), null)
  assert.equal(negotiate(undefined), null)
})

test('a large JSON answer is compressed with the coding the browser accepts and says it varies on it', async () => {
  const env = await makeEnv({ config: { panelDist: panelDist() } })
  try {
    const plain = await env.app.inject({ url: '/api/openapi.json' })
    assert.equal(plain.statusCode, 200)
    assert.equal(plain.headers['content-encoding'], undefined)
    assert.match(plain.headers.vary, /Accept-Encoding/i)
    for (const [coding, decode] of [['br', brotliDecompressSync], ['gzip', gunzipSync]]) {
      const r = await env.app.inject({ url: '/api/openapi.json', headers: { 'accept-encoding': coding } })
      assert.equal(r.headers['content-encoding'], coding)
      assert.equal(Number(r.headers['content-length']), r.rawPayload.length)
      assert.ok(r.rawPayload.length < plain.rawPayload.length / 3, `${coding}: ${r.rawPayload.length} of ${plain.rawPayload.length}`)
      assert.deepEqual(JSON.parse(decode(r.rawPayload).toString()), plain.json())
    }
  } finally { await env.close() }
})

test('an answer under the minimum is not compressed', async () => {
  const env = await makeEnv({ config: { panelDist: panelDist() } })
  try {
    const r = await env.app.inject({ url: '/api/health', headers: { 'accept-encoding': 'br, gzip' } })
    assert.equal(r.statusCode, 200)
    assert.ok(r.rawPayload.length < env.config.compression.minBytes)
    assert.equal(r.headers['content-encoding'], undefined)
  } finally { await env.close() }
})

test('the panel files leave precompressed, with the original type, and the compressed copies are not routes of their own', async () => {
  const env = await makeEnv({ config: { panelDist: panelDist() } })
  try {
    const br = await env.app.inject({ url: '/assets/app-abc123.js', headers: { 'accept-encoding': 'gzip, br' } })
    assert.equal(br.headers['content-encoding'], 'br')
    assert.match(br.headers['content-type'], /javascript/)
    assert.match(br.headers['cache-control'], /immutable/)
    assert.match(br.headers.vary, /Accept-Encoding/i)
    assert.equal(brotliDecompressSync(br.rawPayload).toString(), BUNDLE)
    const gz = await env.app.inject({ url: '/assets/app-abc123.js', headers: { 'accept-encoding': 'gzip' } })
    assert.equal(gz.headers['content-encoding'], 'gzip')
    assert.equal(gunzipSync(gz.rawPayload).toString(), BUNDLE)
    const plain = await env.app.inject({ url: '/assets/app-abc123.js' })
    assert.equal(plain.headers['content-encoding'], undefined)
    assert.equal(plain.body, BUNDLE)
    for (const url of ['/assets/app-abc123.js.br', '/assets/app-abc123.js.gz']) assert.equal((await env.app.inject({ url })).statusCode, 404, url)
  } finally { await env.close() }
})

test('the host theme is compressed and answers 304 while the file is the same', async () => {
  const themeDir = tempDir()
  const themeCss = path.join(themeDir, 'theme.css')
  writeFileSync(themeCss, `:root{${'--a:1;'.repeat(600)}}`)
  const env = await makeEnv({ config: { panelDist: panelDist(), themeCss } })
  try {
    const first = await env.app.inject({ url: '/theme.css', headers: { 'accept-encoding': 'br' } })
    assert.equal(first.headers['content-encoding'], 'br')
    assert.equal(first.headers['cache-control'], 'no-cache')
    assert.match(first.headers['content-type'], /text\/css/)
    assert.match(first.headers.etag, /^W\//)
    const again = await env.app.inject({ url: '/theme.css', headers: { 'accept-encoding': 'br', 'if-none-match': first.headers.etag } })
    assert.equal(again.statusCode, 304)
    assert.equal(again.rawPayload.length, 0)
    writeFileSync(themeCss, ':root{--a:2}')
    const changed = await env.app.inject({ url: '/theme.css', headers: { 'if-none-match': first.headers.etag } })
    assert.equal(changed.statusCode, 200)
    assert.equal(changed.body, ':root{--a:2}')
  } finally { await env.close() }
})
