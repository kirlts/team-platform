// V4: the header of the view of a message, as Martín drew it on 2026-10-25 (17:12, drawing 17.png): Reenviar and Borrar and the counter of replies
// next to the title, compact badges for area and state, no «IA» badge, recipients on one line when they fit.
// Geometry, not pictures: positions and sizes measured on the page at 1440 and 1920 px.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness } from './harness.mjs'
import { box, openDetail, richMessage, VIEWPORTS } from './v-support.mjs'

let h
before(async () => { h = await harness() })

describe('V4: the header of the message follows the drawing', () => {
  for (const viewport of VIEWPORTS) {
    describe(`at ${viewport.width} px`, () => {
      let id
      before(async () => { id = await richMessage(h, h.unique('V4 cabecera'), { recipients: ['claude', 'carla'] }) })

      test('V4: Reenviar and Borrar sit together in the header, on the right', async () => {
        const { page, context } = await openDetail(h, 'ana', id, viewport)
        try {
          const forward = await box(page.getByRole('button', { name: 'Reenviar' }))
          const del = await box(page.getByRole('button', { name: 'Borrar' }))
          const title = await box(page.locator('main h1'))
          const recipients = await box(page.getByRole('button', { name: /destinatario/i }))
          const content = await box(page.locator('[data-lane="message-column"]'))
          const thread = await box(page.locator('section[aria-label="Respuestas"]'))
          assert.ok(forward && del && recipients && title, 'V4: Reenviar, Borrar, the recipients row or the title is not drawn')
          const mid = (b) => b.y + b.height / 2
          assert.ok(Math.abs(mid(forward) - mid(del)) <= 4, `V4: Reenviar and Borrar are not on one row (${Math.round(mid(forward))} and ${Math.round(mid(del))})`)
          assert.ok(forward.x < del.x, 'V4: Reenviar must come before Borrar')
          assert.ok(del.x + del.width >= thread.x + thread.width - 24, `V4: Borrar is not at the right edge of the content (ends at ${Math.round(del.x + del.width)}, the content ends at ${Math.round(thread.x + thread.width)})`)
          // The header is everything above the first attachment: the buttons are in it, not below the description.
          assert.ok(mid(del) < recipients.y + recipients.height + 12, 'V4: the actions are below the recipients row, outside the header')
          assert.ok(del.y < content.y, 'V4: the actions are inside the column of the message instead of the header')
        } finally { await context.close() }
      })

      test('V4: the counter of replies is next to the title, in the title row', async () => {
        const { page, context } = await openDetail(h, 'ana', id, viewport)
        try {
          const title = await box(page.locator('main h1'))
          const counter = page.locator('main').getByText(/^Respuestas$/i).first()
          const counterBox = await box(counter.locator('xpath=..'))
          assert.ok(counterBox, 'V4: there is no «Respuestas» counter')
          const mid = counterBox.y + counterBox.height / 2
          assert.ok(mid >= title.y - 8 && mid <= title.y + title.height + 8, `V4: the counter of replies is not in the title row: it is at y ${Math.round(mid)} and the title spans ${Math.round(title.y)} to ${Math.round(title.y + title.height)}`)
          assert.ok(counterBox.x > title.x, 'V4: the counter must be to the right of the title start')
        } finally { await context.close() }
      })

      test('V4: area and state are compact and share one line with who and when', async () => {
        const { page, context } = await openDetail(h, 'ana', id, viewport)
        try {
          const row = page.locator('[data-lane="message-column"] > div').first()
          const parts = await row.locator(':scope > *').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { text: el.innerText.trim().slice(0, 24), y: r.y + r.height / 2, h: r.height } }))
          assert.ok(parts.length >= 4, `V4: expected area, state, author and time in the row, found ${parts.length}`)
          const ys = parts.map((p) => p.y)
          assert.ok(Math.max(...ys) - Math.min(...ys) <= 6, `V4: area, state, author and time wrap onto more than one line: ${JSON.stringify(parts.map((p) => [p.text, Math.round(p.y)]))}`)
          for (const p of parts) assert.ok(p.h <= 28, `V4: «${p.text}» is ${Math.round(p.h)} px high; the badges of the header are compact (28 px at most)`)
        } finally { await context.close() }
      })

      test('V4: there is no «IA» badge in the view', async () => {
        const { page, context } = await openDetail(h, 'ana', id, viewport)
        try {
          const marks = await page.locator('main').getByText('IA', { exact: true }).count()
          assert.equal(marks, 0, `V4: ${marks} «IA» badge(s) are still drawn`)
        } finally { await context.close() }
      })

      test('V4: «para», the recipients and «Destinatario» share one line when they fit', async () => {
        const { page, context } = await openDetail(h, 'ana', id, viewport)
        try {
          const items = await page.locator('[data-lane="message-column"]').evaluate((lane) => {
            const list = [...lane.querySelectorAll('ul')].find((u) => [...u.querySelectorAll('button')].some((b) => /Destinatario/.test(b.textContent ?? '')))
            if (!list) return { found: false }
            const ys = [...list.children].map((e) => { const r = e.getBoundingClientRect(); return r.y + r.height / 2 })
            return { found: true, count: ys.length, spread: Math.max(...ys) - Math.min(...ys) }
          })
          assert.ok(items.found, 'V4: the list of recipients with its «Destinatario» control is not drawn')
          assert.ok(items.spread <= 8, `V4: the recipients are on more than one line (their centers differ by ${Math.round(items.spread)} px)`)
        } finally { await context.close() }
      })
    })
  }
})
