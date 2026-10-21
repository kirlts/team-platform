// Round 4, judges of Equipo, Configuración and the sign-in page: each test reads what the screen shows, in a real browser,
// against dev-server.mjs serving panel/dist (`npm run test:flows`). Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, startPanel } from './browser-support.mjs'

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

  test('«Ver más» appears exactly where text is folded, and opening it shows text that was hidden', async () => {
    const { page, context } = await session('ana', DESKTOP)
    try {
      await page.goto(`${origin}/team`)
      await page.getByRole('button', { name: 'Ver más' }).first().waitFor()
      const members = await page.evaluate(async () => ((b) => b.items ?? b)(await (await fetch('/api/members')).json()).map((m) => ({ email: m.email, paragraphs: (m.profile ?? '').split(/\n\s*\n/).filter((x) => x.trim()).length })))
      const report = []
      for (const m of members) {
        const row = page.locator('main div.border-b').filter({ hasText: m.email }).first()
        // The list shows the rows that fit the window; the others are on the next page.
        if ((await row.count()) === 0) continue
        const more = (await row.getByRole('button', { name: 'Ver más' }).count()) > 0
        assert.equal(more, m.paragraphs > 1, `${m.email}: «Ver más» ${more} with ${m.paragraphs} paragraphs`)
        report.push({ email: m.email, more })
      }
      assert.ok(report.length >= 7, `${report.length} rows on screen`)
      assert.ok(report.some((x) => x.more), 'no row has a folded profile')
      // Each link, once opened, makes its row taller: it was hiding something.
      for (const { email } of report.filter((x) => x.more)) {
        const row = page.locator('main div.border-b').filter({ hasText: email }).first()
        const before = (await row.boundingBox()).height
        await row.getByRole('button', { name: 'Ver más' }).click()
        await row.getByRole('button', { name: 'Ver menos' }).waitFor()
        assert.ok((await row.boundingBox()).height > before, `${email}: the row did not grow when opened`)
        await row.getByRole('button', { name: 'Ver menos' }).click()
      }
    } finally {
      await context.close()
    }
  })

  test('on a phone «Desactivar» shares the row of the role, on the right edge of the content, and adds no row', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      await page.goto(`${origin}/team`)
      const off = page.getByRole('button', { name: /^Desactivar a Bruno/ })
      await off.waitFor()
      const row = page.locator('main div.border-b').filter({ hasText: 'bruno@dev.invalid' }).first()
      const badge = row.getByText('Miembro', { exact: true }).first()
      const [b, o, r] = [await badge.boundingBox(), await off.boundingBox(), await row.boundingBox()]
      const [b1, o1] = [b.y + b.height / 2, o.y + o.height / 2]
      assert.ok(Math.abs(b1 - o1) <= 2, `the action is ${Math.abs(b1 - o1)} px off the center of the role`)
      assert.ok(r.x + r.width - (o.x + o.width) <= 16 + 1, `the action ends ${r.x + r.width - (o.x + o.width)} px from the edge of the card`)
      assert.ok(Math.abs(o.x + o.width - (r.x + r.width - 16)) <= 1, 'the action ends on the right padding of the card')
      const below = await row.evaluate((el) => {
        const last = [...el.querySelectorAll('button')].filter((x) => x.textContent === 'Ver más' || x.textContent === 'Ver menos').pop()
        return el.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom
      })
      assert.ok(below <= 16 + 8, `${below} px of empty height under the profile`)
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
      await page.getByText('Idioma de la interfaz y de los mensajes que redacta el modelo').waitFor()
      await page.locator('label', { hasText: 'Proveedor' }).first().waitFor()
      const labels = await page.evaluate(() => {
        const names = ['Nombre', 'Correo', 'Rol', 'Idioma', 'Proveedor', 'Modelo']
        return names.map((text) => {
          const el = [...document.querySelectorAll('dt, label')].find((x) => (x.firstChild?.textContent ?? x.textContent)?.trim() === text)
          const node = el?.tagName === 'LABEL' ? el : el
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

  test('the hints of Nombre and Correo say where they change, and their values are not controls', async () => {
    const { page, context } = await session('ana', DESKTOP)
    try {
      await page.goto(`${origin}/settings`)
      await page.getByText('el Editor lo cambia en Equipo').waitFor()
      await page.getByText('el Editor la cambia en Equipo').waitFor()
      const value = page.locator('dd').filter({ hasText: 'ana@dev.invalid' }).first()
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
        const note = await card.getByText('Cuentas creadas por el Editor del equipo').boundingBox()
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

  test('a refused login shows the reason under the card, readable, and the card does not move', async () => {
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
      assert.ok(notice.y >= after.y + after.height, 'the reason is inside the card')
      assert.ok(notice.y + notice.height <= DESKTOP.height, 'the reason is off the screen')
    } finally {
      await context.close()
    }
  })
})
