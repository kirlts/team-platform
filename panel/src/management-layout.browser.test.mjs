// Layout prohibitions of the management views (Áreas, plantillas, Conexiones), measured in the browser, 2026-10-26.
// Each one forbids a class seen in the 1.0 review, not the one case: a row check that rides above a multi-line row, labels of one
// row on different lines, a figure glued to its word, a window title the size of its own field labels, a list with no state.
import assert from 'node:assert'
import { after, before, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel

before(async () => {
  panel = await startPanel(0, { build: false })
})

after(async () => {
  await panel?.stop()
})

async function open(path, viewport = { width: 1440, height: 900 }) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL' })
  const page = await context.newPage()
  await login(page, panel.origin, 'ana')
  await page.goto(`${panel.origin}${path}`)
  await page.locator('main h1').first().waitFor()
  await settled(page)
  return { page, context }
}

test('a row check of a table is centered on its row, also when the row takes several lines', async () => {
  const { page, context } = await open('/areas')
  try {
    const off = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="row-check"]')].map((box) => {
        const row = box.parentElement.getBoundingClientRect()
        const b = box.getBoundingClientRect()
        return Math.abs(b.top + b.height / 2 - (row.top + row.height / 2))
      }),
    )
    assert.ok(off.length > 0, 'no row checks on Áreas')
    assert.ok(off.every((d) => d <= 2), `row checks off their row's center by ${off.map((d) => d.toFixed(1)).join(', ')} px`)
  } finally {
    await context.close()
  }
})

test('the labels of the area header sit on one line and its controls end on one line', async () => {
  const { page, context } = await open('/areas/a-error')
  try {
    const m = await page.evaluate(() => {
      const owner = document.querySelector('[data-testid="area-owner"]')
      const labels = [...owner.querySelectorAll('.rotulo')].map((l) => Math.round(l.getBoundingClientRect().top))
      const controls = [...owner.querySelectorAll('select, [data-testid="area-guards-open"]')].map((c) => Math.round(c.getBoundingClientRect().bottom))
      return { labels, controls }
    })
    assert.ok(m.labels.length >= 3, 'the area header lost its labels')
    assert.ok(Math.max(...m.labels) - Math.min(...m.labels) <= 1, `labels at ${m.labels.join(', ')}`)
    assert.ok(Math.max(...m.controls) - Math.min(...m.controls) <= 1, `controls end at ${m.controls.join(', ')}`)
  } finally {
    await context.close()
  }
})

test('on a phone, a figure and its word never touch', async () => {
  const { page, context } = await open('/areas', { width: 390, height: 844 })
  try {
    const glued = await page.evaluate(() =>
      [...document.querySelectorAll('main .tabular-nums')].flatMap((n) => {
        const word = n.nextElementSibling
        if (!word || !word.textContent.trim()) return []
        const a = n.getBoundingClientRect()
        const b = word.getBoundingClientRect()
        if (!b.width || Math.abs(a.top - b.top) > a.height) return []
        return b.left - a.right < 3 ? [`${n.textContent}|${word.textContent.trim()}`] : []
      }),
    )
    assert.deepEqual(glued, [])
  } finally {
    await context.close()
  }
})

test('a window title is larger than its own field labels and is not set as one of them', async () => {
  const { page, context } = await open('/areas/a-error')
  try {
    await page.getByTestId('template-open').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    const m = await dialog.evaluate((d) => {
      const title = d.querySelector('h2')
      const label = d.querySelector('.rotulo')
      return { title: parseFloat(getComputedStyle(title).fontSize), transform: getComputedStyle(title).textTransform, label: parseFloat(getComputedStyle(label).fontSize) }
    })
    assert.ok(m.title > m.label, `title ${m.title}px, label ${m.label}px`)
    assert.equal(m.transform, 'none')
  } finally {
    await context.close()
  }
})

test('Conexiones says its state beside the title', async () => {
  const { page, context } = await open('/connections')
  try {
    await page.locator('main header').getByText('No disponible', { exact: true }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
    assert.equal(await page.locator('main header').getByText('No disponible', { exact: true }).count(), 1)
  } finally {
    await context.close()
  }
})

test('a log that failed to load says so, never «Sin registros» or «Sin envíos»', async () => {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
  try {
    const page = await context.newPage()
    await login(page, panel.origin, 'ana')
    const fail = (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'internal', message: 'boom' }) })
    await page.route(/\/api\/audit(\?|$)/, fail)
    await page.route(/\/api\/inputs\?.*all=1/, fail)
    await page.goto(`${panel.origin}/settings`)
    const audit = page.locator('[data-audit]')
    const queue = page.locator('[data-queue]')
    await audit.getByText('No se pudo cargar', { exact: false }).first().waitFor({ timeout: 20_000 })
    await queue.getByText('No se pudo cargar', { exact: false }).first().waitFor({ timeout: 20_000 })
    assert.equal(await audit.getByText('Sin registros').count(), 0)
    assert.equal(await queue.getByText('Sin envíos').count(), 0)
  } finally {
    await context.close()
  }
})
