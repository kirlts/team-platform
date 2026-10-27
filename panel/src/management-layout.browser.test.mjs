// Layout prohibitions of the management views (Áreas, plantillas, Conexiones), measured in the browser, 2026-10-26.
// Each one forbids a class seen in the 1.0 review, not the one case: a row check that rides above a multi-line row, labels of one
// row on different lines, a figure glued to its word, a window title the size of its own field labels, a list with no state.
import assert from 'node:assert'
import { after, before, test } from 'node:test'
import { login, openFolds, settled, startPanel } from './browser-support.mjs'

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
    await openFolds(page)
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

// ---- Second review of the management views, 2026-10-27: each test forbids the class, not the case. ----

const PHONE = { width: 390, height: 844 }

/** A touch screen: `pointer: coarse` is what the 44 px rule keys on. */
async function openTouch(path, viewport = PHONE, who = 'ana') {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  await login(page, panel.origin, who)
  await page.goto(`${panel.origin}${path}`)
  await page.locator('main h1').first().waitFor()
  await settled(page)
  return { page, context }
}

test('after a reversible action the header of Equipo, Áreas and Configuración still fits 390 px: the main button stays on screen and the page does not scroll sideways', async () => {
  await panel.control.reset()
  for (const [path, action, button] of [
    ['/team', async (page) => { await page.getByRole('button', { name: /^Nombre: Bruno/ }).click(); await page.getByRole('textbox', { name: 'Nombre' }).fill('Bruno Cambiado'); await page.keyboard.press('Enter') }, 'Agregar miembro'],
    ['/areas', async (page) => { await page.getByRole('button', { name: /^Descripción:/ }).first().click(); await page.getByRole('textbox', { name: 'Descripción' }).fill('Una descripción nueva de la primera área'); await page.keyboard.press('Enter') }, 'Crear área'],
  ]) {
    const { page, context } = await openTouch(path)
    try {
      await action(page)
      await page.getByRole('button', { name: 'Deshacer', exact: true }).waitFor()
      const m = await page.evaluate((name) => {
        const main = document.querySelector('main#main')
        const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === name)
        return { scroll: main.scrollWidth - main.clientWidth, right: b ? b.getBoundingClientRect().right : null, left: b ? b.getBoundingClientRect().left : null, width: window.innerWidth }
      }, button)
      assert.equal(m.scroll <= 1, true, `${path}: main scrolls sideways by ${m.scroll} px`)
      assert.ok(m.right !== null && m.right <= m.width && m.left >= 0, `${path}: «${button}» is off the screen (${m.left}..${m.right} of ${m.width})`)
    } finally {
      await context.close()
      await panel.control.reset()
    }
  }
})

test('the title of every management view falls at the same height, with its action or without it', async () => {
  const ys = []
  for (const path of ['/team', '/areas', '/settings', '/connections']) {
    const { page, context } = await open(path)
    try {
      ys.push([path, await page.locator('main h1').first().evaluate((h) => Math.round(h.getBoundingClientRect().top + h.getBoundingClientRect().height / 2))])
    } finally {
      await context.close()
    }
  }
  const { page, context } = await open('/areas')
  try {
    // The list of areas without areas moves «Crear área» out of the header into the empty state: the title does not move.
    await page.route(/\/api\/areas(\?|$)/, (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }) : r.continue())
    await page.reload()
    await page.locator('main h1').first().waitFor()
    await page.getByText('Sin áreas').waitFor()
    ys.push(['/areas (vacío)', await page.locator('main h1').first().evaluate((h) => Math.round(h.getBoundingClientRect().top + h.getBoundingClientRect().height / 2))])
  } finally {
    await context.close()
  }
  const all = ys.map(([, y]) => y)
  assert.ok(Math.max(...all) - Math.min(...all) <= 1, `titles at ${ys.map(([p, y]) => `${p} ${y}`).join(', ')}`)
})

test('Guardias is a window of the kit: padded like the other windows and with the check box of the panel', async () => {
  const { page, context } = await open('/areas/a-error')
  try {
    await page.getByTestId('area-guards-open').click()
    const guards = page.getByTestId('area-guards')
    await guards.waitFor()
    const m = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]').getBoundingClientRect()
      const inner = document.querySelector('[data-testid="area-guards"]')
      const text = inner.querySelector('[data-editable]').getBoundingClientRect()
      const trash = inner.querySelector('button[aria-label="Quitar Guardia"]').getBoundingClientRect()
      return { left: text.left - dialog.left, right: dialog.right - trash.right, native: inner.querySelectorAll('input[type="checkbox"]').length, kit: inner.querySelectorAll('[role="checkbox"]').length }
    })
    // The text starts 6 px inside its column (the in-place box has a negative margin): 14 px is the 20 px of padding.
    assert.ok(m.left >= 14 && m.right >= 14, `content at ${m.left} px from the left edge and ${m.right} px from the right`)
    assert.equal(m.native, 0, 'a check box of the browser')
    assert.ok(m.kit >= 1, 'no check box of the kit')
  } finally {
    await context.close()
  }
})

test('a queue that could not be counted is an error with Reintentar, never five zeros', async () => {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
  try {
    const page = await context.newPage()
    await login(page, panel.origin, 'ana')
    await page.route(/\/api\/jobs\?/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'internal', message: 'boom' }) }))
    await page.goto(`${panel.origin}/settings`)
    const queue = page.locator('[data-queue]')
    await queue.getByText('No se pudo cargar', { exact: false }).first().waitFor({ timeout: 20_000 })
    await queue.getByRole('button', { name: 'Reintentar' }).first().waitFor()
    assert.equal(await queue.locator('[data-job-count]').count(), 0, 'a count is drawn for a figure that was not read')
  } finally {
    await context.close()
  }
})

test('Configuración has no help text by default and folds what is not needed every time', async () => {
  const { page, context } = await open('/settings')
  try {
    const visible = await page.evaluate(() => [...document.querySelectorAll('[data-setting-hint]')].filter((h) => h.getBoundingClientRect().width > 1 && h.getBoundingClientRect().height > 1).map((h) => h.id))
    assert.deepEqual(visible, [], 'help text drawn by default')
    for (const box of ['data-providers', 'data-data-reset', 'data-audit']) {
      const toggle = page.locator(`[${box}] h2 button`)
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', `${box} is open by default`)
    }
    // Opening «Datos» draws the three hints that say what each action deletes or spends.
    await page.locator('[data-data-reset] h2 button').click()
    const hints = await page.locator('[data-data-reset] [data-setting-hint]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height > 1))
    assert.deepEqual(hints, [true, true, true])
    // «Aplicar» exists only while a function has a change to apply.
    await page.locator('[data-providers] h2 button').click()
    await page.locator('[data-providers] li[data-slot="text"]').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Aplicar' }).count(), 0, 'an Aplicar that is off, drawn all the time')
  } finally {
    await context.close()
  }
})

test('on a touch screen the controls of the management views are as tall as a finger', async () => {
  for (const path of ['/team', '/areas', '/areas/a-error', '/settings']) {
    const { page, context } = await openTouch(path)
    try {
      if (path === '/settings') await openFolds(page)
      const small = await page.evaluate(() => {
        const out = []
        const sel = 'main button:not([role="checkbox"]), main select, main input:not([type="hidden"]):not([type="file"]), main textarea, main [data-editable], main a[href]'
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect()
          if (!r.width || !r.height) continue
          // A link inside running text is exempt (WCAG 2.5.8, inline); so are the rows of the message list, which belong to Mensajes.
          if (el.closest('p, li > p, [data-prose], [data-message-card], article, [data-slot-result]')) continue
          if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} «${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}» ${Math.round(r.width)}x${Math.round(r.height)}`)
        }
        return out
      })
      assert.deepEqual(small, [], `${path}: controls under 44 px`)
      if (path === '/areas') {
        // The name of an area keeps the space before its last word when the link is as tall as a finger.
        const names = await page.evaluate(() => [...document.querySelectorAll('main a[aria-label^="Abrir "]')].map((a) => [a.getAttribute('aria-label').slice('Abrir '.length), a.innerText.trim()]))
        assert.ok(names.length > 0)
        for (const [title, shown] of names) assert.equal(shown, title)
      }
      // The check box of a row is 20 px and its invisible frame reaches 44: the corners of the frame hit the box.
      const hit = await page.evaluate(() => {
        const box = document.querySelector('main [role="checkbox"]')
        if (!box) return null
        const r = box.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        return [[-20, 0], [20, 0], [0, -20], [0, 20]].map(([dx, dy]) => document.elementFromPoint(cx + dx, cy + dy) === box)
      })
      if (hit) assert.deepEqual(hit, [true, true, true, true], `${path}: the frame around the check box does not reach 44 px`)
    } finally {
      await context.close()
    }
  }
})

test('changing the role of a member is announced under the top bar with its Deshacer', async () => {
  await panel.control.reset()
  const { page, context } = await open('/team')
  try {
    await page.getByRole('button', { name: /^Acciones de Bruno/ }).click()
    await page.getByRole('menuitemradio', { name: /^Editor/ }).click()
    const notice = page.getByRole('status').filter({ hasText: 'Rol de Bruno Prueba: Editor' })
    await notice.waitFor()
    await notice.getByRole('button', { name: 'Deshacer' }).waitFor()
  } finally {
    await context.close()
    await panel.control.reset()
  }
})

test('a team with nobody in it says so, an unknown connection says «Página no encontrada», and a missing area is titled like a page', async () => {
  const { page, context } = await open('/team')
  try {
    await page.route(/\/api\/members(\?|$)/, (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }) : r.continue())
    await page.reload()
    await page.getByText('Sin miembros').waitFor()
    assert.equal(await page.getByRole('status', { name: 'Cargando' }).count(), 0, 'an empty team draws the skeleton of a list that has not arrived')
    await page.goto(`${panel.origin}/connections/inexistente`)
    await page.getByRole('heading', { name: 'Página no encontrada', level: 1 }).waitFor()
    await page.goto(`${panel.origin}/areas/no-existe`)
    const h1 = page.getByRole('heading', { name: 'El área no existe', level: 1 })
    await h1.waitFor()
    const fg = await h1.evaluate((el) => getComputedStyle(el).color)
    const body = await page.locator('main').evaluate((el) => getComputedStyle(el).color)
    assert.equal(fg, body, 'the title of the screen is drawn in the muted ink')
  } finally {
    await context.close()
  }
})

test('the example server resets after members were deleted', async () => {
  await panel.control.reset()
  const { page, context } = await open('/team')
  try {
    const ids = await page.evaluate(async () => (((b) => b.items ?? b)(await (await fetch('/api/members')).json())).filter((m) => m.email.startsWith('carla') || m.email.startsWith('diego')).map((m) => m.id))
    for (const id of ids) await page.request.delete(`${panel.origin}/api/members/${id}?confirm=true`, { headers: { 'x-team-request': 'panel' } })
    await panel.control.reset() // it threw a 500 here: the audit log was seeded before the members were back
  } finally {
    await context.close()
    await panel.control.reset()
  }
})
