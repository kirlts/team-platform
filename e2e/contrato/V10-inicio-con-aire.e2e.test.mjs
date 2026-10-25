// V10: Inicio separates «Nuevo mensaje», «Últimos mensajes» and «Últimas respuestas» with the space of the kit (Martín, 2026-10-24 15:41: «están muy juntos»).
// The space between sections is the kit's: 24 px in a window lower than 800 px and 40 px from there up (panel/DISENO.md «Aire de Inicio», token AIRY_GAP).
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]

describe('V10: the sections of Inicio breathe', () => {
  for (const viewport of VIEWPORTS) {
    test(`V10: the three sections are separated by the kit's section space at ${viewport.width} x ${viewport.height}`, async () => {
      await h.message(h.unique('V10 mensaje'), { as: 'bruno' })
      const { page, context } = await h.open('ana', { viewport })
      try {
        await page.goto(h.origin)
        await page.getByTestId('compose-text').first().waitFor()
        await settled(page)
        const g = await page.evaluate(() => {
          const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom } }
          const heading = (re) => [...document.querySelectorAll('h2, h3, [class*=rotulo]')].find((e) => re.test(e.textContent ?? ''))
          let section = document.querySelector('[data-testid="compose-text"]')
          while (section && section.getBoundingClientRect().height < 80) section = section.parentElement
          const mensajes = heading(/^Últimos mensajes/i)
          const respuestas = heading(/^Últimas respuestas/i)
          // The box of a list is the widest ancestor of its heading that does not also hold the other list's heading.
          const boxOf = (head, other) => { let e = head; while (e.parentElement && !e.parentElement.contains(other)) e = e.parentElement; return e }
          return { compose: rect(section), mensajes: mensajes && rect(mensajes), respuestas: respuestas && rect(respuestas), mensajesBox: mensajes && respuestas && rect(boxOf(mensajes, respuestas)), respuestasBox: mensajes && respuestas && rect(boxOf(respuestas, mensajes)) }
        })
        assert.ok(g.mensajes && g.respuestas, 'V10: the headings «Últimos mensajes» and «Últimas respuestas» are not drawn')
        const kit = viewport.height >= 800 ? 40 : 24
        const below = g.mensajes.y - g.compose.bottom
        assert.ok(below >= kit - 1, `V10: «Nuevo mensaje» and «Últimos mensajes» are ${Math.round(below)} px apart; the kit's space is ${kit} px`)
        const sideBySide = Math.abs(g.mensajes.y - g.respuestas.y) < 8
        if (sideBySide) {
          const gap = g.respuestas.x - g.mensajesBox.right
          assert.ok(gap >= 24 - 1, `V10: «Últimos mensajes» and «Últimas respuestas» are ${Math.round(gap)} px apart sideways; the kit's space is at least 24 px`)
        } else {
          const gap = g.respuestas.y - g.mensajesBox.bottom
          assert.ok(gap >= kit - 1, `V10: «Últimos mensajes» and «Últimas respuestas» are ${Math.round(gap)} px apart when stacked; the kit's space is ${kit} px`)
        }
      } finally { await context.close() }
    })
  }
})
