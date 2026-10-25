// M10: attachments travel as binary, never as base64 inside the request, and no 20 MB cap stops a big file.
// NOTE: a «signed address straight to the store» does not exist in Team Platform (the direct upload to the bucket is the patient file of the host);
// this file asserts the part that belongs to this platform: the upload from the send bar is multipart binary, as large as the file, and uncapped at 20 MB.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { before, describe, test } from 'node:test'
import { FILES, harness } from './harness.mjs'

let h
before(async () => { h = await harness() })

const MIB = 1024 * 1024

/** Sends from the bar of Inicio the way a person does, and returns the request the browser made for the upload. */
async function sendFromBar (page, text, files) {
  await page.addInitScript(() => {
    window.__uploads = []
    const describe = (body) => (body instanceof FormData
      ? { kind: 'FormData', entries: [...body.entries()].map(([name, v]) => (typeof v === 'string' ? { name, length: v.length } : { name, file: true, size: v.size })) }
      : { kind: typeof body === 'string' ? 'string' : (body?.constructor?.name ?? typeof body), length: body?.length ?? body?.size })
    const send = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.send = function (body) { window.__uploads.push(describe(body)); return send.call(this, body) }
    const fetchNow = window.fetch
    window.fetch = (input, init) => { if (init?.body) window.__uploads.push(describe(init.body)); return fetchNow(input, init) }
  })
  await page.goto(h.origin)
  await page.getByTestId('compose-text').first().fill(text)
  await page.locator('input[type=file]:not([capture])').first().setInputFiles(files)
  const upload = page.waitForRequest((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/inputs', { timeout: 30000 })
  await page.getByTestId('compose-send').first().click()
  return upload
}

describe('M10: the upload is binary and uncapped at 20 MB', () => {
  test('M10: a photo of 3 MB leaves the bar as multipart binary of about its own size, with no base64', async () => {
    const photo = { ...FILES.photo('grande.png'), buffer: Buffer.concat([FILES.photo().buffer, Buffer.alloc(3 * MIB, 7)]) }
    const { page, context } = await h.open('ana')
    try {
      const title = h.unique('M10 foto')
      const request = await sendFromBar(page, title, [photo])
      const type = request.headers()['content-type'] ?? ''
      assert.match(type, /^multipart\/form-data/, `M10: the upload is ${type}, not multipart`)
      // Chromium does not hand a large streamed body to the test (size 0, no data): the page's own call is observed instead, and the file is compared where it landed.
      // The panel also posts small JSON bodies (usage telemetry): the upload is the largest body the page sent.
      const sent = await page.evaluate(() => [...window.__uploads].sort((a, b) => (b.entries?.reduce((n, e) => n + (e.size ?? e.length ?? 0), 0) ?? b.length ?? 0) - (a.entries?.reduce((n, e) => n + (e.size ?? e.length ?? 0), 0) ?? a.length ?? 0))[0])
      assert.equal(sent.kind, 'FormData', `M10: the page sends a ${sent.kind}, not a multipart form`)
      const file = sent.entries.find((e) => e.file)
      assert.equal(file?.size, photo.buffer.length, 'M10: the part of the file is not the file itself')
      assert.ok(sent.entries.every((e) => e.file || e.length < 1000), `M10: a text part is ${Math.max(...sent.entries.map((e) => e.length ?? 0))} characters long: the file travels as text`)
      await page.getByTestId('published-message').first().waitFor({ timeout: 30000 })
      const stored = h.row('SELECT a.size, a.sha256 FROM attachments a JOIN inputs i ON i.id = a.input_id WHERE i.text = ?', title)
      assert.equal(stored?.size, photo.buffer.length, 'M10: the stored file is not the bytes that were chosen')
      assert.equal(stored.sha256, createHash('sha256').update(photo.buffer).digest('hex'), 'M10: the stored file differs from the original')
    } finally { await context.close() }
  })

  test('M10: a video of 25 MB (more than the old 20 MB cap) is uploaded and stored whole', async () => {
    const big = { name: 'largo.webm', type: 'video/webm', buffer: Buffer.concat([FILES.video().buffer, Buffer.alloc(25 * MIB, 3)]) }
    const { page, context } = await h.open('ana')
    try {
      const title = h.unique('M10 video')
      const request = await sendFromBar(page, title, [big])
      assert.match(request.headers()['content-type'] ?? '', /^multipart\/form-data/)
      const published = page.getByTestId('published-message').first()
      await published.waitFor({ timeout: 30000 })
      const row = h.row("SELECT a.size, a.kind FROM attachments a JOIN inputs i ON i.id = a.input_id WHERE i.text = ?", title)
      assert.ok(row, 'M10: the 25 MB file was not stored (the upload was refused)')
      assert.equal(row.size, big.buffer.length, `M10: stored ${row?.size} of ${big.buffer.length} bytes`)
    } finally { await context.close() }
  })
})
