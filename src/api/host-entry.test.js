// UD-308: with a host governing identity, a missing, expired or invalid session goes to the host's entry (page and API);
// the form of our own exists only without a host.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { makeEnv, tempDir } from '../testing/helpers.js'

const panelDir = () => {
  const dir = tempDir()
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>Panel</title></head><body><div id="root"></div></body></html>')
  return dir
}
const hostConfig = (extra = {}) => ({
  config: {
    panelDist: panelDir(),
    identity: {
      provider: 'jwt',
      provision: 'host',
      ...extra,
      delegated: { mode: 'jwt', secrets: [], jwt: { jwksUrl: 'http://127.0.0.1:1/jwks.json', jwksCooldownMs: 0, issuer: 'https://anfitrion.example', audience: 'team-platform' } }
    }
  }
})
const expired = { cookie: '__Host-session=vencida; team_session=vencida' }

test('host configured, expired cookie: the page redirects to HOST_LOGIN_URL with the destination, and the API 401 names it', async () => {
  const env = await makeEnv(hostConfig())
  const page = await env.app.inject({ url: '/mensajes/12?x=1', headers: expired })
  assert.equal(page.statusCode, 302)
  assert.equal(page.headers.location, `/session/login?next=${encodeURIComponent('/mensajes/12?x=1')}`)
  const noCookie = await env.app.inject({ url: '/' })
  assert.equal(noCookie.statusCode, 302)
  const api = await env.app.inject({ url: '/api/me', headers: expired })
  assert.equal(api.statusCode, 401)
  assert.equal(api.json().login_url, '/session/login')
  await env.close()
})

test('host configured with HOST_LOGIN_URL of its own: both answers use it', async () => {
  const env = await makeEnv(hostConfig({ hostLoginUrl: 'https://anfitrion.example/entrar' }))
  const page = await env.app.inject({ url: '/', headers: expired })
  assert.match(page.headers.location, /^https:\/\/anfitrion\.example\/entrar\?next=/)
  assert.equal((await env.app.inject({ url: '/api/me', headers: expired })).json().login_url, 'https://anfitrion.example/entrar')
  await env.close()
})

test('no host: the page is the panel with its own form and the 401 names no entry', async () => {
  const env = await makeEnv({ config: { panelDist: panelDir() } })
  const page = await env.app.inject({ url: '/', headers: expired })
  assert.equal(page.statusCode, 200)
  assert.match(page.body, /<title>Panel/)
  const api = await env.app.inject({ url: '/api/me', headers: expired })
  assert.equal(api.statusCode, 401)
  assert.equal(api.json().login_url, undefined)
  await env.close()
})

test('the request that arrives at the entry address is the installation itself: a 401 page, never a redirect to itself', async () => {
  const env = await makeEnv(hostConfig())
  const direct = await env.app.inject({ url: '/session/login?next=%2F', headers: { 'accept-language': 'en' } })
  assert.equal(direct.statusCode, 401)
  assert.match(direct.headers['content-type'], /text\/html/)
  assert.match(direct.body, /<h2[^>]*>No access<\/h2>/)
  assert.match(direct.body, /entered through the team site/)
  assert.equal(direct.headers.location, undefined)
  const other = await env.app.inject({ url: '/session/login-otro' })
  assert.equal(other.statusCode, 302)
  await env.close()
})
