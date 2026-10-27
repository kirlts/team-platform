// V9: in the previews of the lists (Inicio and Mensajes), the description is one line ending in «…» and the cards are all the same height.
// Martín, 2026-10-24 21:26: «las descripciones deben quedar de una línea en vista previa, terminando con "..." para que las alturas sean más o menos consistentes».
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { FILES, harness, settled } from './harness.mjs'
import { photo } from './v-support.mjs'

let h
before(async () => { h = await harness() })

const LONG = Array.from({ length: 10 }, (_, i) => `Frase ${i + 1} de una descripción muy larga que no cabe en una sola línea de la tarjeta de la lista.`).join(' ')

/** Messages of every shape the cards must absorb: no body, short body, long body, long title, with attachments, with replies. None has recipients: a long recipient name may lengthen its row by design (UD-241). */
async function varied (tag) {
  const ids = []
  ids.push(await h.message(`${tag} corto`, { as: 'bruno' }))
  ids.push(await h.message(`${tag} largo\n${LONG}`, { as: 'bruno', files: [photo(1), FILES.pdf()] }))
  ids.push(await h.message(`${tag} título muy largo ${'que sigue y sigue '.repeat(8)}\n${LONG}`, { as: 'bruno' }))
  ids.push(await h.message(`${tag} con respuestas\n${LONG}`, { as: 'bruno', files: [FILES.audio()] }))
  for (let n = 1; n <= 3; n++) await h.api('carla').post(`/messages/${ids.at(-1)}/replies`, { body: `Respuesta ${n}`, kind: 'answer' })
  return ids
}

async function measure (page, tag) {
  return page.evaluate((needle) => {
    const cards = [...document.querySelectorAll('[data-testid="card-text"]')].map((el) => el.closest('li, article'))
      .filter((card, i, all) => card && all.indexOf(card) === i && card.innerText.includes(needle))
    return cards.map((card) => {
      // The title and the description are two lines of the card: the description is the extract.
      const text = card.querySelector('[data-testid="card-extract"]')
      const s = getComputedStyle(text)
      const line = parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.4
      const state = card.querySelector('[data-testid="card-state"]')
      // An area name that does not fit its line goes to the next one and the row grows, on purpose (UD-016, DISENO.md «Tarjeta de lista»): such a row is not the case of V9.
      const stateWraps = state.getBoundingClientRect().height > 30 // a line of the state is 20 px, two are 42
      return { title: card.innerText.split('\n')[0], stateWraps, height: card.getBoundingClientRect().height, textHeight: text.getBoundingClientRect().height, line, nowrap: s.whiteSpace === 'nowrap' || s.webkitLineClamp === '1', ellipsis: s.textOverflow === 'ellipsis' || s.webkitLineClamp === '1', clipped: text.scrollWidth > text.clientWidth + 1 || s.webkitLineClamp === '1', text: text.innerText }
    })
  }, tag)
}

describe('V9: previews of one line and cards of one height', () => {
  for (const [name, path] of [['Inicio', '/'], ['Mensajes', '/messages']]) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      test(`V9: in ${name} at ${viewport.width} px the description is one line with an ellipsis and every card has the same height`, async () => {
        const tag = h.unique(`V9 ${name}`)
        await varied(tag)
        const { page, context } = await h.open('ana', { viewport })
        try {
          await page.goto(`${h.origin}${path}`)
          await page.locator('[data-testid="card-text"]').first().waitFor()
          await settled(page)
          const cards = await measure(page, tag)
          assert.ok(cards.length >= 3, `V9: expected at least 3 of the 4 cards of this case in view, found ${cards.length}`)
          for (const c of cards) {
            assert.ok(c.textHeight <= c.line * 1.6, `V9: the description of «${c.title}» is ${Math.round(c.textHeight)} px high (${(c.textHeight / c.line).toFixed(1)} lines): it must be one line`)
            assert.ok(c.nowrap && c.ellipsis, `V9: the description of «${c.title}» does not end in an ellipsis (white-space nowrap ${c.nowrap}, text-overflow ellipsis ${c.ellipsis})`)
          }
          assert.ok(cards.some((c) => c.clipped), 'V9: no long description is actually cut with the ellipsis')
          // A row whose state line wraps is compared with the rows that wrap, and the rest with the rest (see `stateWraps`).
          for (const wraps of [false, true]) {
            const heights = cards.filter((c) => c.stateWraps === wraps).map((c) => Math.round(c.height))
            if (heights.length) assert.ok(Math.max(...heights) - Math.min(...heights) <= 4, `V9: the cards have different heights: ${JSON.stringify(cards.map((c) => [c.title.slice(0, 24), Math.round(c.height), c.stateWraps]))}`)
          }
        } finally { await context.close() }
      })
    }
  }
})
