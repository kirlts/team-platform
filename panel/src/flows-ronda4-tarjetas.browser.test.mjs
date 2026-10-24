// Round 4, cards, lists and the reply flow (J4 findings of home, messages, message-detail and flow-reply-close): each test reads what
// the screen shows, in a real browser, against dev-server.mjs serving panel/dist: `npm run test:flows`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_PORT ?? 8806), { stepMs: 80 })
  origin = panel.origin
})
beforeEach(async () => {
  await panel.control.reset()
})
after(async () => {
  await panel?.stop()
})

const PHONE = { width: 390, height: 844 }

async function session(who = 'ana', viewport = { width: 1440, height: 900 }, { mobile = false, scheme = 'light' } = {}) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

async function messageByTitle(page, titleStart) {
  const body = await (await page.request.get(`${origin}/api/messages`)).json()
  const list = Array.isArray(body) ? body : body.items
  const hit = list.find((m) => m.title.startsWith(titleStart))
  assert.ok(hit, `no message starts with «${titleStart}»`)
  return hit
}

async function openMessage(page, titleStart) {
  const hit = await messageByTitle(page, titleStart)
  await page.goto(`${origin}/messages/${hit.id}`)
  await page.locator('main h1').waitFor()
  return hit
}

/** Every row of the visible list with the boxes of its parts. */
const rows = (page) =>
  page.locator('article[data-affects-me], article[data-closed], main article').evaluateAll((articles) =>
    articles
      .filter((a) => a.querySelector('[data-testid="area-chip"]'))
      .map((a) => {
        const box = (el) => (el ? el.getBoundingClientRect().toJSON() : null)
        const heading = a.querySelector('h3')
        // The widest line of the title: the line boxes of its text.
        const range = document.createRange()
        range.selectNodeContents(heading)
        const lines = new Map()
        for (const r of range.getClientRects()) lines.set(Math.round(r.top), Math.max(lines.get(Math.round(r.top)) ?? 0, r.right))
        const actions = [...a.querySelectorAll('a, button')].filter((x) => /^(Responder|Cerrar|Reabrir)$/.test(x.textContent.trim()))
        return {
          chip: box(a.querySelector('[data-testid="area-chip"]')),
          heading: box(heading),
          lineCount: lines.size,
          widest: Math.max(...lines.values()),
          state: box(a.querySelector('[data-testid="state-mark"]')),
          reply: box(actions.find((x) => x.textContent.trim() === 'Responder')),
          actions: actions.map((x) => x.getBoundingClientRect().toJSON()),
          textWrap: getComputedStyle(heading).textWrap,
          article: box(a),
        }
      }),
  )

describe('Inicio (J4 home)', () => {
  test('the state is not in the row of «Responder», the area chip sits under the title on the line of the state and the title uses the width (J4-home-02, -04; UD-241 amends J4-home-03)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(origin)
      await page.getByRole('heading', { name: 'Últimos mensajes' }).waitFor()
      await page.locator('[data-testid="area-chip"]').first().waitFor()
      const list = await rows(page)
      assert.ok(list.length >= 2, `${list.length} rows drawn`)
      for (const r of list) {
        // UD-241: the heading comes first; the chip is on the line of the state, under the extract, at the same x as the heading.
        assert.ok(r.chip.top >= r.heading.bottom - 1, `the chip (top ${r.chip.top}) is not under the title (bottom ${r.heading.bottom})`)
        assert.ok(Math.abs(r.state.left - r.heading.left) <= 1, `the state (left ${r.state.left}) is not aligned with the title (left ${r.heading.left})`)
        // After the state on its line; an area name too long for a half column of Inicio wraps under it, never cut (UD-016).
        assert.ok(r.chip.left > r.state.right || r.chip.top >= r.state.bottom - 1, `the chip (left ${r.chip.left}, top ${r.chip.top}) is not after the state (right ${r.state.right}, bottom ${r.state.bottom})`)
        assert.ok(r.heading.height < 30, `the title box is ${Math.round(r.heading.height)} px tall: UD-241 gives it one line, ended with an ellipsis`)
        if (r.reply) assert.ok(r.state.top < r.reply.top - 8, `the state (${r.state.top}) is not above the row of «Responder» (${r.reply.top})`)
      }
    } finally {
      await context.close()
    }
  })

  test('on a phone both lists are drawn one under the other, with no switch between them, and each filter is a quiet text switch (UD-253, J4-home-05)', async () => {
    const { page, context } = await session('ana', PHONE, { mobile: true })
    try {
      await page.goto(origin)
      const filter = page.getByRole('radiogroup', { name: /^Mensajes mostrados/ })
      await filter.waitFor()
      assert.equal(await page.getByRole('radiogroup', { name: 'Lista mostrada' }).count(), 0, 'no switch between the two lists: they are stacked (H-3718)')
      await page.getByRole('heading', { name: 'Últimas respuestas' }).waitFor()
      const bg = (l) => l.evaluate((el) => getComputedStyle(el).backgroundColor)
      const radius = (l) => l.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)
      assert.equal(await bg(filter), 'rgba(0, 0, 0, 0)', 'the filter has no well')
      assert.equal(await radius(filter), '0px', 'the filter has no pill')
      const chosen = filter.getByRole('radio', { checked: true })
      assert.equal(await chosen.evaluate((el) => getComputedStyle(el).borderBottomWidth), '2px', 'the chosen option is underlined')
    } finally {
      await context.close()
    }
  })
})

describe('Mensajes (J4 messages)', () => {
  test('in every row the state opens the metadata line and the actions stay on their own, so a row without «Responder» leaves no loose state (J4-messages-03, -04)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('[data-testid="area-chip"]').first().waitFor()
      const list = await rows(page)
      assert.ok(list.length >= 2, `${list.length} rows drawn`)
      for (const r of list) {
        // Wide: the actions have their own column to the right of the state; narrow: they are on a later line. Either way they never share a row with it.
        const first = r.actions.reduce((x, y) => (x.left < y.left ? x : y))
        assert.ok(r.state.right <= first.left || r.state.bottom <= first.top, 'the state sits in the row of the actions')
        for (const a of r.actions) assert.ok(!(r.state.bottom > a.top && r.state.top < a.bottom && r.state.left < a.right && a.left < r.state.right), 'the state overlaps an action')
      }
    } finally {
      await context.close()
    }
  })

  test('on a phone the count of replies shares a line with other data of the row (J4-messages-02)', async () => {
    const { page, context } = await session('ana', PHONE, { mobile: true })
    try {
      await page.goto(`${origin}/messages`)
      await page.locator('[data-testid="area-chip"]').first().waitFor()
      // UD-241: the count sits in the line of who and when (`card-who`), with the media icons as one unit; any other datum of that line at the same height is company.
      const alone = await page.locator('article span[title$="respuestas"], article span[title$="respuesta"]').evaluateAll((counts) =>
        counts.filter((c) => {
          const top = c.getBoundingClientRect().top
          const line = c.closest('[data-testid="card-who"]')
          return ![...line.querySelectorAll('*')].some((o) => o !== c && !o.contains(c) && !c.contains(o) && o.getBoundingClientRect().height > 0 && Math.abs(o.getBoundingClientRect().top - top) < 8)
        }).length,
      )
      assert.equal(alone, 0, `${alone} counts of replies are alone on their line`)
    } finally {
      await context.close()
    }
  })
})

describe('the detail and the reply flow (J4 message-detail, flow-reply-close)', () => {
  test('the reply form has no type selector, and «Cerrar» sits with «Responder» (J4-flow-02)', async () => {
    const { page, context } = await session('bruno')
    try {
      await openMessage(page, 'Revisar la lectura')
      await page.getByRole('textbox', { name: 'Respuesta' }).waitFor()
      assert.equal(await page.getByRole('radiogroup', { name: 'Tipo de respuesta' }).count(), 0, 'the person does not choose a type')
      const send = await page.getByRole('button', { name: 'Responder', exact: true }).boundingBox()
      const close = await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).boundingBox()
      assert.ok(Math.abs(close.y - send.y) < 8, `«Cerrar» is ${Math.abs(close.y - send.y)} px from «Responder»`)
      assert.equal(await page.getByRole('main').getByRole('button', { name: 'Cerrar mensaje', exact: true }).count(), 1, 'one «Cerrar» in the page')
    } finally {
      await context.close()
    }
  })

  test('the area chip keeps its color and is lighter than the bold state it sits beside (J4-detail-02, UD-045)', async () => {
    const { page, context } = await session('bruno')
    try {
      await openMessage(page, 'Revisar la lectura')
      const chip = page.getByTestId('area-chip').first()
      const fill = await chip.evaluate((el) => getComputedStyle(el).backgroundColor)
      assert.ok(fill !== 'rgba(0, 0, 0, 0)' && !/, 0\)$/.test(fill), `the chip has its color: ${fill}`)
      assert.equal(await chip.evaluate((el) => getComputedStyle(el).fontWeight), '600')
      const state = page.locator('main .led').first()
      const size = (l) => l.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      assert.ok((await size(state)) >= (await size(chip)) + 0.5, 'the state is not smaller than the chip')
    } finally {
      await context.close()
    }
  })

  test('in the dark theme «Ampliar» is opaque (J4-detail-03)', async () => {
    const { page, context } = await session('bruno', { width: 1440, height: 900 }, { scheme: 'dark' })
    try {
      await openMessage(page, 'Revisar la lectura')
      const zoom = page.getByRole('button', { name: 'Ampliar' }).first()
      await zoom.waitFor()
      const alpha = await zoom.evaluate((el) => {
        const c = getComputedStyle(el).backgroundColor
        const m = c.match(/[\d.]+/g).map(Number)
        return m.length === 4 ? m[3] : 1
      })
      assert.equal(alpha, 1, 'the button over the photo is translucent')
    } finally {
      await context.close()
    }
  })

  test('sending a reply says so in the form, the attachments of a reply carry their names and closing explains why the field is gone (J4-flow-01, -04, -05)', async () => {
    const { page, context } = await session('bruno')
    try {
      await openMessage(page, 'Revisar la lectura')
      // The replies of the sample carry a document, an audio and a link: each one is told by its name.
      const strip = page.getByRole('list', { name: 'Adjuntos' })
      assert.ok(await strip.count() >= 1)
      assert.ok((await page.locator('section[aria-label="Respuestas"]').innerText()).includes('feedback-cliente.docx'), 'the document of a reply has no name beside it')
      assert.ok((await page.locator('section[aria-label="Respuestas"]').innerText()).includes('https://github.com'), 'the link of a reply has no address beside it')
      await page.getByRole('textbox', { name: 'Respuesta' }).fill('Confirmado, queda para esta semana.')
      await page.getByRole('button', { name: 'Responder', exact: true }).click()
      await page.getByRole('status').filter({ hasText: 'Respuesta enviada' }).waitFor()
      await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).click()
      const note = page.getByRole('status').filter({ hasText: 'Cerrado: no admite respuestas' })
      await note.waitFor()
      assert.equal(await page.getByRole('textbox', { name: 'Respuesta' }).count(), 0, 'the field stays after closing')
      await note.getByRole('button', { name: 'Reabrir' }).waitFor()
    } finally {
      await context.close()
    }
  })
})
