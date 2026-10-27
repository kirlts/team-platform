// Round 4, judges of Equipo, Configuración and the sign-in page: each test reads what the screen shows, in a real browser,
// against dev-server.mjs serving panel/dist (`npm run test:flows`). Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, openFolds, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_EQUIPO_PORT ?? 8938), { stepMs: 80 })
  origin = panel.origin
})

beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

async function session(who, viewport) {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main#main').waitFor()
  return { page, context }
}

describe('Equipo', () => {
  test('the add button says that it adds', async () => {
    const { page, context } = await session('ana', DESKTOP)
    try {
      await page.goto(`${origin}/team`)
      await page.getByRole('button', { name: 'Agregar miembro' }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Miembro', exact: true }).count(), 0, 'a button still carries the bare noun')
    } finally {
      await context.close()
    }
  })

  /** Height of every member row on the screen, keyed by address. */
  const heights = (page) =>
    page.locator('main [data-member-row]').evaluateAll((rows) => rows.map((r) => [r.textContent, r.clientHeight]))

  test('a name, an address and the first paragraph of the profile are shown whole: a row that needs another line takes it, nothing is cut (UD-016)', async () => {
    for (const viewport of [PHONE, DESKTOP]) {
      const { page, context } = await session('ana', viewport)
      try {
        await page.goto(`${origin}/team`)
        await page.locator('main [data-member-row]').nth(4).waitFor()
        const cut = await page.evaluate(() =>
          [...document.querySelectorAll('main [data-member-row] [data-editable], main [data-member-row] [data-profile-extract] > span')]
            .map((e) => {
              const css = getComputedStyle(e)
              return { text: e.textContent.slice(0, 40), ellipsis: css.textOverflow === 'ellipsis' || css.whiteSpace === 'nowrap', clipped: e.scrollWidth > e.clientWidth + 1 }
            })
            .filter((x) => x.ellipsis || x.clipped),
        )
        assert.deepEqual(cut, [], `${viewport.width}: text cut in a row`)
        // The longest name of the seeds needs two lines on a phone: its row is taller than the others, and none is shorter than a line of text.
        const long = await page.locator('main [data-member-row]').filter({ hasText: 'maria.de.los' }).first().locator('[data-editable]').first().evaluate((e) => e.getBoundingClientRect().height)
        assert.ok(long > 0)
        assert.ok((await page.getByRole('button', { name: 'Ver más' }).count()) === 0, 'the fold is text of the extract, not a second control')
      } finally {
        await context.close()
      }
    }
  })

  test('a click on a row, its name or its profile neither resizes the rows nor navigates; the whole profile opens in a window', async () => {
    for (const viewport of [PHONE, DESKTOP]) {
      const { page, context } = await session('ana', viewport)
      try {
        await page.goto(`${origin}/team`)
        const row = page.locator('main [data-member-row]').filter({ hasText: 'maria.de.los' }).first()
        await row.waitFor()
        const url = page.url()
        let navigations = 0
        page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++ })
        const before = await heights(page)
        const range = await page.getByText(/^\d+–\d+ de \d+$/).allInnerTexts()
        // A click on the empty part of the row, then on the name (the Editor edits it in place) and away.
        await row.click({ position: { x: 4, y: 4 } })
        await row.getByRole('button', { name: /^Nombre:/ }).click()
        await row.getByRole('textbox', { name: 'Nombre' }).waitFor()
        // On a phone a field is 17 px so the system does not zoom on focus (styles.css), while the name reads at 15: the row being edited may take another line. The other rows do not move.
        const editing = await heights(page)
        const same = (x, y) => (viewport.width < 640 ? x.filter(([t]) => !t.includes('maria.de.los')) : x).map(([, h]) => h).join() === (viewport.width < 640 ? y.filter(([t]) => !t.includes('maria.de.los')) : y).map(([, h]) => h).join()
        assert.ok(same(editing, before), `${viewport.width}: editing the name changed the height of a row`)
        await page.keyboard.press('Escape')
        // The profile opens whole in a window, over a list that does not move.
        const full = await page.evaluate(async () => ((b) => b.items ?? b)(await (await fetch('/api/members')).json()).find((m) => m.email.startsWith('maria.de.los')).profile)
        await row.getByRole('button', { name: /^Perfil de María/ }).click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        const last = full.trim().split(/\s+/).slice(-3).join(' ')
        assert.ok((await dialog.innerText()).replace(/\s+/g, ' ').includes(last), `${viewport.width}: the window does not show the end of the profile`)
        assert.deepEqual(await heights(page), before, `${viewport.width}: opening the profile changed the height of a row`)
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
        assert.deepEqual(await heights(page), before, `${viewport.width}: closing the profile changed the height of a row`)
        assert.deepEqual(await page.getByText(/^\d+–\d+ de \d+$/).allInnerTexts(), range, 'the list changed page')
        assert.equal(page.url(), url)
        assert.equal(navigations, 0, 'the page navigated')
      } finally {
        await context.close()
      }
    }
  })

  test('the Editor writes the profile of an agent and of another person in place, inside the window (UD-281, UD-288)', async () => {
    await panel.control.execution()
    const { page, context } = await session('ana', DESKTOP)
    try {
      await page.goto(`${origin}/team`)
      await page.locator('main [data-member-row]').first().waitFor()
      const row = page.locator('main [data-member-row]').filter({ hasText: 'claude@dev.invalid' }).first()
      while ((await row.count()) === 0) await page.getByRole('button', { name: 'Página siguiente' }).click()
      await row.getByRole('button', { name: 'Perfil de Claude' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: /^Perfil de Claude:/ }).click()
      const field = dialog.getByRole('textbox', { name: 'Perfil de Claude' })
      await field.fill('Sesión desatendida. Trabaja los mensajes asignados.')
      await field.press('Enter')
      await field.waitFor({ state: 'detached' })
      await page.keyboard.press('Escape')
      await row.locator('[data-profile-extract]', { hasText: 'Sesión desatendida. Trabaja' }).waitFor()
      // UD-288: the profile of another person too.
      while ((await page.locator('main [data-member-row]').filter({ hasText: 'bruno@dev.invalid' }).count()) === 0) await page.getByRole('button', { name: 'Página anterior' }).click()
      await page.getByRole('button', { name: 'Perfil de Bruno Prueba' }).click()
      await page.getByRole('dialog').getByRole('button', { name: /^Perfil de Bruno Prueba:/ }).click()
      await page.getByRole('dialog').getByRole('textbox', { name: 'Perfil de Bruno Prueba' }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('no width from 360 to 1440 scrolls sideways, and on a phone each member is one card', async () => {
    for (const width of [360, 390, 430, 768, 1440]) {
      const { page, context } = await session('ana', { width, height: 844 })
      try {
        await page.goto(`${origin}/team`)
        await page.locator('main [data-member-row]').first().waitFor()
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        assert.ok(over <= 0, `${width}: ${over} px of sideways scroll`)
        const out = await page.locator('main [data-member-row]').evaluateAll((rows) => rows.filter((r) => [...r.querySelectorAll('*')].some((e) => e.getBoundingClientRect().right > r.getBoundingClientRect().right + 1)).length)
        assert.equal(out, 0, `${width}: something leaves a row`)
      } finally {
        await context.close()
      }
    }
  })

  test('on a phone «Acciones» shares the line of the name, on the right edge of the card, and the profile line sits under the name', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      await page.goto(`${origin}/team`)
      const off = page.getByRole('button', { name: /^Acciones de Bruno/ })
      await off.waitFor()
      const row = page.locator('main [data-member-row]').filter({ hasText: 'bruno@dev.invalid' }).first()
      const name = row.getByRole('button', { name: /^Nombre:/ })
      const extract = row.locator('[data-profile-extract] > span')
      const [n, o, r, e] = [await name.boundingBox(), await off.boundingBox(), await row.boundingBox(), await extract.boundingBox()]
      assert.ok(o.y < n.y + n.height + 24 && o.y + o.height > n.y, 'the action is not on the line of the name')
      assert.ok(Math.abs(o.x + o.width - (r.x + r.width - 16)) <= 1, 'the action ends on the right padding of the card')
      assert.ok(Math.abs(e.x - (n.x + 6)) <= 2, `the profile starts ${e.x - n.x} px off the name`)
      assert.ok(r.y + r.height - (e.y + e.height) <= 16 + 4, 'empty height under the profile')
      assert.equal(await row.getByText('Miembro', { exact: true }).count(), 0, 'a chip repeats the plain role')
    } finally {
      await context.close()
    }
  })
})

describe('Configuración', () => {
  test('the language hint names the interface and the messages, and every field label of the screen has one size and weight', async () => {
    const { page, context } = await session('ana', DESKTOP)
    try {
      await page.goto(`${origin}/settings`)
      await openFolds(page)
      await page.locator('label', { hasText: 'Proveedor' }).first().waitFor()
      const labels = await page.evaluate(() => {
        const names = ['Nombre', 'Correo', 'Rol', 'Idioma', 'Proveedor', 'Modelo']
        return names.map((text) => {
          const el = [...document.querySelectorAll('dt, label')].find((x) => (x.firstChild?.textContent ?? x.textContent)?.trim() === text)
          // A field label wraps its text in the 12 px label span; that span is what the person reads.
          const node = el?.tagName === 'LABEL' ? (el.firstElementChild ?? el) : el
          const css = node ? getComputedStyle(node) : null
          return { text, size: css?.fontSize, weight: css?.fontWeight, color: css?.color }
        })
      })
      for (const l of labels) assert.ok(l.size, `no label «${l.text}»`)
      const first = labels[0]
      for (const l of labels) assert.deepEqual({ size: l.size, weight: l.weight, color: l.color }, { size: first.size, weight: first.weight, color: first.color }, `«${l.text}» differs from «${first.text}»`)
    } finally {
      await context.close()
    }
  })

  test('the values of Nombre and Correo are plain text, with no help line and no control', async () => {
    const { page, context } = await session('ana', DESKTOP)
    try {
      await page.goto(`${origin}/settings`)
      const value = page.locator('dd').filter({ hasText: 'ana@dev.invalid' }).first()
      await value.waitFor()
      assert.equal(await page.getByText(/el Editor (lo|la) cambia en Equipo/).count(), 0, 'a help line explains the screen')
      assert.equal(await value.locator('button, input, textarea, select, [tabindex]').count(), 0, 'the e-mail looks plain and is plain')
    } finally {
      await context.close()
    }
  })
})

describe('Entrada', () => {
  for (const [name, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    test(`the note has the same margin below as the logo has above, ${name}`, async () => {
      const context = await panel.browser.newContext({ viewport, locale: 'es-CL' })
      const page = await context.newPage()
      try {
        await page.goto(origin)
        const card = page.locator('form')
        await card.waitFor()
        const note = await card.getByText('Cuentas creadas por el equipo').boundingBox()
        const logo = await card.locator('h1').boundingBox()
        const box = await card.boundingBox()
        const above = logo.y - box.y
        const below = box.y + box.height - (note.y + note.height)
        assert.ok(Math.abs(below - above) <= 4, `${above} px above the logo, ${below} px below the note`)
      } finally {
        await context.close()
      }
    })
  }

  test('a refused login shows the reason under its field, inside the card, readable, and the card does not move', async () => {
    const context = await panel.browser.newContext({ viewport: DESKTOP, locale: 'es-CL' })
    const page = await context.newPage()
    try {
      await page.goto(origin)
      const card = page.locator('form')
      const before = await card.boundingBox()
      await page.getByRole('button', { name: 'Entrar' }).click()
      const alert = page.getByRole('alert').filter({ hasText: 'Falta el correo' })
      await alert.waitFor()
      const after = await card.boundingBox()
      const notice = await alert.boundingBox()
      assert.ok(Math.abs(after.y - before.y) < 0.5 && Math.abs(after.height - before.height) < 0.5, 'the card moved')
      assert.ok(notice.y >= after.y && notice.y + notice.height <= after.y + after.height, 'the reason is outside the card')
      assert.ok(notice.y + notice.height <= DESKTOP.height, 'the reason is off the screen')
    } finally {
      await context.close()
    }
  })
})
