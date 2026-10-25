// V2: the description of a message is read whole, in the page, with no box that scrolls by itself (message 123 showed one line of eight).
// The only thing that scrolls is the column that holds the whole message (its declared lane, UD-299).
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness } from './harness.mjs'
import { longBody, openDetail, richMessage } from './v-support.mjs'

let h
before(async () => { h = await harness() })

const SIZES = [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]

describe('V2: the description is read whole', () => {
  for (const viewport of SIZES) {
    test(`V2: a fifteen-paragraph description with five attachments is drawn whole and nothing between it and its column scrolls, at ${viewport.width} px`, async () => {
      const title = h.unique('V2 descripción larga')
      const id = await richMessage(h, title, { body: longBody(title) })
      const { page, context } = await openDetail(h, 'ana', id, viewport)
      try {
        const body = page.locator('[data-message-body]')
        const facts = await body.evaluate((el) => {
          const lane = el.closest('[data-lane="message-column"]')
          const chain = []
          for (let node = el; node && node !== lane; node = node.parentElement) {
            const s = getComputedStyle(node)
            chain.push({ tag: node.tagName.toLowerCase(), overflowY: s.overflowY, maxHeight: s.maxHeight, scrolls: node.scrollHeight > node.clientHeight + 1 })
          }
          return { chain, hasLane: !!lane, height: el.getBoundingClientRect().height, scrollHeight: el.scrollHeight, text: el.innerText }
        })
        assert.ok(facts.hasLane, 'V2: the message column is not declared as the lane')
        for (const step of facts.chain) {
          assert.ok(!['auto', 'scroll'].includes(step.overflowY), `V2: <${step.tag}> between the description and its column scrolls by itself (overflow-y: ${step.overflowY})`)
          assert.ok(step.maxHeight === 'none', `V2: <${step.tag}> caps the description at max-height ${step.maxHeight}`)
          assert.ok(!step.scrolls, `V2: <${step.tag}> hides part of the description (scrollHeight over clientHeight)`)
        }
        assert.ok(facts.text.includes('Párrafo 14'), 'V2: the last paragraph is not in the page')
        // Fifteen paragraphs of two or more lines each: a box of one or two lines cannot hold them whole.
        assert.ok(facts.height > 15 * 24, `V2: the description measures ${Math.round(facts.height)} px, less than fifteen lines`)

        // Scrolling the column to its end brings the last paragraph into view: the column is the one that moves.
        await page.locator('[data-lane="message-column"]').evaluate((lane) => { lane.scrollTop = lane.scrollHeight })
        const lastVisible = await page.evaluate(() => {
          const lane = document.querySelector('[data-lane="message-column"]').getBoundingClientRect()
          // The text is one block: the last paragraph is measured with a range over its own characters.
          const walker = document.createTreeWalker(document.querySelector('[data-message-body]'), NodeFilter.SHOW_TEXT)
          let range = null
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const at = node.textContent.indexOf('Párrafo 14')
            if (at >= 0) { range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 'Párrafo 14'.length) }
          }
          if (!range) return null
          const r = range.getBoundingClientRect()
          return r.top >= lane.top - 1 && r.bottom <= lane.bottom + 1
        })
        assert.equal(lastVisible, true, 'V2: after scrolling the column to its end the last paragraph is not fully visible')
      } finally { await context.close() }
    })
  }

  test('V2: the page itself does not scroll sideways and the description wraps (no horizontal arrows)', async () => {
    const id = await richMessage(h, h.unique('V2 sin desborde'), { body: `${h.unique('V2 sin desborde')}\n${'palabraMuyLarga'.repeat(8)} y un texto normal que sigue.` })
    const { page, context } = await openDetail(h, 'ana', id, { width: 1440, height: 900 })
    try {
      const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - document.documentElement.clientWidth, body: (() => { const b = document.querySelector('[data-message-body]'); return b.scrollWidth - b.clientWidth })() }))
      assert.ok(overflow.page <= 0, `V2: the page scrolls sideways by ${overflow.page} px`)
      assert.ok(overflow.body <= 0, `V2: the description scrolls sideways by ${overflow.body} px`)
    } finally { await context.close() }
  })
})
