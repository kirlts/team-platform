// H-3723, UD-254 (5): the output a template declares, in a real browser against dev-server.mjs serving panel/dist
// (`npm run test:flows`). The row of a template counts its outputs; its window shows «Salida» under «Campos» and edits
// it like the fields; the server refuses a frontmatter that does not compile with 422 and its reason, and the window says it.
import assert from 'node:assert'
import { mkdirSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, openTemplate, openTemplates, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_SALIDA_PORT ?? 8630), { stepMs: 80 })
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

async function session(viewport = DESKTOP, colorScheme = 'light') {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme })
  const page = await context.newPage()
  await login(page, origin, 'ana')
  await page.locator('main#main').waitFor()
  await page.goto(`${origin}/areas/a-error`)
  await openTemplates(page)
  await page.locator('section[aria-label="Plantillas"]').waitFor()
  await settled(page)
  return { page, context }
}

const rowOf = (page) => page.locator('section[aria-label="Plantillas"] [data-template-row]').filter({ hasText: 'Reporte de error' }).first()

async function shot(page, name) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

describe('Template output', () => {
  test('the row counts the outputs and the window shows «Salida» under «Campos» with the declared entries and the two fixed ones', async () => {
    for (const [viewport, colorScheme] of [[DESKTOP, 'light'], [DESKTOP, 'dark'], [PHONE, 'light'], [PHONE, 'dark']]) {
      const { page, context } = await session(viewport, colorScheme)
      try {
        const row = rowOf(page)
        assert.equal((await row.locator('[data-figure="Salidas"] > span:last-child').textContent()).trim(), '2', 'two declared entries')
        const dialog = await openTemplate(page, 'Reporte de error')
        // The 12 px label draws capitals with CSS: the text itself stays in normal case.
        const headings = (await dialog.locator('section h2').allTextContents()).map((x) => x.trim())
        assert.deepEqual(headings.slice(0, 2), ['Campos', 'Salida'])
        const output = dialog.locator('section[aria-label="Salida"]')
        const labels = (await output.locator('li').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
        assert.deepEqual(labels.map((x) => x.split(' ')[0]), ['Causa', 'Rama', 'Resultado', 'Resumen'])
        await output.locator('[data-output-fixed]').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await output.locator('[data-output-fixed]').count(), 2)
        await shot(page, `salida-ventana-${viewport.width}-${colorScheme}`)
      } finally {
        await context.close()
      }
    }
  })

  test('the window edits the output like the fields: adding an entry saves the file and the row shows it', async () => {
    const { page, context } = await session()
    try {
      const dialog = await openTemplate(page, 'Reporte de error')
      const output = dialog.locator('section[aria-label="Salida"]')
      await output.waitFor()
      await output.locator('[data-output-fixed]').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await output.locator('[data-output-fixed]').count(), 2)
      const sent = []
      page.on('request', (r) => { if (r.method() === 'PATCH' && /\/api\/areas\/a-error\/templates\//.test(r.url())) sent.push(JSON.parse(r.postData() ?? '{}')) })
      await output.getByRole('button', { name: 'Agregar salida', exact: true }).click()
      await dialog.getByRole('status').filter({ hasText: 'Guardado' }).waitFor()
      assert.equal(sent.length, 1)
      assert.match(sent[0].body_markdown, /output:\n {2}- \{ name: cause, label: "Causa", type: text, required: true \}\n {2}- \{ name: branch, label: "Rama", type: text, required: false \}\n {2}- \{ name: dato_nuevo, label: "Dato nuevo", type: text, required: false \}\n---/)
      await output.getByRole('combobox', { name: 'Tipo de Dato nuevo' }).selectOption('list')
      await settled(page)
      assert.match(sent.at(-1).body_markdown, /name: dato_nuevo, label: "Dato nuevo", type: list/)
      await shot(page, 'salida-ventana-1440-light')
      await dialog.getByRole('button', { name: 'Listo' }).click()
      await dialog.waitFor({ state: 'hidden' })
      assert.equal((await rowOf(page).locator('[data-figure="Salidas"] > span:last-child').textContent()).trim(), '3', 'the row counts the new entry')
    } finally {
      await context.close()
    }
  })

  test('the server refuses an output that does not compile with 422 and the window shows the reason', async () => {
    const { page, context } = await session()
    try {
      const refused = await page.evaluate(async () => {
        const list = await (await fetch('/api/areas/a-error/templates')).json()
        const t = (list.items ?? list).find((x) => x.name === 'Reporte de error')
        const body_markdown = t.body_markdown.replace('name: cause', 'name: summary')
        const r = await fetch(`/api/areas/a-error/templates/${t.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-team-request': 'panel' }, body: JSON.stringify({ body_markdown }) })
        return { status: r.status, body: await r.json() }
      })
      assert.equal(refused.status, 422)
      assert.match(refused.body.message, /campo fijo/)
      // The window, against a server that refuses the file: the reason appears under the parts.
      await page.route(/\/api\/areas\/a-error\/templates\/[^/]+$/, (route) => route.request().method() === 'PATCH'
        ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'template_invalid', message: 'output[2].type debe ser uno de: text, list, number, boolean' }) })
        : route.continue())
      const dialog = await openTemplate(page, 'Reporte de error')
      await dialog.locator('section[aria-label="Salida"]').getByRole('button', { name: 'Agregar salida', exact: true }).click()
      const alert = dialog.locator('[data-template-refused]')
      await alert.waitFor()
      assert.match(await alert.innerText(), /output\[2\]\.type debe ser uno de/)
      await shot(page, 'salida-rechazo-1440-light')
    } finally {
      await context.close()
    }
  })
})
