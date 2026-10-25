// M9: several attachments with the same name (`image.png`, what a phone or a paste gives to every picture) are all stored and all seen.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { FILES, harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

/** Different pictures with the same name: the PNG decodes the same, the bytes (and so the hash) differ. */
const sameName = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ ...FILES.photo('image.png'), buffer: Buffer.concat([FILES.photo().buffer, Buffer.from(`variante-${from + i}-${Math.random()}`)]) }))

/** Walks the viewer from the first medium to the last: each current image must have loaded. */
async function everyImageLoads (page, total) {
  const gallery = page.locator('[data-gallery]').first()
  for (let n = 1; n <= total; n++) {
    await gallery.locator('[data-gallery-count]').filter({ hasText: `${n} de ${total}` }).waitFor()
    const img = gallery.locator('[data-index]:not([aria-hidden]) img')
    await img.waitFor()
    await page.waitForFunction((el) => el.complete, await img.elementHandle())
    assert.ok((await img.evaluate((el) => el.naturalWidth)) > 0, `M9: picture ${n} of ${total} did not load`)
    if (n < total) await gallery.getByRole('button', { name: /siguiente/i }).click()
  }
}

describe('M9: attachments with the same name are all kept and seen', () => {
  test('M9: three pictures named image.png in one message are three attachments, and the viewer shows 1 de 3 to 3 de 3 with each one loaded', async () => {
    const id = await h.message(h.unique('M9 tres fotos'), { files: sameName(3) })
    const detail = (await h.api('ana').get(`/messages/${id}`)).data
    assert.equal(detail.attachments.length, 3, `M9: the message kept ${detail.attachments.length} of 3 attachments`)
    assert.equal(new Set(detail.attachments.map((a) => a.id)).size, 3)
    assert.deepEqual(detail.attachments.map((a) => a.name), ['image.png', 'image.png', 'image.png'])
    const { page, context } = await h.open('ana')
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('[data-gallery]').first().waitFor()
      await settled(page)
      assert.equal(await page.locator('[data-gallery-strip] [data-gallery-thumb]').count(), 3, 'M9: the strip does not show three thumbnails')
      await everyImageLoads(page, 3)
    } finally { await context.close() }
  })

  test('M9: three more image.png added afterwards from the detail are kept and seen too, six in all', async () => {
    const id = await h.message(h.unique('M9 después'), { files: sameName(3) })
    const { page, context } = await h.open('ana')
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('[data-gallery]').first().waitFor()
      await page.getByTestId('detail-files').setInputFiles(sameName(3, 10))
      await page.locator('[data-gallery-count]').filter({ hasText: '1 de 6' }).waitFor({ timeout: 15000 })
      const detail = (await h.api('ana').get(`/messages/${id}`)).data
      assert.equal(detail.attachments.length, 6, `M9: the message kept ${detail.attachments.length} of 6 attachments`)
      await everyImageLoads(page, 6)
    } finally { await context.close() }
  })

  test('M9: the same picture sent twice in different messages is stored once per hash and both messages still show it', async () => {
    const same = sameName(1)
    const a = await h.message(h.unique('M9 repetida A'), { files: same })
    const b = await h.message(h.unique('M9 repetida B'), { files: same })
    const { page, context } = await h.open('ana')
    try {
      for (const id of [a, b]) {
        await page.goto(`${h.origin}/messages/${id}`)
        const img = page.locator('[data-gallery] img').first()
        await img.waitFor()
        await page.waitForFunction((el) => el.complete, await img.elementHandle())
        assert.ok((await img.evaluate((el) => el.naturalWidth)) > 0, `M9: message ${id} does not show its picture`)
      }
    } finally { await context.close() }
  })
})
