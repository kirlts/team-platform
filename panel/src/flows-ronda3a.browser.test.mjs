// Round 3, judge A (J3-A-01 to J3-A-51): each flow reads what the screen shows, in a real browser, against dev-server.mjs
// serving panel/dist: `npm run test:flows`. Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, startPanel, settled, openTemplates } from './browser-support.mjs'

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
  assert.ok(hit, `no hay un mensaje que empiece con «${titleStart}»`)
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
    test(`the bell is the only red fill, with ${who === 'ana' ? 'nine' : 'few'} pending (${scheme})`, async () => {
      const { page, context } = await session(who, DESKTOP, { scheme })
      try {
        await page.getByTestId('attention').waitFor()
        await page.locator('article[data-affects-me]').first().waitFor()
        const reds = await redFills(page)
        assert.equal(reds.length, 1, `rellenos rojos: ${reds.join(', ')}`)
        assert.match(reds[0], /bell/, 'el único relleno rojo es la campana')
        // The marks that are left carry their priority in the shape only: no tinted background, no colored edge.
        const marks = await page.locator('[data-weight="quiet"]').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor))
        assert.ok(marks.length >= 4, 'hay marcas de prioridad que revisar')
        assert.ok(marks.every((c) => c === 'rgba(0, 0, 0, 0)'), `una marca callada tiene fondo: ${marks.join(' | ')}`)
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
      assert.equal(markers, 1, 'la fila dice su prioridad o su estado una vez')
      // The edge on the left is the only color: no element of the row has a colored background.
      // The area chip is the card's tab (UD-045): the one filled mark of a row besides its edge, and the color of the sidebar's area swatches is not a row's.
      assert.deepEqual((await redFills(page)).filter((x) => !/bell/.test(x)), [])
      // No chip in the metadata line: no avatar, no bordered pill besides the buttons, the thumbnail and the area tab of the card (UD-045).
      assert.equal(await row.locator('img[alt]:not([alt=""])').count() <= 1, true)
      const bordered = await row.evaluate((el) => [...el.querySelectorAll('*')].filter((n) => parseFloat(getComputedStyle(n).borderTopWidth) > 0 && getComputedStyle(n).borderTopColor !== 'rgba(0, 0, 0, 0)' && n.getBoundingClientRect().height > 10).map((n) => n.tagName + '.' + String(n.className).slice(0, 30)))
      assert.ok(bordered.filter((b) => !/area-chip/.test(b)).length <= 3, `píldoras con borde en la fila: ${bordered.join(' | ')}`)
      const meta = row.locator('div.flex-wrap').first()
      const items = await meta.evaluate((el) => [...el.children].length)
      assert.ok(items <= 6, `la línea de metadatos tiene ${items} piezas`)
      assert.ok((await row.locator('time').count()) === 1)
      // The thumbnail is smaller than the row's height and does not outweigh the action (J3-A-19).
      const thumb = await row.locator('.frame').first().boundingBox()
      assert.ok(thumb.width <= 40.5, `la miniatura mide ${thumb.width}`)
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
      assert.equal(set.size, 1, `Cerrar cae en columnas distintas: ${[...set].join(', ')}`)
      // The sender's own message has no Responder, and its detail says why.
      const own = await messageByTitle(page, 'Confirmar el formato')
      await page.goto(`${origin}/messages/${own.id}`)
      await page.locator('main h1').waitFor()
      await page.getByText('Lo enviaste tú').waitFor()
      assert.equal(await page.getByRole('button', { name: 'Responder', exact: true }).count(), 0)
    } finally {
      await context.close()
    }
  })

  test('the summary has one style of chip and one kind of label, on one row of areas (J3-A-06)', async () => {
    const { page, context } = await session('ana')
    try {
      const attention = page.getByTestId('attention')
      await attention.waitFor()
      const chips = await attention.locator('[data-testid="state-mark"]:not([data-plain]), [data-testid="area-pending"]').evaluateAll((els) =>
        els.map((el) => {
          const s = getComputedStyle(el)
          return { height: Math.round(el.getBoundingClientRect().height), size: s.fontSize, weight: s.fontWeight, border: s.borderTopWidth, bg: s.backgroundColor }
        }),
      )
      assert.ok(chips.length >= 3)
      // Single-line chips share height, size, weight and edge; a long area name takes a second line and nothing else changes.
      const single = chips.filter((c) => c.height < 32)
      assert.equal(new Set(single.map((c) => `${c.size}|${c.border}|${c.bg}`)).size, 1, JSON.stringify(single))
      assert.ok(Math.max(...single.map((c) => c.height)) - Math.min(...single.map((c) => c.height)) <= 1, `alturas distintas: ${single.map((c) => c.height)}`)
      const labels = await attention.locator('h2').evaluateAll((els) => els.map((el) => ({ size: getComputedStyle(el).fontSize, x: Math.round(el.getBoundingClientRect().left), transform: getComputedStyle(el).textTransform })))
      assert.equal(labels.length, 2)
      assert.equal(new Set(labels.map((l) => `${l.size}|${l.x}|${l.transform}`)).size, 1, JSON.stringify(labels))
    } finally {
      await context.close()
    }
  })

  test('on a phone the areas take one row and the rest open behind «+N» (J3-A-06, J3-A-10)', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      // Every area with something pending, whatever the earlier tests left in the data: the row has to give up some of them.
      const areaList = await (await page.request.get(`${origin}/api/areas`)).json()
      const areas = (areaList.items ?? areaList).map((a) => ({ area_id: a.id, open: 2, answered: 0, closed: 0, mine_open: 1 }))
      await page.route(/\/api\/messages\/summary$/, (route) => route.fulfill({ json: { mine: { open: 1, answered: 0, total: 1 }, items: [], areas } }))
      await page.goto(origin)
      const attention = page.getByTestId('attention')
      await attention.waitFor()
      const more = attention.getByRole('button', { name: /áreas? más|área más/ })
      await more.waitFor()
      const tops = await attention.locator('[data-testid="area-pending"]').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))
      assert.equal(new Set(tops).size, 1, `las áreas ocupan más de una fila: ${tops.join(', ')}`)
      const before = tops.length
      await more.click()
      const after = await attention.locator('[data-testid="area-pending"]').count()
      assert.ok(after > before, `abrir muestra el resto (${before} → ${after})`)
      assert.equal(after, areas.length, 'abierto, están todas')
    } finally {
      await context.close()
    }
  })

  test('on a phone Inicio is one list at a time, paged inside a frame as tall as the screen (J3-A-10)', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      await page.locator('article').first().waitFor()
      await settled(page)
      const height = await page.locator('main').evaluate((el) => el.scrollHeight)
      assert.ok(height < PHONE.height * 2.5, `Inicio mide ${height} px en el teléfono`)
      // The pager is there, so the eight messages are not eight cards of 330 px.
      await page.getByText(/^1–\d+ de \d+$/).first().waitFor()
      const rows = await page.locator('main article').count()
      assert.ok(rows <= 3, `${rows} filas a la vez`)
      // The other list is one tap away.
      await page.getByRole('radio', { name: 'Últimas respuestas' }).click()
      await page.locator('main article').first().waitFor()
      assert.equal(await page.getByRole('heading', { name: 'Últimas respuestas' }).count(), 1)
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
      assert.deepEqual(h, mh, 'el encabezado pesa igual en las dos listas')
      assert.deepEqual(p, mp, 'la línea de apoyo pesa igual en las dos listas')
      assert.match(await first.locator('p').first().innerText(), /^En «/, 'la respuesta dice en qué mensaje está')
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
      assert.ok(n >= 2, `caben ${n} filas`)
      const last = await rows.nth(n - 1).boundingBox()
      const pager = await region.getByText(/^1–\d+ de \d+$/).locator('xpath=..').boundingBox()
      const left = pager.y - (last.y + last.height)
      await region.getByRole('button', { name: 'Página siguiente' }).click()
      await region.locator('article').first().waitFor()
      const next = await region.locator('article').first().boundingBox()
      assert.ok(left < next.height, `quedan ${left} px y la fila siguiente mide ${next.height}: cabía`)
    } finally {
      await context.close()
    }
  })

  test('Inicio has no clock (J3-A-09) and the first stop of the keyboard is the skip link (J3-A-12)', async () => {
    const { page, context } = await session('ana')
    try {
      // The date of the day is in the page (mockup, UD-046); a clock is not: no time of day anywhere in the titles of the page.
      assert.equal(await page.locator('main time[datetime]').filter({ hasText: /\d{1,2}:\d{2}/ }).filter({ hasText: /de 20\d\d/ }).count(), 0, 'no hay fecha y hora corriendo')
      await page.goto(origin)
      await page.locator('main#main').waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Ir al contenido')
      const ring = await page.evaluate(() => parseFloat(getComputedStyle(document.activeElement).outlineWidth))
      assert.ok(ring >= 2, 'el anillo de foco se ve')
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
      assert.ok(rest.height <= 64, `la barra mide ${rest.height} px en reposo`)
      await page.locator('[data-compose-box] textarea').fill('Una línea larga que tiene que ocupar más de un renglón en una pantalla de teléfono para que la barra crezca con lo escrito.')
      const grown = await box.boundingBox()
      assert.ok(grown.height > rest.height + 20, 'crece al escribir')
    } finally {
      await context.close()
    }
  })
})

describe('the bell (J3-A-13, J3-A-14, J3-A-15)', () => {
  test('it lists what it counts, says where the rest is and does not repeat the word on every row', async () => {
    const { page, context } = await session('ana')
    try {
      const total = (await (await page.request.get(`${origin}/api/messages/summary`)).json()).mine.total
      await page.getByTestId('bell').click()
      const list = page.locator('[data-lane="bell-list"]')
      await list.waitFor()
      assert.equal(await list.locator('li').count(), total)
      const seeAll = page.getByRole('link', { name: /^Ver todos/ })
      await seeAll.waitFor()
      assert.equal((await seeAll.innerText()).replace(/\s+/g, ' ').trim(), `Ver todos ${total}`)
      // The state is its shape and its word (UD-041): every row of the bell says «Abierto» or «Respondido».
      const marks = await list.locator('[data-testid="state-mark"]').evaluateAll((els) => els.map((el) => el.textContent.trim()))
      assert.ok(marks.length > 0 && marks.every((t) => t === 'Abierto' || t === 'Respondido'), `estado de las filas de la campana: ${marks.join(',')}`)
      // It opens below the bar with room between them.
      const popover = await page.locator('[data-lane="bell-list"]').locator('xpath=ancestor::*[contains(@class,"pop")]').boundingBox()
      assert.ok(popover.y >= 52 + 6, `la campana se abre a ${popover.y} px, pegada a la barra`)
      await seeAll.click()
      await page.waitForURL(/\/messages\?/)
    } finally {
      await context.close()
    }
  })

  test('on a phone the list fits the screen and scrolls inside, with «Ver todos» in view', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      await page.getByTestId('bell').click()
      await page.locator('[data-lane="bell-list"]').waitFor()
      const box = await page.locator('[data-lane="bell-list"]').locator('xpath=ancestor::*[contains(@class,"pop")]').boundingBox()
      assert.ok(box.y + box.height <= PHONE.height + 0.5, `la campana termina en ${box.y + box.height}, la pantalla mide ${PHONE.height}`)
      const link = await page.getByRole('link', { name: /^Ver todos/ }).boundingBox()
      assert.ok(link.y + link.height <= PHONE.height, '«Ver todos» queda a la vista')
      // Whatever the list needs, the box never outgrows the screen: it either fits or scrolls inside.
      const lane = await page.locator('[data-lane="bell-list"]').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
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
        assert.ok(box.height >= min, `Cerrar sesión mide ${box.height} px (mínimo ${min})`)
        const size = await logout.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
        assert.ok(size >= 14.5, `Cerrar sesión se escribe a ${size} px`)
        const settings = await page.getByRole('link', { name: 'Configuración' }).boundingBox()
        assert.ok(box.y > settings.y, 'Cerrar sesión queda bajo Configuración, al pie')
        const name = await page.locator('nav[aria-label="Navegación"]:visible span.font-medium').first().boundingBox()
        assert.ok(box.y > name.y + 200, 'ya no está junto al nombre')
      } finally {
        await context.close()
      }
    }
  })

  test('the phone opens the menu with a 44 px button (J3-A-50)', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      const box = await page.getByRole('button', { name: 'Abrir navegación' }).boundingBox()
      assert.ok(box.width >= 44 && box.height >= 44, `el botón mide ${box.width}x${box.height}`)
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
      assert.deepEqual(await where(), before, 'abrir Conexiones mueve la barra')
      assert.equal(await page.locator('nav[aria-label="Navegación"] a[href^="/connections/"]').count(), 0, 'sin submenú')
      assert.equal(await page.getByText('No disponible todavía').count(), 0, 'la fila no repite el estado')
      assert.equal(await page.getByText('Apagadas hasta que la descomposición esté probada').count(), 1, 'la razón se dice una vez')
      for (const name of ['API', 'MCP', 'Correo', 'WhatsApp', 'GitHub']) await page.getByText(name, { exact: true }).first().waitFor()
    } finally {
      await context.close()
    }
  })

  test('the number of the bell and the one of Mensajes are the same figure, once each, and only the bell is loud (J3-A-49)', async () => {
    const { page, context } = await session('ana')
    try {
      const summary = await (await page.request.get(`${origin}/api/messages/summary`)).json()
      assert.equal((await page.getByTestId('messages-badge').innerText()).trim(), String(summary.mine.total))
      assert.match((await page.getByTestId('bell').innerText()).trim(), new RegExp(`${summary.mine.total}$`))
      const loud = await redFills(page)
      assert.equal(loud.length, 1)
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
      assert.ok(aligns.every((a) => a === 'left' || a === 'start'), `se justifica en el teléfono: ${aligns.join(',')}`)
      const worst = Math.max(...(await gaps(page)).map((g) => g.gap))
      assert.ok(worst <= 5, `hueco de ${worst} px entre palabras en el teléfono`)
      await page.goto(`${origin}/settings`)
      await page.locator('main h1').waitFor()
      await settled(page)
      const settings = await page.locator('.prose-block').evaluateAll((els) => els.map((el) => getComputedStyle(el).textAlign))
      assert.ok(settings.every((a) => a === 'left' || a === 'start'), 'ni en Configuración')
    } finally {
      await context.close()
    }
  })

  test('on a desktop each block is justified from the measured width up, and the gap stays within the reference (J3-A-21, UD-034)', async () => {
    const { page, context } = await session('ana')
    try {
      await openLongMessage(page)
      // The width the rule reads is the content box: the one the words have.
      const blocks = await page.locator('.prose-block').evaluateAll((els) => els.map((el) => ({ width: el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight), align: getComputedStyle(el).textAlign })))
      assert.ok(blocks.some((b) => b.align === 'justify'), 'a 1440 px hay párrafos justificados')
      const min = 29.2 * 15
      for (const b of blocks) assert.equal(b.align === 'justify', b.width >= min, `un bloque de ${Math.round(b.width)} px se alinea ${b.align}`)
      // The reference is the largest gap seen at 1440 px (UD-034): 14.2 px at 15 px of type.
      const worst = Math.max(...(await gaps(page)).map((g) => g.gap))
      assert.ok(worst <= 19.5, `hueco de ${worst} px entre palabras a 1440 px`)
      const body = await page.locator('[data-lane="message-body"] .prose-block').first().evaluate((el) => ({ width: el.getBoundingClientRect().width, align: getComputedStyle(el).textAlign }))
      assert.equal(body.align, 'justify', `el cuerpo del mensaje (${Math.round(body.width)} px) sigue justificado a 1440 px`)
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
      assert.equal((await button.innerText()).trim(), 'Filtro', 'el botón no lleva un +')
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
      assert.match(await state.innerText(), /Abierto/, 'el menú dice cuál filtro está encendido y con qué valor')
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
      assert.equal(await h1.evaluate((el) => getComputedStyle(el).textWrap), 'balance', 'el título balancea sus renglones')
      // The area is text with a caret, not a chrome tab that competes with Cerrar.
      const area = page.getByRole('button', { name: /^Área:/ })
      assert.equal(await area.evaluate((el) => getComputedStyle(el).backgroundImage), 'none')
      // The state is the light and the word, no pill.
      assert.equal(await page.locator('main .led').first().evaluate((el) => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
      // Deshacer appears once there is something to undo, with its name on a desktop.
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
      const undo = page.getByRole('button', { name: 'Deshacer' }).first()
      await undo.waitFor()
      assert.match((await undo.innerText()).trim(), /Deshacer/, 'Deshacer lleva su nombre a la vista')
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
      assert.ok(!(r > g * 2 && r > b * 2), `«Obligatorio» va en rojo: ${color}`)
      // A reader who cannot edit sees the value without the box; who can edit, with it.
      const box = (p) => p.locator('dd [role="button"], dd > span').first().evaluate((el) => getComputedStyle(el).borderTopStyle)
      assert.ok(['dashed', 'solid'].includes(await box(page)), 'el campo editable lleva su borde')
      const other = await session('diego')
      try {
        await other.page.goto(`${origin}/messages/${hit.id}`)
        await other.page.locator('main h1').waitFor()
        assert.equal(await other.page.locator('dd [role="button"]').count(), 0, 'quien no edita no ve controles de edición')
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
      assert.ok((await opacity()) > off, `el botón activo (${await opacity()}) pesa más que el apagado (${off})`)
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
      assert.ok((await reply.locator('ul[aria-label="Adjuntos"]').count()) <= 1, 'una sola fila de adjuntos por respuesta')
    } finally {
      await context.close()
    }
  })
})

describe('Áreas and templates (J3-A-30 to J3-A-38)', () => {
  test('an area with nothing open or answered says nothing, and its counts are centered on its row (J3-A-33, UD-041)', async () => {
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
      assert.ok(rows.some((r) => r.text === ''), 'un área sin mensajes abiertos ni respondidos no dice «0 abiertos»')
      assert.ok(rows.every((r) => !/^0 /.test(r.text) && !/pendiente/i.test(r.text)))
      for (const r of rows.filter((x) => x.offset !== null)) assert.ok(r.offset <= 4, `los conteos quedan a ${r.offset} px del centro de su fila`)
    } finally {
      await context.close()
    }
  })

  test('the template shows what it asks for and what it tells the model, and its only button names what it opens (J3-A-30, J3-A-31, J3-A-32)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas/a-error`)
      await openTemplates(page)
      const card = page.locator('section[aria-label="Plantillas"] article').first()
      await card.waitFor()
      for (const field of ['Resumen', 'Pasos para reproducir', 'Qué se esperaba']) await card.getByText(field, { exact: false }).first().waitFor()
      const summary = card.locator('summary')
      assert.equal((await summary.innerText()).trim(), 'Instrucciones al modelo')
      assert.equal(await card.getByText('Formato de salida').isVisible(), false, 'las instrucciones nacen plegadas')
      await summary.click()
      await card.getByText('Formato de salida').waitFor()
      const open = card.getByRole('button', { name: 'Campos e instrucciones', exact: true })
      await open.waitFor()
      assert.doesNotMatch(await open.innerText(), /·/, 'sin el «· 1» ambiguo')
      // Deleting is a corner icon away from the title and lighter than it.
      const del = card.getByRole('button', { name: /^Eliminar/ })
      const title = card.getByRole('button', { name: /^Nombre:/ }).first()
      assert.equal((await del.innerText()).trim(), '', 'Eliminar es un ícono con nombre')
      assert.ok((await del.boundingBox()).x > (await title.boundingBox()).x + 200, 'Eliminar queda en la esquina, lejos del título')
      // The column is no longer a lone small card: what it shows is the template, not a link.
      const share = (await card.boundingBox()).height
      assert.ok(share > 200, `la tarjeta de plantilla mide ${share} px`)
    } finally {
      await context.close()
    }
  })

  test('the window of fields says its state, has one X, and removing a field is a trash can (J3-A-35, J3-A-37)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas/a-error`)
      await openTemplates(page)
      await page.getByRole('button', { name: 'Campos e instrucciones', exact: true }).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await dialog.getByText('Sin cambios').waitFor()
      const x = 'M5 5l10 10'
      const paths = (loc) => loc.evaluateAll((els) => els.flatMap((el) => [...el.querySelectorAll('path')].map((p) => p.getAttribute('d'))))
      const removers = dialog.getByRole('button', { name: /^Quitar el campo/ })
      assert.ok((await removers.count()) >= 1)
      assert.ok(!(await paths(removers)).includes(x), 'quitar un campo no usa la misma X que cerrar la ventana')
      assert.ok((await paths(dialog.locator('button')).then((p) => p.filter((d) => d === x))).length <= 1, 'una sola X en la ventana')
      await dialog.getByRole('checkbox').first().click()
      await dialog.getByText('Guardado').waitFor()
      assert.equal(await dialog.getByText('Sin cambios').count(), 0)
      // «Campos» is the same heading here and in the form of a new template.
      const heading = await dialog.getByRole('heading', { name: 'Campos' }).evaluate((el) => `${getComputedStyle(el).fontSize}|${getComputedStyle(el).textTransform}|${getComputedStyle(el).letterSpacing}`)
      await page.getByRole('button', { name: 'Listo' }).click()
      await page.getByRole('button', { name: 'Plantilla', exact: true }).click()
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
  test('the project description folds to a few lines and opens whole on request (J3-A-39)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/settings`)
      const unfold = page.getByRole('button', { name: 'Ver todo' })
      await unfold.waitFor()
      const lane = page.locator('section', { has: page.getByRole('heading', { name: 'Proyecto' }) }).locator('div.glass').first()
      const folded = await lane.boundingBox()
      assert.ok(folded.height <= 9 * 15 + 30, `el proyecto plegado mide ${folded.height} px`)
      await unfold.click()
      await page.getByRole('button', { name: 'Ver menos' }).waitFor()
      assert.ok((await lane.boundingBox()).height > folded.height, 'abierto es más alto')
    } finally {
      await context.close()
    }
  })

  test('only the Editor sees the providers, and so the name of a server variable (J3-A-40)', async () => {
    const editor = await session('ana')
    const member = await session('bruno')
    try {
      await editor.page.goto(`${origin}/settings`)
      await editor.page.getByText('Falta GROQ_API_KEY en el servidor').waitFor()
      await member.page.goto(`${origin}/settings`)
      await member.page.getByRole('heading', { name: 'Cuenta' }).waitFor()
      assert.equal(await member.page.getByText('GROQ_API_KEY').count(), 0)
      assert.equal(await member.page.getByRole('heading', { name: 'Proveedores' }).count(), 0)
    } finally {
      await editor.context.close()
      await member.context.close()
    }
  })

  test('Desactivar is quiet, and a profile shows its first paragraph with the rest one click away (J3-A-41, J3-A-42, J3-A-43)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/team`)
      const off = page.getByRole('button', { name: /^Desactivar a/ }).first()
      await off.waitFor()
      const weight = await off.evaluate((el) => Number(getComputedStyle(el).fontWeight))
      assert.ok(weight <= 400, `Desactivar pesa ${weight}`)
      const name = await page.getByRole('button', { name: /^Nombre:/ }).first().evaluate((el) => Number(getComputedStyle(el).fontWeight))
      assert.ok(weight < name, 'pesa menos que el nombre')
      const more = page.getByRole('button', { name: 'Ver más' }).first()
      await more.waitFor()
      // Ana's own profile has two paragraphs; her row is found by her address, since the button changes its name when it opens.
      const row = page.locator('main div.border-b').filter({ hasText: 'ana@dev.invalid' }).first()
      const before = (await row.boundingBox()).height
      assert.equal(await row.getByText('No toco la interfaz del panel').count(), 0, 'el segundo párrafo está plegado')
      await row.getByRole('button', { name: 'Ver más' }).click()
      await row.getByText('No toco la interfaz del panel').waitFor()
      assert.ok((await row.boundingBox()).height > before)
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
      await page.getByRole('button', { name: 'Miembro' }).click()
      await page.getByRole('dialog').getByText('Mínimo 15 caracteres').waitFor()
    } finally {
      await context.close()
    }
  })
})

describe('entrance and not found (J3-A-01, J3-A-02, J3-A-03, J3-A-51)', () => {
  test('the mark is the size of an identity, the note reads, and the card keeps its shape with an error (J3-A-01, J3-A-02, J3-A-03)', async () => {
    const context = await panel.browser.newContext({ viewport: DESKTOP, locale: 'es-CL' })
    const page = await context.newPage()
    try {
      await page.goto(origin)
      const card = page.locator('form')
      await card.waitFor()
      const orb = await card.locator('.orb').boundingBox()
      assert.ok(orb.width >= 24, `la esfera mide ${orb.width} px`)
      const mark = await card.locator('h1 span').last().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      assert.ok(mark >= 18, `la marca mide ${mark} px`)
      const note = card.getByText('Las cuentas las crea el Editor del equipo')
      const style = await note.evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), color: getComputedStyle(el).color }))
      assert.ok(style.size >= 15, `la nota mide ${style.size} px`)
      // Contrast of the note on the card, measured.
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
      assert.ok(ratio >= 4.5, `contraste ${ratio.toFixed(2)}`)
      // The gap between the password and Entrar is a normal gap of the form, not a reserved row.
      const pass = await page.getByLabel('Contraseña').boundingBox()
      const enter = await page.getByRole('button', { name: 'Entrar' }).boundingBox()
      assert.ok(enter.y - (pass.y + pass.height) <= 24, `hay ${enter.y - (pass.y + pass.height)} px entre la contraseña y Entrar`)
      const before = await card.boundingBox()
      await page.getByRole('button', { name: 'Entrar' }).click()
      await page.getByRole('alert').filter({ hasText: 'Falta el correo' }).waitFor()
      const after = await card.boundingBox()
      assert.ok(Math.abs(after.height - before.height) < 0.5 && Math.abs(after.y - before.y) < 0.5, 'la tarjeta se movió con el error')
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
      assert.ok(box.height <= 120, `la tarjeta mide ${box.height} px`)
    } finally {
      await context.close()
    }
  })
})
