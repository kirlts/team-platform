import assert from 'node:assert/strict'
import { test } from 'node:test'
import { noAccessPage, pickLanguage, ssoRejectedPage, wantsHtml } from './notice-page.js'

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

test('pages: one line without final period, the message is escaped and the link is the entry', () => {
  const trusted = noAccessPage('es', { trustedHeader: true })
  assert.match(trusted, /Falta la cabecera del anfitrión o llega de una dirección no confiable<\/p>/)
  assert.doesNotMatch(trusted, /<a /)
  assert.match(noAccessPage('en', { trustedHeader: false }), /A valid host session is missing<\/p>/)
  const rejected = ssoRejectedPage('es', 'sso_invalid', 'Venció <b>.', '/api/auth/sso/start')
  assert.match(rejected, /<p>Venció &lt;b&gt;<\/p>/)
  assert.match(rejected, /<a href="\/api\/auth\/sso\/start">Ir a la entrada<\/a>/)
  assert.match(ssoRejectedPage('en', 'sso_unverified', 'x', '/e'), /did not verify the email/)
})
