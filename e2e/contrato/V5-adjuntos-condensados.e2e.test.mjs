// V5: the attachments of the view, as drawn on 2026-10-25 (17:12): a condensed viewer, a footer that is one line, no «Abrir en otra pestaña», and adding is a
// square «+» at the end of the strip of thumbnails (not a text button «Adjunto» below it).
// The height of the viewer is derived from the drawing: the photo area is about a quarter of the window (235 of 944 px in the drawing), so it must not pass 30 % of the window.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness } from './harness.mjs'
import { box, openDetail, richMessage, VIEWPORTS } from './v-support.mjs'

let h
before(async () => { h = await harness() })

describe('V5: the attachments are condensed', () => {
  for (const viewport of VIEWPORTS) {
    describe(`at ${viewport.width} px`, () => {
      let id
      before(async () => { id = await richMessage(h, h.unique('V5 adjuntos')) })

      test('V5: the viewer is condensed: it takes at most 30 % of the window height', async () => {
        const { page, context } = await openDetail(h, 'ana', id, viewport)
        try {
          const viewer = await box(page.locator('[data-gallery-viewer]'))
          assert.ok(viewer.height <= viewport.height * 0.3, `V5: the viewer is ${Math.round(viewer.height)} px high, more than 30 % of ${viewport.height} px`)
        } finally { await context.close() }
      })

      test('V5: the footer of the viewer is one line: kind, name, size and «1 de 5»', async () => {
        const { page, context } = await openDetail(h, 'ana', id, viewport)
        try {
          const caption = page.locator('[data-gallery-caption]')
          const facts = await caption.evaluate((el) => {
            const lines = new Set([...el.children].map((c) => Math.round(c.getBoundingClientRect().y)))
            return { height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight) || 16, lines: lines.size, text: el.innerText }
          })
          assert.ok(facts.lines === 1 && facts.height < facts.lineHeight * 1.6, `V5: the footer is on ${facts.lines} lines (${Math.round(facts.height)} px): «${facts.text.replace(/\s+/g, ' ')}»`)
          assert.match(facts.text, /Foto/)
          assert.match(facts.text, /1 de 5/)
        } finally { await context.close() }
      })

      test('V5: there is no «Abrir en otra pestaña» in the view, for a photo and for a document', async () => {
        const { page, context } = await openDetail(h, 'ana', id, viewport)
        try {
          for (const n of [0, 4]) {
            await page.locator('[data-gallery-strip] [data-gallery-thumb] button').nth(n).click()
            await page.locator('[data-gallery-count]').filter({ hasText: new RegExp(`^${n + 1} de `) }).waitFor()
            const gallery = page.locator('[data-gallery]').first()
            assert.equal(await gallery.getByText(/otra pesta/i).count(), 0, `V5: «Abrir en otra pestaña» is drawn on attachment ${n + 1}`)
            // The row under the viewer is the footer of the drawing: it carries the name, the size, «Quitar» and the download, never a link to another tab.
            assert.equal(await page.locator('[data-gallery-caption]').locator('xpath=..').locator('a[target="_blank"]').count(), 0, `V5: the footer of attachment ${n + 1} has a link that opens another tab`)
          }
        } finally { await context.close() }
      })

      test('V5: adding is a «+» square at the end of the strip, as large as a thumbnail, and no «Adjunto» button below it', async () => {
        const { page, context } = await openDetail(h, 'ana', id, viewport)
        try {
          const strip = page.locator('[data-gallery-strip]')
          const add = strip.locator('[data-gallery-add]')
          assert.equal(await add.count(), 1, 'V5: there is no «+» tile in the strip')
          const last = await strip.evaluate((el) => el.lastElementChild.querySelector('[data-gallery-add]') !== null)
          assert.ok(last, 'V5: the «+» is not the last tile of the strip')
          assert.equal((await add.innerText()).trim(), '', 'V5: the «+» tile carries text; it is an icon with an accessible name')
          const [tile, thumb] = [await box(add), await box(page.locator('[data-gallery-thumb] button').first())]
          assert.ok(Math.abs(tile.width - tile.height) <= 4, `V5: the «+» is not a square (${Math.round(tile.width)} x ${Math.round(tile.height)})`)
          assert.ok(Math.abs(tile.height - thumb.height) <= 8, `V5: the «+» (${Math.round(tile.height)} px) is not as large as a thumbnail (${Math.round(thumb.height)} px)`)
          assert.equal(await page.getByRole('button', { name: /^\+?\s*Adjunto$/ }).count(), 0, 'V5: the text button «+ Adjunto» is still drawn')
        } finally { await context.close() }
      })
    })
  }
})
