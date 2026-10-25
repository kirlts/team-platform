// V3: photos, videos, audios and PDFs are seen in the view of a message, and each attachment downloads.
// Real files, small, that a browser decodes (e2e/contrato/fixtures). «Se ve» is measured on the element, not read from the markup:
// a photo has naturalWidth > 0, a video has data and its clock advances, an audio plays and its clock advances, a PDF has a preview, a download hands over the same bytes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, describe, test } from 'node:test'
import { FILES, harness, settled } from './harness.mjs'
import { openDetail, photo } from './v-support.mjs'

let h
before(async () => { h = await harness() })

const strip = (page) => page.locator('[data-gallery-strip] [data-gallery-thumb] button')
const slide = (page, index) => page.locator(`[data-gallery-viewer] [data-index="${index}"]`)

async function select (page, index) {
  await strip(page).nth(index).click()
  await page.locator('[data-gallery-count]').filter({ hasText: new RegExp(`^${index + 1} de `) }).waitFor()
}

describe('V3: attachments are seen and downloaded', () => {
  test('V3: every photo shows (naturalWidth > 0), in the viewer and in its thumbnail', async () => {
    const id = await h.message(h.unique('V3 fotos'), { files: [photo(1), photo(2), photo(3)] })
    const { page, context } = await openDetail(h, 'ana', id, { width: 1440, height: 900 })
    try {
      for (let n = 0; n < 3; n++) {
        await select(page, n)
        const img = slide(page, n).locator('img')
        await img.waitFor()
        await page.waitForFunction((el) => el.complete, await img.elementHandle())
        assert.ok((await img.evaluate((el) => el.naturalWidth)) > 0, `V3: photo ${n + 1} of 3 did not load in the viewer`)
      }
      const thumbs = await page.locator('[data-gallery-strip] img').evaluateAll((els) => els.map((el) => ({ w: el.naturalWidth, done: el.complete })))
      assert.equal(thumbs.length, 3)
      for (const [n, t] of thumbs.entries()) assert.ok(t.done && t.w > 0, `V3: thumbnail ${n + 1} did not load`)
    } finally { await context.close() }
  })

  test('V3: the video plays: it has data (readyState >= 2) and its clock advances after play', async () => {
    const id = await h.message(h.unique('V3 video'), { files: [FILES.video()] })
    const { page, context } = await openDetail(h, 'ana', id, { width: 1440, height: 900 })
    try {
      const video = slide(page, 0).locator('video')
      await video.waitFor()
      await page.waitForFunction((el) => el.readyState >= 2 || el.error, await video.elementHandle(), { timeout: 15000 })
      const before = await video.evaluate((el) => ({ ready: el.readyState, error: el.error?.message ?? null, duration: el.duration, w: el.videoWidth }))
      assert.equal(before.error, null, `V3: the video failed to load: ${before.error}`)
      assert.ok(before.ready >= 2, `V3: the video has no data (readyState ${before.ready})`)
      assert.ok(before.w > 0, 'V3: the video has no picture (videoWidth 0)')
      await video.evaluate((el) => el.play())
      await page.waitForFunction((el) => el.currentTime > 0.3 && !el.paused, await video.elementHandle(), { timeout: 10000 })
      const after = await video.evaluate((el) => ({ t: el.currentTime, paused: el.paused }))
      assert.ok(after.t > 0.3 && !after.paused, `V3: the video clock did not advance (currentTime ${after.t}, paused ${after.paused})`)
    } finally { await context.close() }
  })

  test('V3: the audio plays with the player of the view: its clock advances after pressing play', async () => {
    const id = await h.message(h.unique('V3 audio'), { files: [FILES.audio()] })
    const { page, context } = await openDetail(h, 'ana', id, { width: 1440, height: 900 })
    try {
      const audio = slide(page, 0).locator('audio')
      await audio.waitFor({ state: 'attached' })
      await page.waitForFunction((el) => el.readyState >= 1 || el.error, await audio.elementHandle(), { timeout: 15000 })
      assert.equal(await audio.evaluate((el) => el.error?.message ?? null), null, 'V3: the audio failed to load')
      await slide(page, 0).getByRole('button', { name: /^Reproducir/ }).click()
      await page.waitForFunction((el) => el.currentTime > 0.3 && !el.paused, await audio.elementHandle(), { timeout: 10000 })
      const state = await audio.evaluate((el) => ({ t: el.currentTime, paused: el.paused, ready: el.readyState }))
      assert.ok(state.ready >= 2 && state.t > 0.3 && !state.paused, `V3: the audio did not play (readyState ${state.ready}, currentTime ${state.t}, paused ${state.paused})`)
    } finally { await context.close() }
  })

  test('V3: the PDF is previewed in the view: its first page is drawn, not only its name and a link', async () => {
    const id = await h.message(h.unique('V3 pdf'), { files: [FILES.pdf()] })
    const { page, context } = await openDetail(h, 'ana', id, { width: 1440, height: 900 })
    try {
      const preview = await slide(page, 0).evaluate((el) => {
        const frame = el.querySelector('iframe, embed, object')
        const picture = el.querySelector('img, canvas')
        return {
          frame: frame ? { tag: frame.tagName.toLowerCase(), src: frame.getAttribute('src') ?? frame.getAttribute('data') } : null,
          picture: picture ? { tag: picture.tagName.toLowerCase(), width: picture.naturalWidth ?? picture.width, done: picture.complete ?? true } : null,
          text: el.innerText
        }
      })
      assert.ok(preview.frame || preview.picture, `V3: the PDF slide has no preview (no iframe, embed, object, image or canvas); it only says: «${preview.text.replace(/\s+/g, ' ').trim()}»`)
      if (preview.picture) assert.ok(preview.picture.done && preview.picture.width > 0, 'V3: the preview image of the PDF did not load')
      if (preview.frame) {
        // A frame shows a PDF only if the server lets it be framed: the file is served with a policy that must not forbid it.
        const res = await page.request.get(`${h.origin}${preview.frame.src}`)
        const policy = res.headers()['content-security-policy'] ?? ''
        assert.ok(!/sandbox|default-src 'none'/.test(policy) && !/deny/i.test(res.headers()['x-frame-options'] ?? ''), `V3: the PDF is framed but the server forbids it (content-security-policy: ${policy})`)
      }
    } finally { await context.close() }
  })

  test('V3: every attachment downloads with its own name and its own bytes (photo, video, audio, PDF)', async () => {
    const files = [FILES.photo(), FILES.video(), FILES.audio(), FILES.pdf()]
    const id = await h.message(h.unique('V3 descargas'), { files })
    const { page, context } = await openDetail(h, 'ana', id, { width: 1440, height: 900 })
    try {
      for (const [n, file] of files.entries()) {
        await select(page, n)
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 15000 }),
          page.locator('[data-gallery-caption]').locator('xpath=..').getByRole('link', { name: /descargar/i }).or(page.locator('[data-gallery-caption]').locator('xpath=..').getByRole('button', { name: /descargar/i })).first().click()
        ])
        assert.equal(download.suggestedFilename(), file.name, `V3: the download of attachment ${n + 1} lost its name`)
        const saved = readFileSync(await download.path())
        assert.ok(saved.equals(file.buffer), `V3: the downloaded ${file.name} is not the file that was attached (${saved.length} bytes of ${file.buffer.length})`)
      }
    } finally { await context.close() }
  })

  test('V3: the attachments of a reply (photo, audio, PDF) also show and download', async () => {
    const id = await h.message(h.unique('V3 respuesta'), { as: 'bruno', recipients: ['ana'] })
    const form = new FormData()
    form.append('body', 'Con adjuntos')
    form.append('kind', 'answer')
    for (const f of [photo(9, 'resp.png'), FILES.audio(), FILES.pdf()]) form.append('files', new Blob([f.buffer], { type: f.type }), f.name)
    const sent = await h.api('ana').postForm(`/messages/${id}/replies`, form)
    assert.equal(sent.status, 201, JSON.stringify(sent.data))
    const { page, context } = await openDetail(h, 'bruno', id, { width: 1440, height: 900 }, { gallery: false })
    try {
      const thread = page.locator('section[aria-label="Respuestas"]')
      await thread.waitFor()
      const img = thread.locator('img').first()
      await img.waitFor()
      await page.waitForFunction((el) => el.complete, await img.elementHandle())
      assert.ok((await img.evaluate((el) => el.naturalWidth)) > 0, 'V3: the photo of the reply did not load')
      assert.ok((await thread.locator('audio').count()) >= 1 || (await thread.getByText('audio.wav').count()) >= 1, 'V3: the audio of the reply is not in the thread')
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        thread.getByRole('link', { name: /descargar.*documento\.pdf/i }).or(thread.getByRole('button', { name: /descargar.*documento\.pdf/i })).first().click()
      ])
      assert.equal(download.suggestedFilename(), 'documento.pdf')
      assert.ok(readFileSync(await download.path()).equals(FILES.pdf().buffer), 'V3: the PDF downloaded from the reply is not the one attached')
    } finally { await context.close() }
  })
})
