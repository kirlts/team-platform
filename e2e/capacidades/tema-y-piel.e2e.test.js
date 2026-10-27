// Capability «Tema y piel del anfitrión» (docs/CAPACIDADES-1.0.md): the panel mounts under the path of another site and takes color, typography and radius from a
// `THEME_CSS` sheet without recompiling. Judged through the real server over the compiled panel, without a browser: the people of the team work under the host's path
// (login, send, read the message), the page they get links the host sheet after the panel's own, the sheet is served as the file is on the disk at that moment,
// and every token that the sheet redefines is one the compiled panel declares for the light and the dark theme. (What the browser draws with the sheet is the
// judgement of panel/src/theme.browser.test.mjs.)
import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { addMember, makeEnv, multipart, tempDir, until } from '../../src/testing/helpers.js'
import { compilarPanel } from './apoyo.mjs'

let panelDist
before(async () => { panelDist = await compilarPanel() })
after(() => rmSync(panelDist, { recursive: true, force: true }))

// The tokens the sheet below redefines, one of each family of the contract (MASTER-SPEC 7.8): color per theme, typography, radius, finish.
const COLOR_TOKENS = ['--color-bg', '--color-surface', '--color-fg', '--color-accent', '--color-accent-fg', '--color-danger']
const ROOT_TOKENS = ['--font-sans', '--font-display', '--radius-sm', '--radius-md', '--radius-lg', '--btn-gloss', '--card-edge-width']
const sheet = (accent) => `/* Hoja del anfitrión */
@font-face { font-family: 'Letra del anfitrión'; src: url(theme/letra.woff2) format('woff2'); }
:root { --font-sans: 'Letra del anfitrión', sans-serif; --font-display: 'Letra del anfitrión', sans-serif; --radius-sm: 2px; --radius-md: 3px; --radius-lg: 4px; --btn-gloss: none; --card-edge-width: 0px; }
:root[data-theme='light'] { --color-bg: #fafaf7; --color-surface: #ffffff; --color-fg: #1f2a24; --color-accent: ${accent}; --color-accent-fg: #ffffff; --color-danger: #b3261e; }
:root[data-theme='dark'] { --color-bg: #101512; --color-surface: #18201b; --color-fg: #e8efe9; --color-accent: ${accent}; --color-accent-fg: #06130c; --color-danger: #f2b8b5; }
`

test('mounted under the path of a host, with its sheet: the team works there and the sheet reaches the panel as the file is on the disk', async () => {
  const dir = tempDir()
  const themeFile = path.join(dir, 'anfitrion.css')
  writeFileSync(themeFile, sheet('#0a7d55'))
  writeFileSync(path.join(dir, 'letra.woff2'), Buffer.from('wOF2-de-prueba'))
  writeFileSync(path.join(dir, 'secreto.env'), 'CLAVE=1')
  const env = await makeEnv({ worker: true, config: { panelDist, basePath: '/equipo/', apiPrefix: '/equipo/api', themeCss: themeFile, identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  const get = (url, headers = {}) => env.app.inject({ url, headers })

  // The team works under the path of the host: login, send, publish and read, all under /equipo/api.
  const loginRes = await env.app.inject({ method: 'POST', url: '/equipo/api/auth/login', payload: { email: 'ana@x.org', password: 'una clave larga de prueba 1' } })
  assert.equal(loginRes.statusCode, 200, loginRes.body)
  const cookie = `${loginRes.cookies[0].name}=${loginRes.cookies[0].value}`
  const sent = await enviarComoBajoRuta(env, cookie)
  assert.equal((await get(`/equipo/api/messages/${sent}`, { cookie })).json().id, sent)
  assert.equal((await get(`/api/messages/${sent}`, { cookie })).statusCode, 404, 'the API also answers at the root of the host')

  // The page: the panel's sheet first, then the host's, under the base; every asset it names is served.
  const page = await get('/equipo/messages')
  assert.equal(page.statusCode, 200)
  const panelCss = /<link rel="stylesheet"[^>]* href="(\/equipo\/assets\/[^"]+\.css)"/.exec(page.body)?.[1]
  assert.ok(panelCss, 'the page does not link the stylesheet of the panel under the base')
  assert.ok(page.body.indexOf('href="/equipo/theme.css"') > page.body.indexOf(panelCss), 'the host sheet must come after the sheet of the panel')
  assert.match(page.body, /<meta name="team-base-path" content="\/equipo\/" \/>/)
  const compiled = await get(panelCss)
  assert.equal(compiled.statusCode, 200)

  // The tokens: the compiled panel declares each one the sheet redefines, and it switches on the same selectors the sheet uses for the light and the dark theme.
  const css = compiled.body
  for (const token of [...COLOR_TOKENS, ...ROOT_TOKENS]) assert.ok(css.includes(`${token}:`), `${token} is not declared by the panel, so a sheet could not govern it`)
  for (const theme of ['light', 'dark']) assert.ok(new RegExp(`:root\\[data-theme=["']?${theme}["']?\\]`).test(css), `the panel has no selector for the ${theme} theme`)
  // Light, dark or the system's: the script of the panel sets the theme on the root element and follows the system preference.
  const script = /<script[^>]* src="(\/equipo\/assets\/[^"]+\.js)"/.exec(page.body)?.[1]
  assert.ok(script, 'the page does not load the script of the panel under the base')
  const code = (await get(script)).body
  assert.ok(code.includes('(prefers-color-scheme: dark)') && code.includes('dataset.theme') && code.includes('team-theme'), 'the panel has no way to follow the system theme')

  // The sheet: served as the file is, with its validator; it follows the file with no restart; the fonts next to it are served and nothing else.
  const served = await get('/equipo/theme.css')
  assert.equal(served.statusCode, 200)
  assert.match(served.headers['content-type'], /^text\/css/)
  assert.equal(served.headers['cache-control'], 'no-cache')
  assert.equal(served.body, readFileSync(themeFile, 'utf8'))
  assert.equal((await get('/equipo/theme.css', { 'if-none-match': served.headers.etag })).statusCode, 304)
  writeFileSync(themeFile, sheet('#c2410c'))
  const changed = await get('/equipo/theme.css', { 'if-none-match': served.headers.etag })
  assert.equal(changed.statusCode, 200)
  assert.match(changed.body, /#c2410c/)
  assert.notEqual(changed.headers.etag, served.headers.etag)
  assert.equal((await get('/equipo/theme/letra.woff2')).statusCode, 200)
  assert.equal((await get('/equipo/theme/secreto.env')).statusCode, 404)
  assert.equal((await get('/equipo/theme/..%2Fsecreto.env')).statusCode, 404)
  assert.equal((await get('/theme.css')).headers['content-type']?.startsWith('text/css'), false, 'the sheet is also served outside the base of the host')
  // The page lets the fonts of the sheet in: the CSP admits fonts of the same origin only.
  assert.match(page.headers['content-security-policy'], /font-src 'self'/)
  await env.close()
})

test('without THEME_CSS the page names no host sheet and serves none, and with the file missing the server does not start', async () => {
  const env = await makeEnv({ config: { panelDist, basePath: '/equipo/', apiPrefix: '/equipo/api' } })
  assert.doesNotMatch((await env.app.inject({ url: '/equipo/' })).body, /theme\.css/)
  assert.notEqual((await env.app.inject({ url: '/equipo/theme.css' })).headers['content-type']?.split(';')[0], 'text/css')
  await env.close()
  const { loadConfig } = await import('../../src/config.js')
  assert.throws(() => loadConfig({ DATA_DIR: tempDir(), THEME_CSS: '/no/existe/tema.css' }), /THEME_CSS/)
})

/** A send under the host's path, as the panel does it: input, analysis by the worker, publication. */
async function enviarComoBajoRuta (env, cookie) {
  const headers = { cookie, 'x-team-request': 'panel' }
  const { payload, headers: type } = await multipart({ text: 'quiero cambiar el color del botón principal' }, [])
  const sent = await env.app.inject({ method: 'POST', url: '/equipo/api/inputs', payload, headers: { ...type, ...headers } })
  assert.equal(sent.statusCode, 202, sent.body)
  const inputId = sent.json().input_id
  const view = await until(async () => {
    const v = (await env.app.inject({ url: `/equipo/api/inputs/${inputId}`, headers })).json()
    return v.status === 'proposed' ? v : null
  }, { timeoutMs: 15000 })
  const published = await env.app.inject({ method: 'POST', url: `/equipo/api/inputs/${inputId}/publish`, headers, payload: { messages: view.proposal.messages } })
  assert.equal(published.statusCode, 200, published.body)
  return published.json().message_ids[0]
}
