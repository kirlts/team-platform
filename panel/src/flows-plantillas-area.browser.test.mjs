// UD-297: the templates of an area as a list where every one is a row, and each one opens in a window; the models of the area are the Editor's.
// In a real browser against dev-server.mjs serving panel/dist (`npm run test:flows`). With SHOTS_DIR set the test also writes screenshots.
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PLANTILLAS_PORT ?? 8631), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const SHOTS = process.env.SHOTS_DIR
const csrf = { 'x-team-request': 'panel' }

/** The file of a template with `fields` required-first fields and `outputs` entries. */
const file = (name, description, fields, outputs) => {
  const list = fields === 0 ? ['fields: []'] : ['fields:', ...Array.from({ length: fields }, (_, i) => `  - { name: f${i}, label: "Campo ${i + 1}", required: ${i === 0} }`)]
  const out = outputs === 0 ? [] : ['output:', ...Array.from({ length: outputs }, (_, i) => `  - { name: o${i}, label: "Dato ${i + 1}", type: text, required: ${i === 0} }`)]
  return ['---', `name: ${JSON.stringify(name)}`, `description: ${JSON.stringify(description)}`, ...list, ...out, '---', '## Método', 'Leer el input y separar un mensaje por cada punto distinto.', ''].join('\n')
}

const LONG = 'Cada dato que se pide al abrir la ficha de un paciente, con el motivo de cada uno y lo que se hace cuando falta, escrito para quien atiende en recepción y no conoce el sistema por dentro.'

async function session(viewport = DESKTOP, colorScheme = 'light', who = 'ana') {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main#main').waitFor()
  return { page, context }
}

/** The area «Error» of the double, with four templates (it has two) and a long description in the first. */
async function withFour(page) {
  const made = [['Dato de ficha', 4, 1], ['Agenda y citas', 0, 0]]
  for (const [name, fields, outputs] of made) {
    const res = await page.request.post(`${origin}/api/areas/a-error/templates`, { data: { name, description: LONG, body_markdown: file(name, LONG, fields, outputs) }, headers: csrf })
    assert.ok(res.ok(), `crear ${name}: ${res.status()}`)
  }
  await page.goto(`${origin}/areas/a-error`)
  await page.locator('section[aria-label="Plantillas"]').waitFor()
  await settled(page)
}

const list = (page) => page.locator('section[aria-label="Plantillas"]')
const rowsOf = (page) => list(page).locator('[data-template-row]')

async function shot(page, name) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

describe('the templates of an area as a list (UD-297)', () => {
  for (const [viewport, label] of [[DESKTOP, 'desktop'], [PHONE, 'phone']]) {
    for (const scheme of ['light', 'dark']) {
      test(`${label} ${scheme}: the four templates are rows, all drawn, aligned, with no description or tags`, async () => {
        const { page, context } = await session(viewport, scheme)
        try {
          await withFour(page)
          const rows = rowsOf(page)
          assert.equal(await rows.count(), 4)
          assert.match((await page.getByRole('button', { name: /^Plantillas/ }).textContent()).replace(/\s+/g, ' ').trim(), /^Plantillas\s*4$/, 'the fold counts the rows under it')
          assert.equal(await list(page).getByText(/^\d+–\d+ de \d+$|^\d+ de \d+$/).count(), 0, 'the list is not paged')
          assert.equal(await list(page).locator('li').count(), 0, 'no field tags in the list')
          assert.equal(await list(page).getByText(LONG).count(), 0, 'no description in the list')

          const boxes = []
          for (let i = 0; i < 4; i++) {
            const row = rows.nth(i)
            await row.scrollIntoViewIfNeeded()
            const name = await row.getByTestId('template-open').boundingBox()
            const check = await row.getByTestId('row-check').boundingBox()
            const whole = await row.boundingBox()
            const figures = await row.locator('[data-figure] > span:last-child').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, right: b.right, text: e.textContent } }))
            const del = await row.getByRole('button', { name: /^Eliminar / }).boundingBox()
            boxes.push({ name, check, whole, figures, del })
            assert.ok(whole.height > 0 && whole.x >= 0 && whole.x + whole.width <= viewport.width + 0.5, `row ${i} is inside the window`)
            // The check box is at the height of the first line of the name.
            assert.ok(Math.abs(check.y + check.height / 2 - (name.y + Math.min(name.height, 32) / 2)) <= 3, `row ${i}: check box ${check.y + check.height / 2} against the name ${name.y + name.height / 2}`)
          }
          const same = (values, what, tolerance = 1) => assert.ok(Math.max(...values) - Math.min(...values) <= tolerance, `${what}: ${values.join(', ')}`)
          same(boxes.map((b) => b.name.x), 'the name starts at one x')
          same(boxes.map((b) => b.check.x), 'the check box sits at one x')
          same(boxes.map((b) => b.whole.x), 'the rows start at one x')
          same(boxes.map((b) => b.whole.width), 'the rows are as wide as each other')
          same(boxes.map((b) => b.del.x + b.del.width), 'the action ends at one x')
          if (viewport.width >= 640) {
            for (let c = 0; c < 3; c++) same(boxes.map((b) => b.figures[c].right), `figure ${c} ends at one x`)
            same(boxes.map((b) => b.whole.height), 'the rows are as tall as each other', 2)
            // The labels of the header sit over their figures.
            const header = await page.getByTestId('template-columns').locator('span').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))
            for (let c = 0; c < 3; c++) assert.ok(Math.abs(header[c + 1] - boxes[0].figures[c].right) <= 10, `the label of figure ${c} is over it: ${header[c + 1]} against ${boxes[0].figures[c].right}`)
          } else {
            const words = await rows.first().locator('[data-figure]').evaluateAll((els) => els.map((e) => e.firstElementChild.getBoundingClientRect().width > 1))
            assert.deepEqual(words, [true, true, true], 'on a phone each figure carries its word')
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll')
          assert.deepEqual(await rows.evaluateAll((els) => els.map((e) => e.querySelector('[data-testid="template-open"]').textContent.trim())), ['Reporte de error', 'Error visual', 'Dato de ficha', 'Agenda y citas'])
          assert.deepEqual((await rows.nth(2).locator('[data-figure] > span:last-child').allTextContents()).slice(0, 2), ['4', '1'], 'fields and outputs of «Dato de ficha»')
          await page.locator('#plantillas').scrollIntoViewIfNeeded()
          await shot(page, `lista-${label}-${scheme}`)
        } finally {
          await context.close()
        }
      })
    }
  }

  test('desktop: marking a row draws the bar over the list and the rows keep their x', async () => {
    const { page, context } = await session()
    try {
      await withFour(page)
      const before = await rowsOf(page).nth(2).getByTestId('template-open').boundingBox()
      await rowsOf(page).nth(0).getByTestId('row-check').click()
      await list(page).getByTestId('selection-bar').waitFor()
      const after = await rowsOf(page).nth(2).getByTestId('template-open').boundingBox()
      assert.equal(after.x, before.x)
      assert.equal(await rowsOf(page).count(), 4)
    } finally {
      await context.close()
    }
  })
})

describe('the window of a template (UD-297)', () => {
  for (const [viewport, label] of [[DESKTOP, 'desktop'], [PHONE, 'phone']]) {
    for (const scheme of ['light', 'dark']) {
      test(`${label} ${scheme}: the name opens the window with the whole description, the fields, the outputs and «Obligatorio» as a badge`, async () => {
        const { page, context } = await session(viewport, scheme)
        try {
          await withFour(page)
          await rowsOf(page).nth(2).getByTestId('template-open').click()
          const dialog = page.getByRole('dialog', { name: 'Dato de ficha' })
          await dialog.waitFor()
          await settled(page)
          assert.equal(await dialog.getByText(LONG).count(), 1, 'the description is whole')
          const fields = dialog.locator('section[aria-label="Campos"] li')
          assert.equal(await fields.count(), 4)
          const outputs = dialog.locator('section[aria-label="Salida"] li:not([data-output-fixed])')
          assert.equal(await outputs.count(), 1)
          await dialog.locator('section[aria-label="Avisos de progreso"]').waitFor()
          const badges = dialog.getByText('Obligatorio', { exact: true })
          assert.equal(await badges.count(), 5, 'one badge for each field and each output')
          assert.deepEqual(await badges.evaluateAll((els) => els.map((e) => e.tagName + ':' + e.classList.contains('rounded-full'))), Array(5).fill('SPAN:true'))
          assert.equal(await dialog.locator('span.bg-accent-soft', { hasText: 'Obligatorio' }).count(), 2, 'the required ones are filled')
          const box = await dialog.boundingBox()
          assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height + 0.5, 'the window is inside the screen')
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll')
          await shot(page, `ventana-${label}-${scheme}`)
        } finally {
          await context.close()
        }
      })
    }
  }

  test('desktop: a change made in the window is in its row once the window is closed, and Escape in a field does not close it', async () => {
    const { page, context } = await session()
    try {
      await withFour(page)
      const row = rowsOf(page).nth(1)
      assert.equal((await row.locator('[data-figure]').first().textContent()).replace('Campos', '').trim(), '1')
      await row.getByTestId('template-open').click()
      const dialog = page.getByRole('dialog', { name: 'Error visual' })
      await dialog.getByRole('button', { name: 'Agregar campo' }).click()
      await dialog.locator('section[aria-label="Campos"] li').nth(1).waitFor()
      await dialog.getByText('Guardado').waitFor()
      // The name is edited in place inside the window and Escape drops that edit only.
      await dialog.getByText('Error visual', { exact: true }).last().click()
      await page.keyboard.press('Escape')
      await dialog.waitFor()
      await dialog.getByRole('button', { name: 'Listo' }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert.equal((await row.locator('[data-figure]').first().textContent()).replace('Campos', '').trim(), '2')
    } finally {
      await context.close()
    }
  })

  test('desktop: deleting a row leaves «eliminada» with Deshacer in its place and the three others stay drawn', async () => {
    const { page, context } = await session()
    try {
      await withFour(page)
      await rowsOf(page).nth(1).getByRole('button', { name: /^Eliminar / }).click()
      const gone = list(page).getByRole('status').filter({ hasText: 'eliminada' })
      await gone.waitFor()
      await page.waitForFunction(() => document.querySelectorAll('section[aria-label="Plantillas"] [data-template-row]').length === 3)
      await gone.getByRole('button', { name: 'Deshacer' }).click()
      await rowsOf(page).nth(3).waitFor()
      assert.equal(await rowsOf(page).count(), 4)
    } finally {
      await context.close()
    }
  })
})

// The models of an area are the Editor's (UD-297): one test per guarantee, and it runs on the real server: e2e/contrato/A2-modelos-solo-editor.e2e.test.mjs
// (the Editor sees both selectors, a member does not reach them, the API answers 403 and saves nothing).
