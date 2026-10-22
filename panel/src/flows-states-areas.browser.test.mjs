// UD-041: the three states of a message (abierto, respondido, cerrado) are the only category the interface shows, each with its
// color, and the view of an area opens on its messages. Read in a real browser against dev-server.mjs serving panel/dist:
// `npm run test:flows`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

// These tests go through the review of a proposal, which is what the server does with publication by hand (UD-070): they start it with auto-publication off.
// The automatic path has its own file, `flows-inicio.browser.test.mjs`.
process.env.PANEL_DEV_AUTO_PUBLISH ??= '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_AREAS_PORT ?? 8799), { stepMs: 80 })
  origin = panel.origin
})

// Every test starts from the sample data as the server was born with it (H-901).
beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

const DESKTOP = { width: 1440, height: 900 }
const PHONE = { width: 390, height: 844 }
const csrf = { 'x-team-request': 'panel' }

async function session(who = 'ana', viewport = DESKTOP, scheme = 'light') {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main').first().waitFor()
  return { page, context }
}

const summaryOf = async (page) => (await page.request.get(`${origin}/api/messages/summary`)).json()

describe('the view of an area (UD-041)', () => {
  test('choosing Idea opens its messages first, each with its state, and the back button returns to the list of areas', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas`)
      await page.getByRole('link', { name: 'Abrir Idea' }).click()
      await page.waitForURL(/\/areas\/a-idea$/)
      await page.getByRole('heading', { name: 'Idea', level: 1 }).waitFor()
      const rows = page.locator('main article')
      await rows.first().waitFor()
      const summary = (await summaryOf(page)).areas.find((a) => a.area_id === 'a-idea')
      assert.ok(summary.open + summary.answered + summary.closed > 0, '«Idea» has messages in the development data')
      // Every row names its state with its word; the messages come before the folded sections.
      for (const text of await rows.locator('[data-testid="state-mark"]').allTextContents()) assert.match(text.trim(), /^(Abierto|Respondido|Cerrado)$/)
      const listTop = (await rows.first().boundingBox()).y
      for (const name of ['Descripción', 'Plantillas']) {
        const fold = page.getByRole('button', { name: new RegExp(`^${name}`) })
        assert.equal(await fold.getAttribute('aria-expanded'), 'false', `${name} starts folded`)
        assert.ok((await fold.boundingBox()).y > listTop, `${name} goes below the messages`)
      }
      // The counts of the three states are the ones of the server.
      const tabs = page.getByRole('radiogroup', { name: 'Estado de los mensajes' })
      assert.match(await tabs.getByRole('radio', { name: /Todos/ }).innerText(), new RegExp(`${summary.open + summary.answered + summary.closed}`))
      for (const [status, word] of [['open', 'abierto'], ['answered', 'respondido'], ['closed', 'cerrado']]) {
        const n = summary[status]
        assert.equal((await tabs.getByRole('radio').filter({ hasText: word }).innerText()).trim(), `${n} ${n === 1 ? word : word + 's'}`)
      }
      await page.goBack()
      await page.waitForURL(/\/areas$/)
    } finally {
      await context.close()
    }
  })

  test('filtering by respondido keeps only answered messages and lives in the URL, so the back button works', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      await page.locator('main article').first().waitFor()
      const summary = (await summaryOf(page)).areas.find((a) => a.area_id === 'a-error')
      assert.ok(summary.answered > 0, '«Error» has answered messages in the development data')
      await page.getByRole('radiogroup', { name: 'Estado de los mensajes' }).getByRole('radio').filter({ hasText: 'respondido' }).click()
      await page.waitForURL(/status%3Aeq%3Aanswered|status:eq:answered/)
      await page.locator('main article').first().waitFor()
      // The list keeps the previous rows until the new ones arrive: wait for the filtered list, by what it shows.
      await page.waitForFunction(() => {
        const words = [...document.querySelectorAll('main article [data-testid="state-mark"]')].map((el) => el.textContent.trim())
        return words.length > 0 && words.every((w) => w === 'Respondido')
      })
      // Choosing it again leaves «Todos».
      await page.getByRole('radiogroup', { name: 'Estado de los mensajes' }).getByRole('radio').filter({ hasText: 'respondido' }).click()
      await page.waitForFunction(() => !location.search.includes('status'))
    } finally {
      await context.close()
    }
  })

  test('from the sidebar the area opens on its messages, and its description is edited in place from the fold', async () => {
    const { page, context } = await session()
    try {
      await page.getByRole('navigation', { name: 'Navegación' }).getByRole('link', { name: /^Idea/ }).first().click()
      await page.waitForURL(/\/areas\/a-idea$/)
      await page.locator('main article').first().waitFor()
      await page.getByRole('button', { name: 'Descripción', exact: true }).click()
      assert.ok(await page.locator('[data-slot="area-color"]').count() === 1, 'the place of the color control next to the description remains')
      const field = page.getByText('Una posibilidad sin compromiso de hacerla.').first()
      await field.click()
      await page.keyboard.press('Control+A')
      await page.keyboard.type('Una posibilidad sin compromiso, con su motivo.')
      await page.keyboard.press('Enter')
      await page.getByText('Una posibilidad sin compromiso, con su motivo.').waitFor()
      const areas = await (await page.request.get(`${origin}/api/areas`)).json()
      assert.equal((areas.items ?? areas).find((a) => a.id === 'a-idea').description, 'Una posibilidad sin compromiso, con su motivo.')
      await page.request.patch(`${origin}/api/areas/a-idea`, { data: { description: 'Una posibilidad sin compromiso de hacerla.' }, headers: csrf })
    } finally {
      await context.close()
    }
  })

  test('the area view fits one screen with a section open, on a desktop', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      await page.locator('main article').first().waitFor()
      await page.getByRole('button', { name: /^Plantillas/ }).click()
      await page.getByRole('region', { name: 'Plantillas' }).waitFor()
      await page.getByRole('button', { name: 'Descripción', exact: true }).click()
      const { doc, win } = await page.evaluate(() => ({ doc: document.scrollingElement.scrollHeight, win: innerHeight }))
      assert.ok(doc <= win, `the document measures ${doc} and the window ${win}`)
      const main = await page.locator('main').evaluate((el) => [el.scrollHeight, el.clientHeight])
      assert.ok(main[0] <= main[1] + 1, `main overflows: ${main}`)
    } finally {
      await context.close()
    }
  })
})

describe('areas: list and view layout (H-2900 to H-2906)', () => {
  const PHONE_LONG = 'Accesibilidad y experiencia de uso en dispositivos móviles'

  test('the counts of every area sit in one column right after the name, on a desktop and on a phone, and the chevron stays whole next to the name', async () => {
    for (const [viewport, maxGap] of [[DESKTOP, 340], [PHONE, 260]]) {
      const { page, context } = await session('ana', viewport)
      try {
        await page.goto(`${origin}/areas`)
        await page.locator('main section a[aria-label^="Abrir"]').first().waitFor()
        const rows = await page.evaluate(() =>
          [...document.querySelectorAll('main section')]
            .filter((r) => r.querySelector('a[aria-label^="Abrir"]'))
            .map((r) => {
              const name = r.querySelector('a[aria-label^="Abrir"]')
              const nameBox = name.getBoundingClientRect()
              const chevron = name.querySelector('svg').getBoundingClientRect()
              const marks = [...r.querySelectorAll('[data-testid="state-mark"]')].map((m) => m.getBoundingClientRect())
              return { title: name.getAttribute('aria-label'), nameLeft: nameBox.left, chevronW: chevron.width, markLeft: marks[0]?.left ?? null, markRight: marks[0]?.right ?? null }
            }),
        )
        assert.ok(rows.length >= 5, 'the sample areas are listed')
        const withCounts = rows.filter((r) => r.markLeft !== null)
        assert.ok(withCounts.length >= 3)
        const lefts = withCounts.map((r) => r.markLeft)
        assert.ok(Math.max(...lefts) - Math.min(...lefts) <= 1, `the counts share a left edge at ${viewport.width}: ${lefts}`)
        for (const r of withCounts) assert.ok(r.markLeft - r.nameLeft <= maxGap, `${r.title}: counts ${Math.round(r.markLeft - r.nameLeft)} px from the name at ${viewport.width}`)
        for (const r of rows) assert.ok(r.chevronW >= 14, `${r.title}: the chevron measures ${r.chevronW} px`)
      } finally {
        await context.close()
      }
    }
  })

  test('the long name keeps its chevron glued to the last word', async () => {
    const { page, context } = await session('ana', PHONE)
    try {
      await page.goto(`${origin}/areas`)
      const link = page.getByRole('link', { name: `Abrir ${PHONE_LONG}` })
      await link.waitFor()
      const gap = await link.evaluate((a) => {
        const tail = a.querySelector('span')
        const svg = a.querySelector('svg').getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(tail.firstChild)
        const word = range.getBoundingClientRect()
        return { gap: svg.left - word.right, w: svg.width, sameLine: Math.abs((svg.top + svg.bottom) / 2 - (word.top + word.bottom) / 2) <= 8 }
      })
      assert.ok(gap.w >= 14 && gap.gap >= 0 && gap.gap <= 8 && gap.sameLine, JSON.stringify(gap))
    } finally {
      await context.close()
    }
  })

  test('the area view has its folded sections right under the messages, with no void between', async () => {
    const { page, context } = await session()
    try {
      await page.goto(`${origin}/areas/a-error`)
      const rows = page.locator('main article')
      await rows.first().waitFor()
      await settled(page)
      const last = (await rows.last().boundingBox())
      // With more messages than fit, the pager strip ends the list (UD-241 cards are 152 px tall: four no longer fit in 900 px); the section sits right under it.
      const pager = page.locator('main').getByText(/^\d+–\d+ de \d+$/).first()
      const end = (await pager.count()) > 0 ? await pager.evaluate((el) => el.parentElement.getBoundingClientRect().bottom) : last.y + last.height
      const fold = await page.getByRole('button', { name: 'Descripción', exact: true }).boundingBox()
      assert.ok(fold.y - end <= 28, `${Math.round(fold.y - end)} px between the last message and the first section`)
    } finally {
      await context.close()
    }
  })

  test('the four state filters live in one container and, on a phone, make two equal rows', async () => {
    for (const viewport of [DESKTOP, PHONE]) {
      const { page, context } = await session('ana', viewport)
      try {
        await page.goto(`${origin}/areas/a-error`)
        const group = page.getByRole('radiogroup', { name: 'Estado de los mensajes' })
        await group.waitFor()
        const info = await group.evaluate((g) => {
          const box = g.getBoundingClientRect()
          const radios = [...g.querySelectorAll('[role="radio"]')].map((r) => r.getBoundingClientRect())
          const style = getComputedStyle(g)
          return { box: { l: box.left, r: box.right }, radios: radios.map((r) => ({ top: Math.round(r.top), l: r.left, r: r.right })), bordered: parseFloat(style.borderTopWidth) > 0 || style.boxShadow !== 'none' || style.backgroundColor !== 'rgba(0, 0, 0, 0)' }
        })
        assert.equal(info.radios.length, 4)
        assert.ok(info.bordered, 'the container is drawn, so the four read as controls')
        for (const r of info.radios) assert.ok(r.l >= info.box.l - 1 && r.r <= info.box.r + 1, `a filter leaves its container at ${viewport.width}: ${JSON.stringify(info)}`)
        const rowsOf = Object.values(Object.groupBy(info.radios, (r) => r.top))
        if (viewport.width < 768) assert.deepEqual(rowsOf.map((x) => x.length), [2, 2], `two rows of two: ${JSON.stringify(info.radios)}`)
        else assert.equal(rowsOf.length, 1, 'one row on a desktop')
        // The view the person is already in drops the area chip of its rows; Mensajes keeps it.
        await page.locator('main article').first().waitFor()
        assert.equal(await page.getByTestId('area-chip').count(), 0, 'the rows of an area do not repeat the area')
        await page.goto(`${origin}/messages`)
        await page.locator('main article').first().waitFor()
        assert.ok((await page.getByTestId('area-chip').count()) > 0, 'Mensajes keeps the chip of the area')
      } finally {
        await context.close()
      }
    }
  })
})

describe('the state a message is served with (UD-042)', () => {
  test('every message the API serves has the state its replies and its closing mark give: without replies open, with replies answered, closed only when closed', async () => {
    const { page, context } = await session()
    try {
      const body = await (await page.request.get(`${origin}/api/messages?limit=100`)).json()
      const items = body.items ?? body
      assert.ok(items.length > 10, 'there are sample messages to review')
      const wrong = items.filter((m) => m.status !== (m.status === 'closed' ? 'closed' : m.reply_count > 0 ? 'answered' : 'open'))
      assert.deepEqual(wrong.map((m) => `${m.title}: ${m.status} con ${m.reply_count} respuestas`), [])
      assert.ok(items.some((m) => m.status === 'closed') && items.some((m) => m.status === 'answered') && items.some((m) => m.status === 'open'), 'the three states are seeded')
      // The state of a message that gets a reply, and then is closed and reopened, follows the same rule through the API.
      const open = items.find((m) => m.status === 'open' && m.author_id !== 'u-ana')
      const reply = await page.request.post(`${origin}/api/messages/${open.id}/replies`, { data: { body: 'listo', kind: 'answer' }, headers: csrf })
      assert.equal(reply.status(), 201)
      const state = async () => (await (await page.request.get(`${origin}/api/messages/${open.id}`)).json()).status
      assert.equal(await state(), 'answered')
      await page.request.post(`${origin}/api/messages/${open.id}/close`, { headers: csrf })
      assert.equal(await state(), 'closed')
      await page.request.post(`${origin}/api/messages/${open.id}/reopen`, { headers: csrf })
      assert.equal(await state(), 'answered')
    } finally {
      await context.close()
    }
  })
})

describe('colors and words of the states (UD-041)', () => {
  test('open is red, answered is yellow and closed is blue, always with their word', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('main article').first().waitFor()
      const probe = (status) =>
        page.evaluate((s) => {
          const p = document.createElement('i')
          p.setAttribute('data-status', s)
          p.setAttribute('data-weight', 'quiet')
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          p.append(svg)
          document.body.append(p)
          const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
          ctx.fillStyle = getComputedStyle(svg).color
          ctx.fillRect(0, 0, 1, 1)
          const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
          p.remove()
          return { r, g, b }
        }, status)
      const open = await probe('open')
      const answered = await probe('answered')
      const closed = await probe('closed')
      assert.ok(open.r > open.g * 1.8 && open.r > open.b * 1.8, `open is not red: ${JSON.stringify(open)}`)
      assert.ok(answered.r > answered.b * 1.8 && answered.g > answered.b * 1.8, `answered is not yellow: ${JSON.stringify(answered)}`)
      assert.ok(closed.b > closed.r * 1.3 && closed.b > closed.g, `closed is not blue: ${JSON.stringify(closed)}`)
      // The edge of a row is the color of its state, and the row carries the word of the same state.
      const edges = await page.locator('main article').evaluateAll((els) =>
        els.map((el) => ({ status: el.querySelector('[data-testid="state-mark"]')?.getAttribute('data-status'), word: el.querySelector('[data-testid="state-mark"]')?.textContent.trim(), shadow: getComputedStyle(el).boxShadow })),
      )
      assert.ok(edges.length > 0)
      for (const e of edges) {
        assert.equal(e.word, { open: 'Abierto', answered: 'Respondido', closed: 'Cerrado' }[e.status])
        assert.notEqual(e.shadow, 'none')
      }
      const byStatus = new Map()
      for (const e of edges) byStatus.set(e.status, e.shadow)
      assert.equal(new Set(byStatus.values()).size, byStatus.size, 'each state has its own border color')
    } finally {
      await context.close()
    }
  })

  test('no screen shows a word of the retired categories (Por atender, Pendiente, Novedad, To do, Pending)', async () => {
    const RETIRED = /por atender|pendientes?\b|novedad|\bto do\b|\bpending\b/i
    for (const viewport of [DESKTOP, PHONE]) {
      const { page, context } = await session('ana', viewport)
      try {
        for (const path of ['/', '/messages', '/areas', '/areas/a-error', '/team']) {
          await page.goto(`${origin}${path}`)
          await page.locator('main').first().waitFor()
          await settled(page)
          // The chrome of every screen: navigation, header, counts and states. The texts people wrote are data.
          const words = await page.evaluate(() => [...document.querySelectorAll('nav, header, h1, h2, [data-testid="status-bar"], [data-testid="state-mark"], [data-testid="area-pending"], [aria-label]')].flatMap((el) => [el.textContent ?? '', el.getAttribute('aria-label') ?? '']).join(' | '))
          assert.doesNotMatch(words, RETIRED, `${path} (${viewport.width}): ${words.match(RETIRED)?.[0]}`)
        }
        if (viewport.width > 768) {
          await page.goto(origin)
          await page.getByTestId('state-button').first().click()
          const popover = await page.getByTestId('status-menu').innerText()
          assert.doesNotMatch(popover, RETIRED)
        }
      } finally {
        await context.close()
      }
    }
  })
})
