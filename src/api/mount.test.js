// H-3721: the panel and the API mounted under a path of another site. Two instances under /team-a/ and /team-b/ of
// one host serve their static panel, their SPA and their API under their own base and never answer the other's paths;
// /health stays at the root; the CSP, the SSO return and the host's theme are configurable.

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { loadConfig } from '../config.js'
import { addMember, makeEnv, tempDir, TEST_PASSWORD } from '../testing/helpers.js'
import { mountedIndex } from './mount.js'

const INDEX = '<!doctype html><html><head><meta charset="UTF-8" /><title>Panel</title><script type="module" crossorigin src="./assets/app-abc123.js"></script><link rel="stylesheet" crossorigin href="./assets/app-abc123.css"></head><body><div id="root"></div></body></html>'

function panelDist () {
  const dir = tempDir()
  mkdirSync(path.join(dir, 'assets'), { recursive: true })
  writeFileSync(path.join(dir, 'index.html'), INDEX)
  writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)')
  writeFileSync(path.join(dir, 'assets', 'app-abc123.css'), 'body{}')
  return dir
}

const mounted = (name, extra = {}) => makeEnv({ config: { panelDist: panelDist(), basePath: `/${name}/`, apiPrefix: `/${name}/api`, ...extra } })

test('two instances under /team-a/ and /team-b/ serve static files, SPA and API under their own base only', async () => {
  const a = await mounted('team-a')
  const b = await mounted('team-b')
  try {
    for (const [env, name, other] of [[a, 'team-a', 'team-b'], [b, 'team-b', 'team-a']]) {
      const get = (url) => env.app.inject({ url })
      // The SPA, at the base with and without its slash and at a deep route, carries its mount point.
      for (const url of [`/${name}/`, `/${name}`, `/${name}/messages/12`, `/${name}/index.html`]) {
        const r = await get(url)
        assert.equal(r.statusCode, 200, url)
        assert.equal(r.headers['cache-control'], 'no-cache', url)
        assert.match(r.body, new RegExp(`<meta name="team-base-path" content="/${name}/" />`), url)
        assert.match(r.body, new RegExp(`<meta name="team-api-base" content="/${name}/api" />`), url)
        assert.match(r.body, new RegExp(`src="/${name}/assets/app-abc123.js"`), url)
        assert.match(r.body, new RegExp(`href="/${name}/assets/app-abc123.css"`), url)
      }
      const asset = await get(`/${name}/assets/app-abc123.js`)
      assert.equal(asset.statusCode, 200)
      assert.match(asset.headers['cache-control'], /immutable/)
      assert.equal((await get(`/${name}/assets/otro.js`)).json().code, 'not_found') // a missing asset is a real 404
      // Nothing of the other instance nor of the host root.
      for (const url of ['/', '/messages', '/assets/app-abc123.js', `/${other}/`, `/${other}/assets/app-abc123.js`, '/api/me', `/${other}/api/me`]) {
        assert.equal((await get(url)).statusCode, 404, url)
      }
      // The API under its prefix, /health also at the root for the container probe, the contract under the prefix.
      assert.equal((await get(`/${name}/api/health`)).statusCode, 200)
      assert.equal((await get('/health')).statusCode, 200)
      const contract = await get(`/${name}/api/openapi.json`)
      assert.equal(contract.statusCode, 200)
      const paths = Object.keys(contract.json().paths)
      assert.ok(paths.includes(`/${name}/api/events`))
      assert.ok(paths.includes(`/${name}/api/attachments/{id}`), paths.filter((p) => p.includes('attach')).join(', '))
      assert.ok(paths.every((p) => p.startsWith(`/${name}/api/`)), 'every documented route lives under the prefix')
      assert.equal((await get(`/${name}/api/no-existe`)).headers['content-type'], 'application/json; charset=utf-8')
      // Sign-in and a call with the session, under the prefix.
      await addMember(env, { email: 'ana@x.org' })
      const login = await env.app.inject({ method: 'POST', url: `/${name}/api/auth/login`, payload: { email: 'ana@x.org', password: TEST_PASSWORD } })
      assert.equal(login.statusCode, 200, login.body)
      const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
      assert.equal((await env.app.inject({ url: `/${name}/api/me`, headers: { cookie } })).json().email, 'ana@x.org')
    }
  } finally {
    await a.close()
    await b.close()
  }
})

test('the CSP keeps its defaults and takes the host origins of CSP_CONNECT_SRC and FRAME_ANCESTORS', async () => {
  const plain = await makeEnv()
  const host = await makeEnv({ config: { cspConnectSrc: ['https://consola.example', 'wss://consola.example'], frameAncestors: 'https://consola.example' } })
  try {
    const before = (await plain.app.inject({ url: '/api/health' })).headers['content-security-policy']
    assert.match(before, /connect-src 'self';/)
    assert.match(before, /frame-ancestors 'none'/)
    const after = (await host.app.inject({ url: '/api/health' })).headers['content-security-policy']
    assert.match(after, /connect-src 'self' https:\/\/consola\.example wss:\/\/consola\.example;/)
    assert.match(after, /frame-ancestors https:\/\/consola\.example/)
  } finally {
    await plain.close()
    await host.close()
  }
  const env = loadConfig({ DATA_DIR: tempDir(), CSP_CONNECT_SRC: 'https://a.example, https://b.example', FRAME_ANCESTORS: 'https://a.example' })
  assert.deepEqual(env.cspConnectSrc, ['https://a.example', 'https://b.example'])
  assert.equal(env.frameAncestors, 'https://a.example')
})

test('BASE_PATH and SSO_RETURN_PATH are read and checked; the defaults are the root', () => {
  const dir = tempDir()
  const base = (value) => loadConfig({ DATA_DIR: dir, BASE_PATH: value }).basePath
  assert.equal(base(''), '/')
  assert.equal(base('/'), '/')
  assert.equal(base('team'), '/team/')
  assert.equal(base('/team'), '/team/')
  assert.equal(base('/team/b/'), '/team/b/')
  assert.throws(() => base('/te am/'), /BASE_PATH/)
  assert.throws(() => base('/a?b'), /BASE_PATH/)
  assert.equal(loadConfig({ DATA_DIR: dir }).ssoReturnPath, '/')
  assert.equal(loadConfig({ DATA_DIR: dir, SSO_RETURN_PATH: '/team/' }).ssoReturnPath, '/team/')
  assert.throws(() => loadConfig({ DATA_DIR: dir, SSO_RETURN_PATH: '//otro.example/' }), /SSO_RETURN_PATH/)
  assert.throws(() => loadConfig({ DATA_DIR: dir, SSO_RETURN_PATH: 'https://otro.example/' }), /SSO_RETURN_PATH/)
})

test('the SSO return lands on SSO_RETURN_PATH', async () => {
  const secret = 'secreto-sso'
  const env = await makeEnv({
    config: { ssoReturnPath: '/team/', publicUrl: 'https://team.example', identity: { provider: 'delegated', delegated: { mode: 'sso-redirect', sso: { loginUrl: 'https://anfitrion.example/sso', secret } } } }
  })
  try {
    await addMember(env, { email: 'ana@x.org' })
    const start = await env.app.inject({ url: '/api/auth/sso/start' })
    const nonce = JSON.parse(Buffer.from(new URL(start.headers.location).searchParams.get('sso'), 'base64url').toString()).nonce
    const cookie = start.cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const sso = Buffer.from(JSON.stringify({ nonce, email: 'ana@x.org', external_id: 'u-1', email_verified: true })).toString('base64url')
    const sig = createHmac('sha256', secret).update(sso).digest('hex')
    const back = await env.app.inject({ url: `/api/auth/sso/callback?sso=${sso}&sig=${sig}`, headers: { cookie } })
    assert.equal(back.statusCode, 302)
    assert.equal(back.headers.location, '/team/')
  } finally {
    await env.close()
  }
})

test('THEME_CSS: served under the base as theme.css and linked after the panel stylesheet; without it nothing changes', async () => {
  const dir = tempDir()
  const theme = path.join(dir, 'anfitrion.css')
  writeFileSync(theme, ':root { --accent: #0a7d55; }')
  const withTheme = await mounted('team', { themeCss: theme })
  const without = await mounted('team')
  try {
    const css = await withTheme.app.inject({ url: '/team/theme.css' })
    assert.equal(css.statusCode, 200)
    assert.match(css.headers['content-type'], /^text\/css/)
    assert.equal(css.body, ':root { --accent: #0a7d55; }')
    const html = (await withTheme.app.inject({ url: '/team/' })).body
    const panelSheet = html.indexOf('href="/team/assets/app-abc123.css"')
    const hostSheet = html.indexOf('<link rel="stylesheet" href="/team/theme.css" />')
    assert.ok(panelSheet > 0 && hostSheet > panelSheet, 'the host theme comes after the panel stylesheet')
    assert.doesNotMatch((await without.app.inject({ url: '/team/theme.css' })).headers['content-type'], /text\/css/) // no theme route
    assert.doesNotMatch((await without.app.inject({ url: '/team/' })).body, /theme\.css/)
  } finally {
    await withTheme.close()
    await without.close()
  }
  assert.equal(loadConfig({ DATA_DIR: dir, THEME_CSS: theme }).themeCss, theme)
  assert.throws(() => loadConfig({ DATA_DIR: dir, THEME_CSS: path.join(dir, 'no-existe.css') }), /THEME_CSS/)
})

test('mountedIndex at the root leaves the panel as it was built, plus its two meta tags', () => {
  const html = mountedIndex(INDEX, { basePath: '/', apiPrefix: '/api' })
  assert.match(html, /src="\/assets\/app-abc123\.js"/)
  assert.match(html, /<meta name="team-base-path" content="\/" \/><meta name="team-api-base" content="\/api" \/><\/head>/)
  assert.match(mountedIndex(INDEX, { basePath: '/"x/', apiPrefix: '/api' }), /content="\/&quot;x\/"/) // attribute escaped
})
