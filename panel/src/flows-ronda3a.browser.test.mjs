// Round 3, judge A (J3-A-01 to J3-A-51): each flow reads what the screen shows, in a real browser, against dev-server.mjs
// serving panel/dist: `npm run test:flows`. Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, startPanel, settled, openTemplates, openTemplate } from './browser-support.mjs'

// These tests go through the review of a proposal, which is what the server does with publication by hand (UD-070): they start it with auto-publication off.
// The automatic path has its own file, `flows-inicio.browser.test.mjs`.
process.env.PANEL_DEV_AUTO_PUBLISH ??= '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_3A_PORT ?? 8884), { stepMs: 80 })
  origin = panel.origin
})

// Every test starts from the sample data as the server was born with it (H-901): none inherits what another left in the tray or the lists.
beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

async function session(who = 'ana', viewport = DESKTOP, { scheme = 'light' } = {}) {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main#main').waitFor()
  return { page, context }
}

async function messageByTitle(page, titleStart) {
  const body = await (await page.request.get(`${origin}/api/messages`)).json()
  const hit = (body.items ?? body).find((m) => m.title.startsWith(titleStart))
  assert.ok(hit, `no message starts with «${titleStart}»`)
  return hit
}

const csrf = { 'x-team-request': 'panel' }

/** Edits a published message through the API as its sender (UD-071): the PATCH carries the version that was read. */
async function patchAsSender(page, id, data) {
  const current = await (await page.request.get(`${origin}/api/messages/${id}`)).json()
  const res = await page.request.patch(`${origin}/api/messages/${id}`, { data: { ...data, version: current.version }, headers: csrf })
  assert.equal(res.status(), 200, await res.text())
}

/** The elements whose own background is a saturated red, found by painting each computed color on a canvas. */
const redFills = (page) =>
  page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    const toRgb = (color) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return { r, g, b, a }
    }
    const found = []
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect()
      if (box.width < 8 || box.height < 8) continue
      const { r, g, b, a } = toRgb(getComputedStyle(el).backgroundColor)
      // The colors of the areas (chips, swatches) are chosen by a person and are never a state: they are not red fills (UD-045).
      if (el.closest('.area-chip, .area-box') || el.getAttribute('data-testid')?.startsWith('area-')) continue
      if (a > 200 && r > 120 && r > g * 2.2 && r > b * 2.2) found.push(`${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') ?? el.getAttribute('data-status') ?? el.className.toString().slice(0, 40)}]`)
    }
    return found
  })

describe('hierarchy of color and weight in Inicio (J3-A-04, J3-A-05, J3-A-06, J3-A-18)', () => {
  for (const [who, scheme] of [['ana', 'light'], ['ana', 'dark'], ['bruno', 'light'], ['bruno', 'dark']]) {
    test(`no state paints a red fill, with ${who === 'ana' ? 'nine' : 'few'} pending (${scheme})`, async () => {
      const { page, context } = await session(who, DESKTOP, { scheme })
      try {
        await page.getByTestId('status-bar').waitFor()
        await page.locator('article[data-affects-me]').first().waitFor()
        // The bell no longer counts states (UD-100): no element is filled red, the states are the color of their shape.
        const reds = await redFills(page)
        assert.equal(reds.length, 0, `rellenos rojos: ${reds.join(', ')}`)
        // The marks that are left carry their priority in the shape only: no tinted background, no colored edge.
        const marks = await page.locator('[data-weight="quiet"]').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor))
        assert.ok(marks.length >= 4, 'there are priority marks to review')
        assert.ok(marks.every((c) => c === 'rgba(0, 0, 0, 0)'), `a quiet mark has a background: ${marks.join(' | ')}`)
      } finally {
        await context.close()
      }
    })
  }

  test('a row tells its priority once, in one column, and its metadata is plain text (J3-A-05, J3-A-18)', async () => {
    const { page, context } = await session('ana')
    try {
      const row = page.locator('article[data-affects-me]').first()
      await row.waitFor()
      // One marker of state or priority: the mark with its word, or the light of the state, never both.
      const markers = await row.locator('[data-testid="state-mark"]').count()
      assert.equal(markers, 1, 'the row states its priority or its state once')
      // The edge on the left is the only color: no element of the row has a colored background.
      // The area chip is the card's tab (UD-045): the one filled mark of a row besides its edge, and the color of the sidebar's area swatches is not a row's.
      assert.deepEqual((await redFills(page)).filter((x) => !/bell/.test(x)), [])
      // No chip in the metadata line: no avatar, no bordered pill besides the buttons, the thumbnail and the area tab of the card (UD-045).
      assert.equal(await row.locator('img[alt]:not([alt=""])').count() <= 1, true)
      const bordered = await row.evaluate((el) => [...el.querySelectorAll('*')].filter((n) => parseFloat(getComputedStyle(n).borderTopWidth) > 0 && getComputedStyle(n).borderTopColor !== 'rgba(0, 0, 0, 0)' && n.getBoundingClientRect().height > 10).map((n) => n.tagName + '.' + String(n.className).slice(0, 30)))
      assert.ok(bordered.filter((b) => !/area-chip/.test(b)).length <= 3, `pills with a border in the row: ${bordered.join(' | ')}`)
      const meta = row.locator('div.flex-wrap').first()
      const items = await meta.evaluate((el) => [...el.children].length)
      assert.ok(items <= 6, `the metadata line has ${items} pieces`)
      assert.ok((await row.locator('time').count()) === 1)
      // The thumbnail is smaller than the row's height and does not outweigh the action (J3-A-19).
      const thumb = await row.locator('.frame').first().boundingBox()
      assert.ok(thumb.width <= 40.5, `the thumbnail measures ${thumb.width}`)
    } finally {
      await context.close()
    }
  })

  test('Responder and Cerrar stay at the right edge even when the sender has no Responder (J3-A-17)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('main article').first().waitFor()
      // The rows are measured once they are laid out: every Close/Reopen button has a box. A button without one (right edge 0) is a row that was not drawn yet, not a column (H-901).
      await page.waitForFunction(() => {
        const rows = [...document.querySelectorAll('main article')]
        return rows.length > 0 && rows.every((r) => [...r.querySelectorAll('button')].filter((b) => /Cerrar|Reabrir/.test(b.textContent ?? '')).every((b) => b.getBoundingClientRect().width > 0))
      })
      await settled(page)
      const rights = await page.locator('main article').evaluateAll((rows) =>
        rows.map((r) => {
          const close = [...r.querySelectorAll('button')].find((b) => /Cerrar|Reabrir/.test(b.textContent ?? ''))
          return close ? Math.round(close.getBoundingClientRect().right) : null
        }),
      )
      const set = new Set(rights.filter((x) => x !== null))
      assert.equal(set.size, 1, `«Cerrar» falls in different columns: ${[...set].join(', ')}`)
      // The sender's own message has no Responder, and its detail says why.
      const own = await messageByTitle(page, 'Confirmar el formato')
      await page.goto(`${origin}/messages/${own.id}`)
      await page.locator('main h1').waitFor()
      // UD-278: the sender writes in the thread only to call someone, so the detail offers the form (no «Responder» button) while the message is open.
      await page.getByRole('textbox', { name: 'Respuesta' }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Responder', exact: true }).isDisabled(), true, 'without a mention the sender has nothing to send')
    } finally {
      await context.close()
    }
  })

  test('the three marks of the top bar share one style, one height and no label (J3-A-06, UD-100)', async () => {
    const { page, context } = await session('ana')
    try {
      const bar = page.getByTestId('status-bar')
      await bar.waitFor()
      const marks = await bar.locator('[data-testid="state-button"]').evaluateAll((els) =>
        els.map((el) => {
          const s = getComputedStyle(el)
          return { height: Math.round(el.getBoundingClientRect().height), size: s.fontSize, weight: s.fontWeight, border: s.borderTopWidth, bg: s.backgroundColor }
        }),
      )
      assert.equal(marks.length, 3)
      assert.equal(new Set(marks.map((c) => `${c.height}|${c.size}|${c.weight}|${c.border}|${c.bg}`)).size, 1, JSON.stringify(marks))
      assert.equal(await bar.locator('h2').count(), 0, 'the bar carries no visible labels')
    } finally {
      await context.close()
    }
  })

  test('on a phone the bar keeps the three marks, each with its number, and each opens its own menu (UD-100, UD-141)', async () => {
    for (const width of [390, 360]) {
      const { page, context } = await session('ana', { ...PHONE, width })
      try {
        const bar = page.getByTestId('status-bar')
        await bar.waitFor()
        const marks = bar.locator('[data-testid="state-button"]')
        await marks.first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await marks.count(), 3)
        await bar.locator('button:visible').first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
        assert.equal(await bar.locator('button:visible').count(), 3, 'no summary button')
        const boxes = await marks.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, right: r.right, left: r.left, status: el.dataset.status, n: el.innerText.trim() } }))
        for (const b of boxes) assert.ok(b.w >= 24 && b.h >= 24, `${b.status} measures ${b.w}x${b.h} at ${width}`)
        assert.deepEqual(boxes.map((b) => b.status), ['open', 'answered', 'closed'])
        for (const b of boxes) assert.match(b.n, /^\d+$/, 'only the number is visible')
        const word = await page.locator('header a').first().boundingBox()
        assert.ok(word.x + word.width <= boxes[0].left, `the name (ends ${word.x + word.width}) does not run under the marks (start ${boxes[0].left}) at ${width}`)
        const bell = await page.getByTestId('bell').boundingBox()
        assert.ok(boxes[2].right <= bell.x, 'the marks end before the bell')
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        assert.ok(overflow <= 0, `horizontal overflow ${overflow} px at ${width}`)
        await marks.nth(1).click()
        const menu = page.getByTestId('status-menu')
        await menu.waitFor()
        assert.match(await menu.getAttribute('aria-label'), /respondid/i)
        const menuBox = await menu.boundingBox()
        assert.ok(menuBox.x >= 0 && menuBox.x + menuBox.width <= width, `the menu fits the ${width} px screen`)
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'detached' })
        await marks.nth(1).evaluate((el) => new Promise((resolve, reject) => { const end = Date.now() + 2000; const look = () => (document.activeElement === el ? resolve() : Date.now() > end ? reject(new Error('Escape does not return the focus to the mark')) : requestAnimationFrame(look)); look() }))
      } finally {
        await context.close()
      }
    }
  })

  test('on a phone Inicio stacks the two lists, each paged inside a frame no taller than the screen (J3-A-10, UD-253)', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      await page.locator('article').first().waitFor()
      await settled(page)
      const height = await page.locator('main').evaluate((el) => el.scrollHeight)
      assert.ok(height < PHONE.height * 2.5, `«Inicio» measures ${height} px on the phone`)
      // The pager is there, so the eight messages are not eight cards of 330 px.
      const messages = page.getByRole('region', { name: 'Últimos mensajes' })
      await messages.getByText(/^1–\d+ de \d+$/).first().waitFor()
      const rows = await messages.locator('article').count()
      assert.ok(rows <= 3, `${rows} rows at once`)
      // The other list is under the first, with no switch between them.
      const replies = page.getByRole('region', { name: 'Últimas respuestas' })
      await replies.locator('article').first().waitFor()
      const [m, r] = [await messages.boundingBox(), await replies.boundingBox()]
      assert.ok(r.y >= m.y + m.height, `the replies start at ${r.y} px, under the messages that end at ${m.y + m.height} px`)
      for (const box of [m, r]) assert.ok(box.height <= PHONE.height, `a list measures ${box.height} px on the phone`)
    } finally {
      await context.close()
    }
  })

  test('the reply rows read in the same order as the message rows: what, then where (J3-A-08)', async () => {
    const { page, context } = await session('ana')
    try {
      const replies = page.getByRole('region', { name: 'Últimas respuestas' })
      const first = replies.locator('article').first()
      await first.waitFor()
      const [h, p] = await first.evaluate((el) => {
        const heading = el.querySelector('h3')
        const support = el.querySelector('p')
        const css = (n) => ({ size: getComputedStyle(n).fontSize, weight: getComputedStyle(n).fontWeight })
        return [css(heading), css(support)]
      })
      const message = page.getByRole('region', { name: 'Últimos mensajes' }).locator('article').first()
      const [mh, mp] = await message.evaluate((el) => {
        const css = (n) => ({ size: getComputedStyle(n).fontSize, weight: getComputedStyle(n).fontWeight })
        return [css(el.querySelector('h3')), css(el.querySelector('p'))]
      })
      assert.deepEqual(h, mh, 'the heading weighs the same in both lists')
      assert.deepEqual(p, mp, 'the supporting line weighs the same in both lists')
      assert.match(await first.locator('p').first().innerText(), /^En «/, 'the reply says which message it belongs to')
    } finally {
      await context.close()
    }
  })

  test('the space left under the rows is smaller than the next row, which is why it did not fit (J3-A-07)', async () => {
    const { page, context } = await session('ana')
    try {
      const region = page.getByRole('region', { name: 'Últimos mensajes' })
      await region.locator('article').first().waitFor()
      await settled(page)
      const rows = region.locator('article')
      const n = await rows.count()
      assert.ok(n >= 2, `${n} rows fit`)
      const last = await rows.nth(n - 1).boundingBox()
      const pager = await region.getByText(/^1–\d+ de \d+$/).locator('xpath=..').boundingBox()
      const left = pager.y - (last.y + last.height)
      await region.getByRole('button', { name: 'Página siguiente' }).click()
      await region.locator('article').first().waitFor()
      const next = await region.locator('article').first().boundingBox()
      assert.ok(left < next.height, `${left} px remain and the next row measures ${next.height}: it fit`)
    } finally {
      await context.close()
    }
  })

  test('Inicio shows the date and the time of the day (idea.md, UD-230) and the first stop of the keyboard is the skip link (J3-A-12)', async () => {
    const { page, context } = await session('ana')
    try {
      // idea.md asks for «fecha y hora actuales»: one line of plain text, the date and the hour, as a <time> element.
      const stamp = page.locator('main time[datetime]').filter({ hasText: /\d{1,2} [a-z]{3} 20\d\d, \d{2}:\d{2}/ })
      await stamp.first().waitFor()
      await stamp.first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await stamp.count(), 1, 'the date and the hour are one element')
      const style = await stamp.first().evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), upper: getComputedStyle(el).textTransform }))
      assert.ok(style.size >= 14 && style.upper === 'none', 'plain text, not a decoration (H-509)')
      await page.goto(origin)
      await page.locator('main#main').waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Ir al contenido')
      const ring = await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement).outlineWidth))
      assert.ok(ring >= 2, 'the focus ring is visible')
    } finally {
      await context.close()
    }
  })

  test('the compose bar is one row at rest on a phone and grows when it is written in (J3-A-11)', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      const box = page.locator('[data-compose-box]')
      await box.waitFor()
      const rest = await box.boundingBox()
      // UD-110: the bar has 24 px of padding and its controls under the field (131 px on a phone); it is still one line of text.
      // UD-255: «Enviar como» stacks on top of it on a phone. The action is a 48 px button over the full width and the
      // tools are 44 px targets that take two rows (299 px measured): the field itself stays one line.
      assert.ok(rest.height <= 310, `the bar measures ${rest.height} px at rest`)
      const field = await page.locator('[data-compose-box] textarea').boundingBox()
      assert.ok(field.height <= 64, `the field measures ${field.height} px at rest: one line of text`)
      await page.locator('[data-compose-box] textarea').fill(Array.from({ length: 4 }, () => 'Una línea larga que tiene que ocupar más de un renglón en una pantalla de teléfono para que la barra crezca con lo escrito.').join(' '))
      const grown = await box.boundingBox()
      assert.ok(grown.height > rest.height + 20, 'it grows while typing')
    } finally {
      await context.close()
    }
  })
})

describe('the sign-out row follows the identity provider (H-2605, UD-190)', () => {
  /** A session whose /api/me names another provider, as a server behind a trusted header does. */
  async function sessionWithProvider(provider, viewport = DESKTOP) {
    const mobile = viewport.width < 768
    const context = await panel.browser.newContext({ viewport, locale: 'es-CL', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
    await context.route('**/api/me', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, json: { ...(await response.json()), provider } })
    })
    const page = await context.newPage()
    await login(page, origin, 'ana')
    await page.locator('main#main').waitFor()
    return { page, context }
  }

  for (const [provider, shown] of [['local', true], ['delegated:sso-redirect', true], ['delegated:trusted-header', false]]) {
    test(`with ${provider} the sidebar ${shown ? 'offers' : 'does not offer'} «Cerrar sesión»`, async () => {
      const { page, context } = await sessionWithProvider(provider)
      try {
        await page.getByRole('link', { name: 'Configuración' }).waitFor()
        await settled(page)
        assert.equal(await page.getByRole('button', { name: 'Cerrar sesión' }).count(), shown ? 1 : 0)
        if (!shown) {
          // Nothing in the page leads to the 404 route: no request to it is made by pressing around the foot.
          const sent = []
          page.on('request', (r) => r.url().includes('/api/auth/logout') && sent.push(r.url()))
          await page.getByRole('link', { name: 'Configuración' }).click()
          assert.deepEqual(sent, [])
        }
      } finally {
        await context.close()
      }
    })
  }

  test('on a phone the menu hides it as well', async () => {
    const { page, context } = await sessionWithProvider('delegated:trusted-header', PHONE)
    try {
      await page.getByRole('button', { name: 'Abrir navegación' }).first().click()
      await page.getByRole('link', { name: 'Configuración' }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Cerrar sesión' }).count(), 0)
    } finally {
      await context.close()
    }
  })
})

describe('the menu of a state (J3-A-13, J3-A-14, J3-A-15, UD-100)', () => {
  test('it lists what it counts, says where the rest is and does not repeat the word on every row', async () => {
    const { page, context } = await session('ana')
    try {
      const mark = page.locator('[data-testid="state-button"][data-status="open"]')
      await mark.waitFor()
      const total = Number((await mark.textContent()).trim())
      await mark.click()
      const list = page.locator('[data-lane="status-list"]')
      await list.waitFor()
      assert.equal(await list.locator('li').count(), total)
      const seeAll = page.getByRole('link', { name: /^Ver todos/ })
      await seeAll.waitFor()
      // The state is the mark that opened the menu: no row repeats its word.
      assert.equal(await list.locator('[data-testid="state-mark"]').count(), 0)
      // It opens below the bar with room between them.
      const popover = await list.locator('xpath=ancestor::*[contains(@class,"pop")]').boundingBox()
      assert.ok(popover.y >= 52 + 6, `el desplegable se abre a ${popover.y} px, pegado a la barra`)
      await seeAll.click()
      await page.waitForURL(/\/messages\?/)
    } finally {
      await context.close()
    }
  })

  test('H-2000 · the number of each mark, the rows of its menu and the list «Ver todos» leads to are the same count', async () => {
    const { page, context } = await session('ana')
    try {
      // The sample data has no closed message: one assigned to Ana is closed first, so the third mark counts something.
      const toClose = await messageByTitle(page, 'Corregir el contraste del botón Enviar')
      assert.equal((await page.request.post(`${origin}/api/messages/${toClose.id}/close`, { headers: csrf })).status(), 200)
      for (const status of ['open', 'answered', 'closed']) {
        await page.goto(origin)
        const mark = page.locator(`[data-testid="state-button"][data-status="${status}"]`)
        await mark.waitFor()
        const total = Number((await mark.textContent()).trim())
        assert.ok(total > 0, `Ana has ${status} messages in the sample data`)
        await mark.click()
        const list = page.locator('[data-lane="status-list"]')
        await list.waitFor()
        assert.equal(await list.locator('li').count(), total, `${status}: rows of the menu`)
        await page.getByRole('link', { name: /^Ver todos/ }).click()
        await page.waitForURL(/\/messages\?/)
        assert.match(page.url(), /involved%3Aeq%3Ame/)
        await page.locator('main article').first().waitFor()
        await settled(page)
        // The list fits its frame and pages: the total is the one the pager states, or the rows when everything fits.
        const range = await page.locator('main [aria-live="polite"]').filter({ hasText: / de \d+$/ }).first().textContent({ timeout: 1500 }).catch(() => null)
        const listed = range ? Number(/ de (\d+)$/.exec(range.trim())[1]) : await page.locator('main article').count()
        assert.equal(listed, total, `${status}: size of the list the link leads to`)
      }
    } finally {
      await context.close()
    }
  })

  test('with many messages the list fits the screen and scrolls inside, with «Ver todos» in view', async () => {
    const { page, context } = await session('ana', { width: 768, height: 480 })
    try {
      await page.locator('[data-testid="state-button"][data-status="answered"]').click()
      await page.locator('[data-lane="status-list"]').waitFor()
      const box = await page.locator('[data-lane="status-list"]').locator('xpath=ancestor::*[contains(@class,"pop")]').boundingBox()
      assert.ok(box.y + box.height <= 480 + 0.5, `el desplegable termina en ${box.y + box.height}, la pantalla mide 480`)
      const link = await page.getByRole('link', { name: /^Ver todos/ }).boundingBox()
      assert.ok(link.y + link.height <= 480, '«Ver todos» queda a la vista')
      const lane = await page.locator('[data-lane="status-list"]').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
      assert.ok(lane.client > 0 && lane.scroll >= lane.client)
    } finally {
      await context.close()
    }
  })
})

describe('sidebar, sign-out and Conexiones (J3-A-45, J3-A-46, J3-A-48, J3-A-49, J3-A-50)', () => {
  test('the sign-out sits at the foot with the size of a target, not at the top beside the name (J3-A-48)', async () => {
    for (const [viewport, min] of [[DESKTOP, 36], [PHONE, 44]]) {
      const { page, context } = await session('ana', viewport)
      try {
        if (viewport === PHONE) await page.getByRole('button', { name: 'Abrir navegación' }).click()
        const logout = page.getByRole('button', { name: 'Cerrar sesión' })
        await logout.waitFor()
        const box = await logout.boundingBox()
        assert.ok(box.height >= min, `«Cerrar sesión» measures ${box.height} px (minimum ${min})`)
        const size = await logout.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
        assert.ok(size >= 14.5, `«Cerrar sesión» is written at ${size} px`)
        const settings = await page.getByRole('link', { name: 'Configuración' }).boundingBox()
        assert.ok(box.y > settings.y, '«Cerrar sesión» sits below «Configuración», at the bottom')
        const name = await page.locator('nav[aria-label="Navegación"]:visible span.font-medium').first().boundingBox()
        assert.ok(box.y > name.y + 200, 'it is no longer next to the name')
      } finally {
        await context.close()
      }
    }
  })

  test('the phone opens the menu with a 44 px button (J3-A-50)', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      const box = await page.getByRole('button', { name: 'Abrir navegación' }).boundingBox()
      assert.ok(box.width >= 44 && box.height >= 44, `the button measures ${box.width}x${box.height}`)
    } finally {
      await context.close()
    }
  })

  test('Conexiones is one entry that moves nothing and says its reason once (J3-A-45, J3-A-46)', async () => {
    const { page, context } = await session('ana')
    try {
      const where = async () => ({
        settings: (await page.getByRole('link', { name: 'Configuración' }).boundingBox()).y,
        logout: (await page.getByRole('button', { name: 'Cerrar sesión' }).boundingBox()).y,
        connections: (await page.getByRole('link', { name: 'Conexiones' }).boundingBox()).y,
      })
      const before = await where()
      await page.getByRole('link', { name: 'Conexiones' }).click()
      await page.getByRole('heading', { name: 'Conexiones', level: 1 }).waitFor()
      assert.deepEqual(await where(), before, 'opening «Conexiones» moves the bar')
      assert.equal(await page.locator('nav[aria-label="Navegación"] a[href^="/connections/"]').count(), 0, 'no submenu')
      assert.equal(await page.getByText('No disponible todavía').count(), 0, 'the row does not repeat the state')
      assert.equal(await page.getByText('Apagadas hasta').count(), 0, 'the owner removed the reason under the title (UD-253)')
      for (const name of ['API', 'MCP', 'Correo', 'WhatsApp', 'GitHub']) await page.getByText(name, { exact: true }).first().waitFor()
    } finally {
      await context.close()
    }
  })

  test('the pending figure is said once, in the top bar: the bell has no count and Mensajes has no badge (J3-A-49, UD-100)', async () => {
    const { page, context } = await session('ana')
    try {
      const summary = await (await page.request.get(`${origin}/api/messages/summary`)).json()
      assert.equal(await page.getByTestId('messages-badge').count(), 0)
      assert.equal((await page.getByTestId('bell').innerText()).trim(), '')
      assert.equal((await page.locator('[data-testid="state-button"][data-status="open"]').innerText()).trim(), String(summary.mine.open))
      const loud = await redFills(page)
      assert.equal(loud.length, 0)
    } finally {
      await context.close()
    }
  })
})

describe('justification by width (J3-A-21, J3-A-47)', () => {
  /** The largest space between two words of a line that is not the paragraph's last, in px. */
  const gaps = (page) =>
    page.evaluate(() => {
      const out = []
      for (const p of document.querySelectorAll('.prose-block')) {
        const range = document.createRange()
        const words = []
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const re = /\S+/g
          for (let m = re.exec(node.data); m; m = re.exec(node.data)) {
            range.setStart(node, m.index)
            range.setEnd(node, m.index + m[0].length)
            words.push(range.getBoundingClientRect())
          }
        }
        const lastTop = words.at(-1)?.top
        for (let i = 0; i < words.length - 1; i++) if (Math.abs(words[i].top - words[i + 1].top) < 2 && Math.abs(words[i].top - lastTop) > 2) out.push({ gap: words[i + 1].left - words[i].right, width: Math.round(p.getBoundingClientRect().width) })
      }
      return out
    })

  async function openLongMessage(page) {
    const hit = await messageByTitle(page, 'Revisar la lectura del panel')
    await page.goto(`${origin}/messages/${hit.id}`)
    await page.locator('main h1').waitFor()
    await settled(page)
  }

  test('on a phone no paragraph is justified and no gap opens beyond the natural space (J3-A-21)', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      await openLongMessage(page)
      const aligns = await page.locator('.prose-block').evaluateAll((els) => els.map((el) => getComputedStyle(el).textAlign))
      assert.ok(aligns.length >= 3)
      assert.ok(aligns.every((a) => a === 'left' || a === 'start'), `it is justified on the phone: ${aligns.join(',')}`)
      const worst = Math.max(...(await gaps(page)).map((g) => g.gap))
      assert.ok(worst <= 5, `gap of ${worst} px between words on the phone`)
      await page.goto(`${origin}/settings`)
      await page.locator('main h1').waitFor()
      await settled(page)
      const settings = await page.locator('.prose-block').evaluateAll((els) => els.map((el) => getComputedStyle(el).textAlign))
      assert.ok(settings.every((a) => a === 'left' || a === 'start'), 'nor in «Configuración»')
    } finally {
      await context.close()
    }
  })

  // UD-309: the thread is the 28 rem column at the right and the fields of the message sit in two columns, so at 1440 px the fields are
  // narrower than the measure; the wide case is read at 1920 px, where each field has room for it.
  test('on a wide desktop each block is justified from the measured width up, and the gap stays within the reference (J3-A-21, UD-034)', async () => {
    const { page, context } = await session('ana', { width: 1920, height: 1080 })
    try {
      await openLongMessage(page)
      // The width the rule reads is the content box: the one the words have.
      const blocks = await page.locator('.prose-block').evaluateAll((els) => els.map((el) => ({ width: el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight), align: getComputedStyle(el).textAlign })))
      assert.ok(blocks.some((b) => b.align === 'justify'), 'at 1920 px there are justified paragraphs')
      const min = 29.2 * 15
      for (const b of blocks) assert.equal(b.align === 'justify', b.width >= min, `a block of ${Math.round(b.width)} px is aligned ${b.align}`)
      // The reference is the largest gap seen at 1440 px (UD-034): 14.2 px at 15 px of type.
      const worst = Math.max(...(await gaps(page)).map((g) => g.gap))
      assert.ok(worst <= 19.5, `gap of ${worst} px between words at 1920 px`)
      // The alignment of a wide block is the hook `--prose-align`: the skin decides it (the default here is justified), and the block
      // that is narrower than the measure stays at the left whatever the skin says.
      const body = page.locator('[data-message-body] .prose-block').first()
      const width = await body.evaluate((el) => el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight))
      assert.equal(await body.evaluate((el) => getComputedStyle(el).textAlign), width >= min ? 'justify' : 'left', `the message body (${Math.round(width)} px)`)
      await page.evaluate(() => document.documentElement.style.setProperty('--prose-align', 'center'))
      const wide = page.locator('.prose-block[data-wide]').first()
      assert.equal(await wide.evaluate((el) => getComputedStyle(el).textAlign), 'center', 'a wide block follows --prose-align')
      assert.equal(await body.evaluate((el) => getComputedStyle(el).textAlign), width >= min ? 'center' : 'left', 'a narrow block ignores it')
    } finally {
      await context.close()
    }
  })
})

describe('Mensajes and the detail (J3-A-16, J3-A-22 to J3-A-29)', () => {
  test('the filter button has no plus and its menu teaches the values of each filter (J3-A-16)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/messages`)
      const button = page.getByRole('button', { name: 'Filtro', exact: true })
      await button.waitFor()
      assert.equal((await button.innerText()).trim(), 'Filtro', 'the button has no +')
      await button.click()
      await page.getByRole('menuitem', { name: 'Estado' }).hover()
      for (const value of ['Abierto', 'Respondido', 'Cerrado']) await page.getByRole('menuitemradio', { name: value }).waitFor()
      await page.getByRole('menuitemradio', { name: 'Abierto' }).click()
      await page.keyboard.press('Escape')
      const applied = page.getByRole('button', { name: /^Filtro, 1 aplicado/ })
      await applied.waitFor()
      await applied.click()
      const state = page.getByRole('menuitem', { name: /^Estado: Abierto/ })
      await state.waitFor()
      assert.match(await state.innerText(), /Abierto/, 'the menu says which filter is on and with what value')
      await state.hover()
      await page.getByRole('menuitem', { name: 'Quitar el filtro' }).click()
      await page.getByRole('button', { name: 'Filtro', exact: true }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('the detail tells the state quietly, labels Deshacer on a desktop and says why there is no reply form (J3-A-24, J3-A-26, J3-A-27, J3-A-28)', async () => {
    const { page, context } = await session('carla')
    try {
      const hit = await messageByTitle(page, 'Revisar la lectura del panel')
      await page.goto(`${origin}/messages/${hit.id}`)
      const h1 = page.locator('main h1')
      await h1.waitFor()
      assert.equal(await h1.evaluate((el) => getComputedStyle(el).textWrap), 'balance', 'the title balances its lines')
      // The area is text with a caret, not a chrome tab that competes with Cerrar.
      const area = page.getByRole('button', { name: /^Área:/ })
      // UD-045: the area is the chip of its color, a flat fill (the same color twice in the gradient), not a tab with a gloss.
      const fill = await area.evaluate((el) => getComputedStyle(el).backgroundImage)
      const [flat] = fill.match(/^linear-gradient\((rgb\([^)]*\)), \1\)/) ?? []
      assert.ok(flat, `the area is a flat chip: ${fill}`)
      // The state is the light and the word, no pill.
      assert.equal(await page.locator('main .led').first().evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
      // Deshacer appears once there is something to undo, with its name on a desktop.
      await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).click()
      const undo = page.getByRole('button', { name: 'Deshacer' }).first()
      await undo.waitFor()
      assert.match((await undo.innerText()).trim(), /Deshacer/, '«Deshacer» shows its name')
      await page.getByRole('button', { name: 'Deshacer' }).first().click()
      // Recipients read as a group introduced by «para».
      assert.ok((await page.getByRole('list', { name: 'Destinatarios' }).innerText()).trim().startsWith('para'))
    } finally {
      await context.close()
    }
  })

  test('a required field that is empty says so in ink, not in red, and the editable fields look editable only for who can edit (J3-A-22, J3-A-23)', async () => {
    const { page, context } = await session('carla')
    try {
      const hit = await messageByTitle(page, 'Revisar la lectura del panel')
      await patchAsSender(page, hit.id, { fields: { summary: '', device: '' } })
      await page.goto(`${origin}/messages/${hit.id}`)
      const required = page.locator('dt', { hasText: 'Obligatorio' }).first()
      await required.locator('span').waitFor()
      const color = await required.locator('span').evaluate((el) => getComputedStyle(el).color)
      const [r, g, b] = color.match(/\d+(\.\d+)?/g).map(Number)
      assert.ok(!(r > g * 2 && r > b * 2), `«Obligatorio» is red: ${color}`)
      // A reader who cannot edit sees the value without the box; who can edit, with it.
      const box = (p) => p.locator('dd [role="button"], dd > span').first().evaluate((el) => getComputedStyle(el).borderTopStyle)
      assert.ok(['dashed', 'solid'].includes(await box(page)), 'the editable field has its border')
      const other = await session('diego')
      try {
        await other.page.goto(`${origin}/messages/${hit.id}`)
        await other.page.locator('main h1').waitFor()
        assert.equal(await other.page.locator('dd [role="button"]').count(), 0, 'whoever does not edit sees no editing controls')
      } finally {
        await other.context.close()
      }
    } finally {
      await context.close()
    }
  })

  test('the reply button is pale only while it has nothing to send (J3-A-29)', async () => {
    const { page, context } = await session('bruno')
    try {
      const hit = await messageByTitle(page, 'Corregir el contraste')
      await page.goto(`${origin}/messages/${hit.id}`)
      const send = page.getByRole('button', { name: 'Responder', exact: true })
      await send.waitFor()
      const opacity = () => send.evaluate((el) => parseFloat(getComputedStyle(el).opacity))
      assert.equal(await send.isDisabled(), true)
      const off = await opacity()
      await page.getByLabel('Respuesta', { exact: true }).fill('Listo.')
      assert.equal(await send.isEnabled(), true)
      assert.ok((await opacity()) > off, `the active button (${await opacity()}) weighs more than the dimmed one (${off})`)
    } finally {
      await context.close()
    }
  })

  test('the reply of the thread does not repeat its media: tiles once, no second row of icons (J3-A-25)', async () => {
    const { page, context } = await session('ana')
    try {
      const hit = await messageByTitle(page, 'Revisar la lectura del panel')
      await page.goto(`${origin}/messages/${hit.id}`)
      const reply = page.locator('section[aria-label="Respuestas"] article').first()
      await reply.waitFor()
      // The pictures are open in their own list and the other media in one named row: two lists at most, and no medium in both.
      const lists = reply.locator('ul[aria-label="Adjuntos"]')
      assert.ok((await lists.count()) <= 2, 'at most the open pictures and one row of the other media')
      const names = await lists.evaluateAll((uls) => uls.flatMap((ul) => [...ul.querySelectorAll('li')].map((li) => li.querySelector('img')?.getAttribute('src') ?? li.textContent.trim())))
      assert.equal(new Set(names).size, names.length, 'no medium is drawn twice in the reply')
      assert.equal(await reply.locator('ul[aria-label="Adjuntos"] li:has(img)').count(), await reply.locator('img').count(), 'the pictures are in the open list only')
    } finally {
      await context.close()
    }
  })
})

describe('Áreas and templates (J3-A-30 to J3-A-38)', () => {
  test('an area with nothing open or answered shows both counts at zero, and its counts are centered on its row (UD-211, UD-041)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas`)
      await page.locator('main section').first().waitFor()
      const rows = await page.locator('main section').evaluateAll((els) =>
        els.map((el) => {
          const box = el.getBoundingClientRect()
          const marks = [...el.querySelectorAll('[data-testid="state-mark"]')]
          const rects = marks.map((m) => m.getBoundingClientRect())
          const top = Math.min(...rects.map((r) => r.top))
          const bottom = Math.max(...rects.map((r) => r.bottom))
          return { text: marks.map((m) => m.textContent.trim()).join(' '), offset: marks.length ? Math.abs((top + bottom) / 2 - (box.top + box.height / 2)) : null }
        }),
      )
      assert.ok(rows.every((r) => r.text !== ''), 'no area leaves its column of counts blank')
      assert.ok(rows.some((r) => /^0 abiertos 0 respondidos$/.test(r.text)), 'an area with no open or answered messages says both at zero')
      assert.ok(rows.every((r) => !/pendiente/i.test(r.text)))
      for (const r of rows.filter((x) => x.offset !== null)) assert.ok(r.offset <= 4, `the counts are ${r.offset} px from the center of their row`)
    } finally {
      await context.close()
    }
  })

  test('the template is a row with its name and its figures, and the window shows what it asks for and what it delivers (J3-A-30, J3-A-31, J3-A-32, UD-297)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas/a-error`)
      await openTemplates(page)
      const card = page.locator('section[aria-label="Plantillas"] [data-template-row]').first()
      await card.waitFor()
      // The row has no description, no tags and no fold: the fields and the instructions are in the window, one hidden level only.
      assert.equal(await card.locator('summary, li').count(), 0, 'a fold or tags inside the row')
      assert.equal(await card.getByText('Formato de salida').count(), 0, 'the instructions are not drawn in the row')
      // Deleting is a quiet button that says its name, at the right of the row.
      const del = card.getByRole('button', { name: /^Borrar/ })
      const title = card.getByTestId('template-open')
      assert.equal((await del.innerText()).trim(), 'Borrar', '«Borrar» says its name: an icon alone is for closing, searching and going back')
      assert.ok((await del.boundingBox()).x > (await title.boundingBox()).x + 200, '«Borrar» sits at the right, away from the name')
      const dialog = await openTemplate(page)
      for (const field of ['Resumen', 'Pasos para reproducir', 'Qué se esperaba']) await dialog.getByText(field, { exact: false }).first().waitFor()
    } finally {
      await context.close()
    }
  })

  test('the window of fields says its state, has one X, and removing a field is a trash can (J3-A-35, J3-A-37)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas/a-error`)
      await openTemplates(page)
      const dialog = await openTemplate(page)
      await dialog.getByText('Sin cambios').waitFor()
      const x = 'M5 5l10 10'
      const paths = (loc) => loc.evaluateAll((els) => els.flatMap((el) => [...el.querySelectorAll('path')].map((p) => p.getAttribute('d'))))
      const removers = dialog.getByRole('button', { name: /^Quitar el campo/ })
      assert.ok((await removers.count()) >= 1)
      assert.ok(!(await paths(removers)).includes(x), 'removing a field does not use the same X as closing the window')
      assert.ok((await paths(dialog.locator('button')).then((p) => p.filter((d) => d === x))).length <= 1, 'a single X in the window')
      await dialog.getByRole('checkbox').first().click()
      await dialog.getByText('Guardado').waitFor()
      assert.equal(await dialog.getByText('Sin cambios').count(), 0)
      // «Campos» is the same heading here and in the form of a new template.
      const heading = await dialog.getByRole('heading', { name: 'Campos' }).evaluate((el) => `${getComputedStyle(el).fontSize}|${getComputedStyle(el).textTransform}|${getComputedStyle(el).letterSpacing}`)
      await page.getByRole('button', { name: 'Listo' }).click()
      await page.getByRole('button', { name: 'Crear plantilla', exact: true }).click()
      const created = page.getByRole('dialog')
      await created.getByRole('heading', { name: 'Campos' }).waitFor()
      const same = await created.getByRole('heading', { name: 'Campos' }).evaluate((el) => `${getComputedStyle(el).fontSize}|${getComputedStyle(el).textTransform}|${getComputedStyle(el).letterSpacing}`)
      assert.equal(same, heading)
      // And a new template starts empty: «Sin campos» and no orphan headings.
      await created.getByText('Sin campos').waitFor()
      assert.equal(await created.getByText('Método').count(), 0)
      assert.equal(await created.getByText('Formato de salida').count(), 0)
    } finally {
      await context.close()
    }
  })
})

describe('Configuración and Equipo (J3-A-39 to J3-A-44)', () => {
  test('the project description is an editor as tall as its text, with no fold and no scroll of its own (J3-A-39, UD-123)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/settings`)
      const editor = page.getByLabel('Proyecto', { exact: true })
      await editor.waitFor()
      assert.equal(await page.getByRole('button', { name: 'Ver todo' }).count(), 0)
      const box = await editor.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, overflow: getComputedStyle(el).overflowY }))
      assert.ok(box.scroll <= box.client + 1 && box.overflow !== 'auto' && box.overflow !== 'scroll', `the editor scrolls on its own: ${JSON.stringify(box)}`)
    } finally {
      await context.close()
    }
  })

  test('any person of the team sees the providers, and so the name of a server variable (J3-A-40, UD-287)', async () => {
    const editor = await session('ana')
    const member = await session('bruno')
    try {
      await editor.page.goto(`${origin}/settings`)
      await editor.page.locator('[data-providers]').waitFor()
      await member.page.goto(`${origin}/settings`)
      await member.page.locator('[data-providers]').waitFor()
      await member.page.getByRole('heading', { name: 'Proveedores' }).first().waitFor({ state: 'attached' })  // the count is read once the element is drawn, never in the frame the page opened (it read 0 under load)
      assert.equal(await member.page.getByRole('heading', { name: 'Proveedores' }).count(), 1)
    } finally {
      await editor.context.close()
      await member.context.close()
    }
  })

  test('Desactivar is quiet, and a profile opens whole in a window (UD-288, J3-A-41, J3-A-42, J3-A-43)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/team`)
      // Desactivar lives in the «Acciones» menu of the row: no button of its own competes with the name or the role.
      assert.equal(await page.getByRole('button', { name: /^Desactivar a/ }).count(), 0, 'no loose «Desactivar» button in the rows')
      await page.getByRole('button', { name: /^Acciones de/ }).first().click()
      const off = page.getByRole('menuitem', { name: /^Desactivar a/ }).first()
      await off.waitFor()
      const weight = await off.evaluate((el) => Number(getComputedStyle(el).fontWeight))
      assert.ok(weight <= 400, `«Desactivar» weighs ${weight}`)
      await page.keyboard.press('Escape')
      const name = await page.getByRole('button', { name: /^Nombre:/ }).first().evaluate((el) => Number(getComputedStyle(el).fontWeight))
      assert.ok(weight < name, 'it weighs less than the name')
      // UD-288: the profile is one line in the row and opens whole in a window over the list; the row keeps its height.
      const row = page.locator('main div.border-b').filter({ hasText: 'ana@dev.invalid' }).first()
      const before = (await row.boundingBox()).height
      assert.equal(await page.getByRole('dialog').count(), 0, 'the profile is closed until it is opened')
      await row.locator('[data-profile-extract]').click()
      const dialog = page.getByRole('dialog')
      await dialog.getByText('No toco la interfaz del panel').waitFor()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden' })
      assert.equal(Math.round((await row.boundingBox()).height), Math.round(before), 'the row did not grow')
    } finally {
      await context.close()
    }
  })

  test('the password forms say the minimum before it is typed and can show what was typed (J3-A-44)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/settings`)
      await page.getByRole('button', { name: 'Cambiar contraseña' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByText('Mínimo 15 caracteres').waitFor()
      const field = dialog.getByLabel('Contraseña nueva')
      assert.equal(await field.getAttribute('type'), 'password')
      await dialog.getByRole('button', { name: 'Mostrar la contraseña' }).last().click()
      assert.equal(await field.getAttribute('type'), 'text')
      await page.keyboard.press('Escape')
      await page.goto(`${origin}/team`)
      await page.getByRole('button', { name: 'Agregar miembro' }).click()
      await page.getByRole('dialog').getByText('Mínimo 15 caracteres').waitFor()
    } finally {
      await context.close()
    }
  })
})

describe('entrance and not found (J3-A-01, J3-A-02, J3-A-03, J3-A-51)', () => {
  test('the mark is the size of an identity, the reason reads, and the card keeps its shape with an error (J3-A-01, J3-A-02, J3-A-03)', async () => {
    const context = await panel.browser.newContext({ viewport: DESKTOP, locale: 'es-CL' })
    const page = await context.newPage()
    try {
      await page.goto(origin)
      const card = page.locator('form')
      await card.waitFor()
      const orb = await card.locator('.orb').boundingBox()
      assert.ok(orb.width >= 24, `the sphere measures ${orb.width} px`)
      const mark = await card.locator('h1 span').last().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      assert.ok(mark >= 18, `the mark measures ${mark} px`)
      const before = await card.boundingBox()
      await page.getByRole('button', { name: 'Entrar' }).click()
      const alert = page.getByRole('alert').filter({ hasText: 'Falta el correo' })
      await alert.waitFor()
      const style = await alert.evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), color: getComputedStyle(el).color }))
      assert.ok(style.size >= 15, `the reason measures ${style.size} px`)
      // Contrast of the reason on the card, measured.
      const ratio = await page.evaluate((color) => {
        const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
        const toRgb = (c) => {
          ctx.clearRect(0, 0, 1, 1)
          ctx.fillStyle = c
          ctx.fillRect(0, 0, 1, 1)
          return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
        }
        const lum = ([r, g, b]) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0)
        // The card is translucent over the pale background: its ink is measured against white, the lightest it can be.
        const [a, b] = [lum(toRgb(color)), lum([255, 255, 255])].sort((x, y) => y - x)
        return (a + 0.05) / (b + 0.05)
      }, style.color)
      assert.ok(ratio >= 4.5, `contrast ${ratio.toFixed(2)}`)
      // The error lives under its field, in a line the form keeps free.
      const email = await page.getByLabel('Correo').boundingBox()
      const said = await alert.boundingBox()
      assert.ok(said.y >= email.y + email.height, 'the error is under its field')
      const after = await card.boundingBox()
      assert.ok(Math.abs(after.height - before.height) < 0.5 && Math.abs(after.y - before.y) < 0.5, 'the card keeps its shape and its place with the errors')
    } finally {
      await context.close()
    }
  })

  test('the not found card is compact (J3-A-51)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/no-existe`)
      const card = page.getByRole('status').first()
      await card.waitFor()
      const box = await card.boundingBox()
      assert.ok(box.height <= 140, `the card measures ${box.height} px`)
    } finally {
      await context.close()
    }
  })
})
