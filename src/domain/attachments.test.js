// The icon of a medium is only as right as its kind: each kind is classified from its declared type or, when the browser
// declares none, from its extension (J5-message-detail: a .wav drew the icon of a document).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classify } from './attachments.js'

const kind = (mime, name) => classify(mime, name)?.kind

test('each kind of medium is classified from its declared type', () => {
  assert.equal(kind('image/png', 'captura.png'), 'image')
  assert.equal(kind('video/webm', 'grabacion.webm'), 'video')
  assert.equal(kind('audio/wav', 'nota-de-voz.wav'), 'audio')
  assert.equal(kind('application/pdf', 'informe.pdf'), 'document')
})

test('an audio is audio under every name the browsers give a wav', () => {
  for (const mime of ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'audio/wav; codecs=1']) assert.equal(kind(mime, 'nota-de-voz.wav'), 'audio', mime)
})

test('a file declared without a type is classified by its extension, audio and video included', () => {
  for (const mime of ['', 'application/octet-stream']) {
    assert.equal(kind(mime, 'nota-de-voz.wav'), 'audio')
    assert.equal(kind(mime, 'voz.M4A'), 'audio')
    assert.equal(kind(mime, 'clip.mp4'), 'video')
    assert.equal(kind(mime, 'foto.jpg'), 'image')
    assert.equal(kind(mime, 'detalle.docx'), 'document')
  }
})

test('a format outside the table is refused', () => {
  assert.equal(classify('image/svg+xml', 'x.svg'), null)
  assert.equal(classify('application/octet-stream', 'x.exe'), null)
})
