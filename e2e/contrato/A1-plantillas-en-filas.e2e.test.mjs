// A1: the templates of an area are all visible in aligned rows, and each one opens its window.
// The same layout is checked against the double server by panel/src/flows-plantillas-area.browser.test.mjs; this one runs on the real server at 1440 and 1920.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

/** The file of a template with `fields` fields and `outputs` outputs. */
const file = (name, description, fields, outputs) => {
  const list = fields === 0 ? ['fields: []'] : ['fields:', ...Array.from({ length: fields }, (_, i) => `  - { name: f${i}, label: "Campo ${i + 1}", required: false }`)]
  const out = outputs === 0 ? [] : ['output:', ...Array.from({ length: outputs }, (_, i) => `  - { name: o${i}, label: "Dato ${i + 1}", type: text, required: false }`)]
  return ['---', `name: ${JSON.stringify(name)}`, `description: ${JSON.stringify(description)}`, ...list, ...out, '---', '## Método', 'Leer el input y separar un mensaje por cada punto distinto.', ''].join('\n')
}

async function areaWithFour () {
  const area = (await h.api('ana').post('/areas', { title: h.unique('A1 área'), description: 'Área con cuatro plantillas' })).data
  const made = [['Dato de ficha', 4, 1], ['Agenda y citas', 0, 0], ['Pago con link', 2, 2], ['Aviso a pacientes con un nombre bastante largo para la columna', 1, 0]]
  for (const [name, fields, outputs] of made) {
    const res = await h.api('ana').post(`/areas/${area.id}/templates`, { name, description: `Descripción de ${name}`, body_markdown: file(name, `Descripción de ${name}`, fields, outputs) })
    assert.equal(res.status, 201, JSON.stringify(res.data))
  }
  return area
}

const same = (values, what, tolerance = 1) => assert.ok(Math.max(...values) - Math.min(...values) <= tolerance, `A1: ${what}: ${values.map((v) => Math.round(v * 10) / 10).join(', ')}`)

describe('A1: the templates of an area are aligned rows that open their window', () => {
  for (const width of [1440, 1920]) {
    test(`A1: four templates show as four rows with the name, the figures and the action at one x each, at ${width} px`, async () => {
      const area = await areaWithFour()
      const { page, context } = await h.open('ana', { viewport: { width, height: 1000 } })
      try {
        await page.goto(`${h.origin}/areas/${area.id}`)
        const list = page.locator('section[aria-label="Plantillas"]')
        await list.waitFor()
        await settled(page)
        const rows = list.locator('[data-template-row]')
        assert.equal(await rows.count(), 4, 'A1: not every template of the area is drawn as a row')
        const boxes = []
        for (let i = 0; i < 4; i++) {
          const row = rows.nth(i)
          await row.scrollIntoViewIfNeeded()
          boxes.push({
            name: await row.getByTestId('template-open').boundingBox(),
            whole: await row.boundingBox(),
            figures: await row.locator('[data-figure] > span:last-child').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right)),
            del: await row.getByRole('button', { name: /^Borrar / }).boundingBox()
          })
        }
        same(boxes.map((b) => b.name.x), 'the name does not start at one x in every row')
        same(boxes.map((b) => b.whole.x), 'the rows do not start at one x')
        same(boxes.map((b) => b.whole.width), 'the rows are not as wide as each other')
        same(boxes.map((b) => b.del.x + b.del.width), 'the action does not end at one x')
        for (let c = 0; c < boxes[0].figures.length; c++) same(boxes.map((b) => b.figures[c]), `figure ${c + 1} does not end at one x`)
        same(boxes.map((b) => b.whole.height), 'the rows are not as tall as each other', 2)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'A1: horizontal scroll')
      } finally { await context.close() }
    })
  }

  test('A1: each template opens its own window when its name is pressed, and the window closes', async () => {
    const area = await areaWithFour()
    const { page, context } = await h.open('ana')
    try {
      await page.goto(`${h.origin}/areas/${area.id}`)
      const rows = page.locator('section[aria-label="Plantillas"] [data-template-row]')
      await rows.first().waitFor()
      for (const name of ['Dato de ficha', 'Agenda y citas', 'Pago con link']) {
        await page.getByRole('button', { name: `Abrir ${name}`, exact: true }).click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        assert.ok((await dialog.innerText()).includes(name), `A1: the window of ${name} does not show its name`)
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
      }
    } finally { await context.close() }
  })
})
