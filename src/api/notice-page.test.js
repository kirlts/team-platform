import assert from 'node:assert/strict'
import { test } from 'node:test'
import { noAccessPage, pickLanguage, ssoRejectedPage, THEME_SCRIPT, wantsHtml } from './notice-page.js'

const config = (hostSiteUrl = '') => ({ basePath: '/', panelDist: '/nonexistent', themeCss: '', identity: { hostSiteUrl } })
const request = (extra = {}) => ({ headers: {}, query: {}, ...extra })

test('wantsHtml: a navigation asks for HTML first; JSON or no Accept keeps the JSON answer', () => {
  assert.equal(wantsHtml({ headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' } }), true)
  assert.equal(wantsHtml({ headers: { accept: 'application/json, text/html' } }), false)
  assert.equal(wantsHtml({ headers: { accept: '*/*' } }), false)
  assert.equal(wantsHtml({ headers: {} }), false)
})

test('pickLanguage: English only when the browser prefers it', () => {
  assert.equal(pickLanguage({ headers: { 'accept-language': 'en-US,es;q=0.5' } }), 'en')
  assert.equal(pickLanguage({ headers: { 'accept-language': 'es-CL,en;q=0.5' } }), 'es')
  assert.equal(pickLanguage({ headers: {} }), 'es')
})

test('no access: one cause and one exit, with the retry going to the destination asked for', () => {
  const retry = noAccessPage(config(), request({ query: { next: '/messages' } }))
  assert.match(retry, /<a class="btn btn-gel[^"]*" href="\/messages">Reintentar<\/a>/)
  assert.match(retry, /La entrada a esta instalación es por el sitio del equipo<\/p>/)
  assert.doesNotMatch(retry, /cabecera/)
  const unsafe = noAccessPage(config(), request({ query: { next: '//evil.example' } }))
  assert.match(unsafe, /href="\/">Reintentar/)
  const site = noAccessPage(config('https://ejemplo.cl'), request({ headers: { 'accept-language': 'en' } }))
  assert.match(site, /href="https:\/\/ejemplo\.cl">Go to the team site<\/a>/)
})

test('sso rejected: a retry for an invalid answer, and no link for an email the host did not verify', () => {
  const invalid = ssoRejectedPage(config(), request(), 'sso_invalid', '/api/auth/sso/start')
  assert.match(invalid, /href="\/api\/auth\/sso\/start">Reintentar<\/a>/)
  const unverified = ssoRejectedPage(config(), request(), 'sso_unverified', '/api/auth/sso/start')
  assert.doesNotMatch(unverified, /<a /)
  assert.match(unverified, /Lo corrige quien administra el sitio del equipo/)
  assert.match(ssoRejectedPage(config(), request({ headers: { 'accept-language': 'en' } }), 'sso_unverified', '/e'), /Whoever administers the team site fixes it/)
})

test('theme script: reads the panel key and the system preference', () => {
  assert.match(THEME_SCRIPT, /team-theme/)
  assert.match(THEME_SCRIPT, /prefers-color-scheme: dark/)
})
