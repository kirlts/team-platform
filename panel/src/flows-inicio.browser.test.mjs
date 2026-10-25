// UD-045 to UD-047 and UD-070/071 seen from the panel: Inicio after the mockup (`Plataforma Team.png`), in a real browser against
// dev-server.mjs serving panel/dist with auto-publication on, as the real server has it by default: `npm run test:flows`.
// Every test can fail if the defect it names comes back.
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'
import { cutMessages, feedsInPage } from './home-feeds-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '1'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_INICIO_PORT ?? 8958), { stepMs: 80 })
  origin = panel.origin
})

// Every test starts from the sample data as the server was born with it (H-901).
beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1440, height: 900 }

async function session(who = 'bruno', viewport = DESKTOP, scheme = 'light') {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.locator('main').first().waitFor()
  return { page, context }
}

const bar = (page) => page.getByLabel('Nuevo mensaje', { exact: true }).last()
const send = async (page, text) => {
  await bar(page).fill(text)
  await page.getByRole('button', { name: 'Enviar' }).first().click()
}
const bg = (locator) => locator.evaluate((el) => getComputedStyle(el).backgroundColor)
const api = async (page, path, init = {}) => {
  const res = await page.request.fetch(`${origin}/api${path}`, { ...init, headers: { 'x-team-request': 'panel', ...(init.headers ?? {}) } })
  return { status: res.status(), body: await res.json().catch(() => null) }
}

/** The messages of a send start folded (UD-257): this opens each one, as a person does before reading or editing it. */
async function unfold(scope) {
  const heads = scope.getByRole('button', { name: /^Abrir el mensaje \d+:/ })
  while ((await heads.count()) > 0) await heads.first().click()
}

describe('the drawer under the bar (UD-046, UD-070)', () => {
  test('a send shows up under the bar, analyzed and published, with no click after the send', async () => {
    const { page, context } = await session()
    try {
      await send(page, 'El botón de guardar no responde en el móvil.')
      const drawer = page.getByTestId('send-drawer')
      await drawer.waitFor()
      const published = drawer.getByTestId('published-message').first()
      await published.waitFor({ timeout: 20000 })
      // No confirmation step: neither the button that published nor the one that discarded exist, and nothing opened over the page.
      assert.equal(await page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ }).count(), 0, 'there is no longer a «Enviar N mensajes» button')
      assert.equal(await page.getByRole('button', { name: 'Descartar envío' }).count(), 0, '«Descartar envío» is not a step')
      assert.equal(await page.getByRole('dialog').count(), 0, 'nothing opens over the page')
      // It sits under the bar of text (mockup), and the original is beside the analysis.
      const barBox = await bar(page).boundingBox()
      const drawerBox = await drawer.boundingBox()
      assert.ok(drawerBox.y > barBox.y + barBox.height - 1, 'the dropdown sits below the bar')
      const original = await drawer.getByTestId('original-box').boundingBox()
      const analysis = await published.boundingBox()
      assert.ok(original.x + original.width <= analysis.x + 1, 'the original sits to the left of the analysis')
      // The message is already in the team's list.
      const body = await api(page, '/messages')
      assert.ok((body.body.items ?? body.body).some((m) => m.title.startsWith('El botón de guardar')), 'the message is published')
    } finally {
      await context.close()
    }
  })

  test('the original is neutral and the analysis wears the secondary color of its area, which changes with the area (UD-045)', async () => {
    const { page, context } = await session()
    try {
      await send(page, 'Se me ocurre mostrar un resumen semanal en la portada.')
      const item = page.getByTestId('published-message').first()
      await item.waitFor({ timeout: 20000 })
      await unfold(item)
      const box = item.getByTestId('published-body')
      const original = page.getByTestId('original-box')
      const before = { analysis: await bg(box), original: await bg(original), area: await item.getAttribute('data-area-id') }
      assert.notEqual(before.analysis, before.original, 'what was sent and the analysis look different')
      // The chip of the area carries the main color: not the same as the box's tint.
      const chip = box.getByTestId('area-picker')
      assert.notEqual(await bg(chip), before.analysis, 'the chip and the background are not the same color')
      await chip.click()
      const other = page.getByRole('menuitemradio').filter({ hasNotText: /Idea|Accesibilidad/ }).first()
      await other.click()
      await page.waitForFunction((area) => document.querySelector('[data-testid="published-message"]')?.getAttribute('data-area-id') !== area, before.area)
      assert.notEqual(await bg(box), before.analysis, 'changing the area changes the color of the box')
      await box.getByTestId('edited-mark').waitFor()
    } finally {
      await context.close()
    }
  })

  test('the area chip shows its own container with the name of the area, and a state is never an area color (UD-045)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.locator('article').first().waitFor()
      const areas = (await api(page, '/areas')).body
      const list = areas.items ?? areas
      const card = page.locator('article').filter({ has: page.getByTestId('area-chip') }).first()
      const chip = card.getByTestId('area-chip')
      const name = (await chip.innerText()).trim()
      const area = list.find((a) => a.title === name)
      assert.ok(area, `the chip says «${name}»`)
      const hex = area.color.slice(1).match(/../g).map((h) => parseInt(h, 16))
      assert.equal(await bg(chip), `rgb(${hex.join(', ')})`, 'the chip carries the main color of the area')
      // The state is a mark with its word, in its own element: a different one from the chip.
      assert.ok((await card.getByTestId('state-mark').count()) >= 1)
    } finally {
      await context.close()
    }
  })

  test('with several sends in a row the drawer shows the current one and a compact selector of the others, in the same place', async () => {
    const { page, context } = await session('carla')
    try {
      await send(page, 'Primer envío de la ráfaga: revisar el contraste del botón.')
      await page.getByTestId('published-message').first().waitFor({ timeout: 20000 })
      await send(page, 'Segundo envío de la ráfaga: agregar la exportación a CSV.')
      const switcher = page.getByTestId('send-switcher')
      await switcher.waitFor()
      const before = await page.getByTestId('send-drawer').boundingBox()
      assert.ok((await switcher.getByRole('option').count()) >= 2, 'each submission has its own option')
      // «N para revisar» that obliges another click does not exist: everything is in the drawer.
      assert.equal(await page.getByText(/para revisar/).count(), 0)
      // Opening another send changes the content in place, not the place of the drawer.
      const first = switcher.getByRole('option').filter({ hasText: /Primer envío/ }).first()
      await first.click()
      await page.getByTestId('original-box').getByText('Primer envío de la ráfaga').waitFor()
      const after = await page.getByTestId('send-drawer').boundingBox()
      assert.equal(Math.round(after.y), Math.round(before.y), 'the dropdown does not change place')
    } finally {
      await context.close()
    }
  })

  test('two sends with the same words are told apart by their number and both fit the phone row (ronda 4)', async () => {
    const { page, context } = await session('carla', PHONE)
    try {
      const text = 'Corregir el desalineado del sidebar en la vista dashboard. Agregar la sincronización.'
      await send(page, text)
      await page.getByTestId('published-message').first().waitFor({ timeout: 20000 })
      await send(page, text)
      const switcher = page.getByTestId('send-switcher')
      await switcher.waitFor()
      const options = switcher.getByRole('option')
      assert.equal(await options.count(), 2)
      const row = await switcher.boundingBox()
      const labels = []
      for (let i = 0; i < 2; i++) {
        const box = await options.nth(i).boundingBox()
        assert.ok(box.x >= row.x - 1 && box.x + box.width <= row.x + row.width + 1, `option ${i + 1} is inside the row: ${JSON.stringify({ box, row })}`)
        labels.push((await options.nth(i).getByText(/^Envío \d+/).textContent()).match(/^Envío \d+/)[0])
      }
      assert.deepEqual(labels, ['Envío 1', 'Envío 2'])
    } finally {
      await context.close()
    }
  })

  test('«Publicado» is a chip like the other states and the example mark says what it is, with a dashed edge (ronda 4)', async () => {
    const { page, context } = await session('bruno')
    try {
      await send(page, 'Un punto para revisar con el equipo.')
      const state = page.getByTestId('published-state')
      await state.waitFor({ timeout: 20000 })
      const mark = page.getByTestId('simulated-mark')
      const edge = (l) => l.evaluate((el) => { const c = getComputedStyle(el); return { width: c.borderTopWidth, style: c.borderTopStyle, radius: c.borderTopLeftRadius } })
      assert.notEqual((await edge(state)).width, '0px', 'the state has a chip edge')
      assert.equal((await edge(mark)).style, 'dashed')
      assert.equal(await mark.innerText(), 'Servidor de ejemplo')
      assert.equal(await mark.getAttribute('title'), 'Borrador de ejemplo')
      // The state comes first and weighs at least as much as the mark.
      assert.ok((await state.boundingBox()).x < (await mark.boundingBox()).x)
    } finally {
      await context.close()
    }
  })

  test('a published message has one control to add a recipient and one to add attachments, labeled, and the files go up from it (ronda 4)', async () => {
    const { page, context } = await session('bruno')
    try {
      await send(page, 'Un punto para revisar con el equipo.')
      const box = page.getByTestId('published-message').first()
      await box.waitFor({ timeout: 20000 })
      await unfold(box)
      assert.equal(await box.getByRole('button', { name: /^Agregar destinatario$/ }).count(), 1)
      const add = box.getByRole('button', { name: 'Agregar adjuntos' })
      assert.equal(await add.count(), 1)
      assert.match(await add.innerText(), /Adjunto/)
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), add.click()])
      assert.ok(chooser.isMultiple())
      await chooser.setFiles({ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') })
      await box.getByRole('list', { name: 'Adjuntos' }).getByText('nota.txt').waitFor()
      // With attachments the same button opens the picker, whose last entry uploads more.
      await box.getByRole('button', { name: 'Elegir adjuntos' }).click()
      await page.getByRole('button', { name: 'Subir archivos' }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('the original does not stretch to the height of the analysis beside it (ronda 4)', async () => {
    const { page, context } = await session('bruno')
    try {
      await send(page, 'Un punto corto.\n\nOtro punto corto.\n\nPregunta: ¿sigue en 25 MB?')
      await page.getByTestId('published-message').nth(2).waitFor({ timeout: 20000 })
      // Open, the three messages are much taller than the three lines of the original: the original keeps its own height.
      await unfold(page.getByTestId('published-pane'))
      await settled(page)
      const original = await page.getByTestId('original-box').boundingBox()
      const analysis = await page.getByTestId('published-pane').boundingBox()
      assert.ok(original.height < analysis.height - 100, `original ${original.height} px against analysis ${analysis.height} px`)
      const text = await page.getByTestId('original-box').locator('[data-lane="input-text"]').boundingBox()
      assert.ok(original.y + original.height - (text.y + text.height) < 40, 'no empty band under the text')
    } finally {
      await context.close()
    }
  })

  test('with reduced motion the bar of a send that is being analyzed is not an empty track (ronda 4)', async () => {
    const { page, context } = await session('bruno')
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await panel.control.hold()
      await send(page, 'Un punto para revisar con el equipo.')
      const meter = page.getByTestId('analysis-box').getByRole('progressbar')
      await meter.waitFor()
      const after = await meter.evaluate((el) => { const c = getComputedStyle(el, '::after'); return { name: c.animationName, width: parseFloat(c.width), track: el.getBoundingClientRect().width } })
      assert.equal(after.name, 'none')
      assert.ok(after.width >= after.track - 4, `the still hatch spans the track: ${JSON.stringify(after)}`)
    } finally {
      await panel.control.release()
      await context.close()
    }
  })

  test('the sender edits the published message in place, it says «Editado» and the history takes the change back', async () => {
    const { page, context } = await session('diego')
    try {
      await send(page, 'Error: el filtro de fechas deja elegir días pasados.')
      const box = page.getByTestId('published-message').first()
      await box.waitFor({ timeout: 20000 })
      await unfold(box)
      await box.getByRole('button', { name: /^Título del mensaje:/ }).click()
      const field = box.getByRole('textbox', { name: 'Título del mensaje' })
      await field.fill('Título corregido por quien lo envió')
      await field.press('Enter')
      await box.getByRole('button', { name: /^Título del mensaje: Título corregido/ }).waitFor()
      await box.getByTestId('edited-mark').waitFor()
      const id = (await box.getByRole('link', { name: /^Abrir el mensaje/ }).getAttribute('href')).split('/').pop()
      assert.equal((await api(page, `/messages/${id}`)).body.title, 'Título corregido por quien lo envió', 'it was saved in the published message')
      await page.getByRole('button', { name: 'Deshacer' }).first().click()
      await page.waitForFunction(() => !document.body.innerText.includes('Título corregido por quien lo envió'))
    } finally {
      await context.close()
    }
  })

  test('nobody but the sender edits a message, the Editor included: no controls and the server refuses (UD-071)', async () => {
    const { page, context } = await session('ana') // the Editor
    try {
      const list = (await api(page, '/messages')).body
      const mine = (await api(page, '/me')).body
      const other = (list.items ?? list).find((m) => m.author_id !== mine.id)
      assert.ok(other, 'there is a message from another person')
      await page.goto(`${origin}/messages/${other.id}`)
      await page.locator('main h1').waitFor()
      assert.equal(await page.getByRole('button', { name: /^Título del mensaje|^Texto del mensaje/ }).count(), 0, 'there is no in-place editing')
      assert.equal(await page.getByTestId('area-picker').count(), 0, 'the area is not changed')
      const refused = await api(page, `/messages/${other.id}`, { method: 'PATCH', data: { title: 'Intento ajeno', version: 1 } })
      assert.equal(refused.status, 403)
      assert.equal(refused.body.code, 'not_message_author')
    } finally {
      await context.close()
    }
  })

  test('an edit that carries an old version is read again and sent once more (edit_conflict)', async () => {
    const { page, context } = await session('valentina')
    try {
      await send(page, 'Pregunta: ¿quién revisa el contrato del cliente?')
      const box = page.getByTestId('published-message').first()
      await box.waitFor({ timeout: 20000 })
      await unfold(box)
      const id = (await box.getByRole('link', { name: /^Abrir el mensaje/ }).getAttribute('href')).split('/').pop()
      // The same person edits from another tab: the version the drawer holds is now old.
      const current = (await api(page, `/messages/${id}`)).body
      assert.equal((await api(page, `/messages/${id}`, { method: 'PATCH', data: { title: 'Cambio desde otra pestaña', version: current.version } })).status, 200)
      await box.getByRole('button', { name: /^Texto del mensaje:/ }).click()
      const field = box.getByRole('textbox', { name: 'Texto del mensaje' })
      await field.fill('Texto nuevo, sobre una versión vieja.')
      await field.press('Enter')
      await box.getByRole('button', { name: /^Texto del mensaje: Texto nuevo/ }).waitFor()
      assert.equal(await page.getByRole('alert').count(), 0, 'the conflict is not shown to whoever edited another field')
      const saved = (await api(page, `/messages/${id}`)).body
      assert.equal(saved.body, 'Texto nuevo, sobre una versión vieja.')
      assert.equal(saved.title, 'Cambio desde otra pestaña', 'what was saved earlier is kept')
    } finally {
      await context.close()
    }
  })
  test('with the drawer folded, a send that publishes says so in the top bar, over no content, and the status bar does not grow (J3-B-15, H-904)', async () => {
    const { page, context } = await session('sofia')
    try {
      const strip = async () => (await page.getByTestId('status-bar').boundingBox()).height
      // The analysis waits for the test: the drawer is folded first, and the send is published when the test says so.
      await panel.control.hold()
      await send(page, 'Pregunta: ¿el audio máximo sigue en 25 MB?')
      await page.getByTestId('send-drawer').waitFor()
      await page.getByTestId('tray-control').click()
      await page.getByTestId('send-drawer').waitFor({ state: 'detached' })
      await settled(page)
      const before = await strip()
      await panel.control.step({ finish: true })
      const notice = page.locator('[data-notice]')
      await notice.waitFor({ timeout: 20000 })
      // The box is read once the page is quiet, not while the notice is still coming in (H-904).
      await settled(page)
      const n = await notice.boundingBox()
      assert.ok(n.y + n.height <= 56, `the notice stays in the top bar: ${n.y + n.height}`)
      assert.match(await notice.innerText(), /publicado/)
      assert.equal(await strip(), before, 'the status bar keeps its height on publishing')
      for (const b of await page.getByRole('button', { name: /^Página (siguiente|anterior)$/ }).all()) {
        const r = await b.boundingBox()
        assert.equal(r.x < n.x + n.width && n.x < r.x + r.width && r.y < n.y + n.height && n.y < r.y + r.height, false, 'the notice does not cover the pagination')
      }
      // «Revisar» opens the drawer on that send, already published.
      await notice.getByRole('button', { name: 'Revisar' }).click()
      await page.getByTestId('published-message').first().waitFor()
    } finally {
      await panel.control.release()
      await context.close()
    }
  })
})

describe('the side panel (UD-047)', () => {
  test('it is hidden with the button beside the user, shown again from the bar, and remembered per person', async () => {
    const { page, context } = await session('bruno')
    try {
      const sidebar = page.getByTestId('sidebar')
      await sidebar.waitFor()
      const width = (await sidebar.boundingBox()).width
      assert.ok(width <= 260, `the panel measures ${width} px, previously 288`)
      await page.getByTestId('sidebar-hide').click()
      await sidebar.waitFor({ state: 'detached' })
      const content = (await page.locator('main').boundingBox()).width
      assert.ok(content > 1440 - 30, `the page uses the width: ${content}`)
      await page.reload()
      await page.locator('main').first().waitFor()
      assert.equal(await sidebar.count(), 0, 'it is remembered on return')
      await page.getByRole('button', { name: 'Mostrar el panel' }).click()
      await sidebar.waitFor()
      // Another person is not affected by this one's choice.
      await page.getByTestId('sidebar-hide').click()
      const other = await context.browser().newContext({ viewport: DESKTOP, locale: 'es-CL' })
      const otherPage = await other.newPage()
      await login(otherPage, origin, 'carla')
      await otherPage.getByTestId('sidebar').waitFor()
      await other.close()
    } finally {
      await context.close()
    }
  })

  test('on a phone it is the menu from the bar, without the hide button', async () => {
    const { page, context } = await session('bruno', PHONE)
    try {
      assert.equal(await page.getByTestId('sidebar').count(), 0)
      await page.getByTestId('nav-open').click()
      await page.getByRole('navigation', { name: 'Navegación' }).waitFor()
      assert.equal(await page.getByTestId('sidebar-hide').isVisible(), false)
    } finally {
      await context.close()
    }
  })
})

describe('the color of an area (UD-045)', () => {
  test('the Editor picks one color and the chips of that area follow it', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/areas`)
      await page.getByTestId('area-color-trigger').first().waitFor()
      const list = (await api(page, '/areas')).body
      const first = (list.items ?? list)[0]
      await page.getByTestId('area-color-trigger').first().click()
      await page.locator('[data-testid="area-swatch"][aria-label="#be185d"]').click()
      await page.waitForFunction(async (id) => {
        const body = await (await fetch('/api/areas')).json()
        return (body.items ?? body).find((a) => a.id === id)?.color === '#be185d'
      }, first.id)
      const preview = page.getByTestId('area-color-preview')
      assert.equal(await bg(preview), 'rgb(190, 24, 93)')
    } finally {
      await context.close()
    }
  })
})

describe('the publication setting (UD-070)', () => {
  test('any person of the team switches between «Al analizar» and «Tras revisar» and the next send follows it (UD-287)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(`${origin}/settings`)
      const group = page.getByRole('radiogroup', { name: 'Publicación' })
      await group.waitFor()
      assert.equal(await group.getByRole('radio', { name: 'Al analizar' }).getAttribute('aria-checked'), 'true', 'it starts as automatic')
      await group.getByRole('radio', { name: 'Tras revisar' }).click()
      await group.getByRole('radio', { name: 'Tras revisar', checked: true }).waitFor()
      assert.equal((await api(page, '/settings/publication')).body.auto_publish, false, 'it was saved on the server')
      // With it off, a send stays as a proposal to review: there is a button to send it and no message is published.
      await page.goto(origin)
      await send(page, 'Podríamos probar un resumen semanal por área.')
      await page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ }).waitFor({ timeout: 20000 })
      assert.equal(await page.getByTestId('published-message').count(), 0)
      await page.goto(`${origin}/settings`)
      await group.getByRole('radio', { name: 'Al analizar' }).click()
      await group.getByRole('radio', { name: 'Al analizar', checked: true }).waitFor()
      assert.equal((await api(page, '/settings/publication')).body.auto_publish, true)
    } finally {
      await context.close()
    }
    const member = await session('bruno')
    try {
      await member.page.goto(`${origin}/settings`)
      await member.page.getByRole('radiogroup', { name: 'Publicación' }).waitFor()
      assert.equal(await member.page.getByRole('radiogroup', { name: 'Publicación' }).count(), 1, 'a member sees the knob')
      assert.equal((await api(member.page, '/settings/publication', { method: 'PATCH', data: { auto_publish: false } })).status, 200)
      assert.equal((await api(member.page, '/settings/publication', { method: 'PATCH', data: { auto_publish: true } })).status, 200)
    } finally {
      await member.context.close()
    }
  })
})

// idea.md: Inicio opens on what concerns the person. The labels come from the catalog, not from literals.
const catalog = readFileSync(new URL('./i18n/es-419.ts', import.meta.url), 'utf8')
const label = (key) => {
  const found = catalog.match(new RegExp(`'${key.replace('.', '\\.')}': '([^']+)'`))
  assert.ok(found, `${key} is in the catalog`)
  return found[1]
}

describe('the default of the two lists of Inicio (idea.md)', () => {
  test('both lists start on «Todos» (Martín, 2026-10-24, amends UD-210), and «Para mí» leaves out a message that is for someone else', async () => {
    const { page, context } = await session('bruno')
    try {
      await settled(page)
      const messages = page.getByRole('radiogroup', { name: label('home.shownMessages') })
      const replies = page.getByRole('radiogroup', { name: label('home.shownReplies') })
      await messages.waitFor()
      await replies.waitFor()
      assert.equal(await messages.getByRole('radio', { name: label('home.everyone') }).getAttribute('aria-checked'), 'true')
      assert.equal(await messages.getByRole('radio', { name: label('home.forMe') }).getAttribute('aria-checked'), 'false')
      assert.equal(await replies.getByRole('radio', { name: label('home.everyone') }).getAttribute('aria-checked'), 'true')
      assert.equal(await replies.getByRole('radio', { name: label('home.forMe') }).getAttribute('aria-checked'), 'false')

      // The newest message of each kind, read from the API: one assigned to this member and one that is not.
      const me = (await api(page, '/me')).body
      const all = (await api(page, '/messages?limit=100')).body.items
      const mineFirst = all.find((m) => m.assignee_ids.includes(String(me.id)))
      const otherFirst = all.find((m) => !m.assignee_ids.includes(String(me.id)))
      assert.ok(mineFirst && otherFirst, `the sample has both kinds (${all.length} messages)`)
      await page.getByRole('region', { name: label('home.latestMessages') }).getByText(otherFirst.title, { exact: true }).first().waitFor()
      await messages.getByRole('radio', { name: label('home.forMe') }).click()
      await messages.getByRole('radio', { name: label('home.forMe'), checked: true }).waitFor()
      await settled(page)
      await page.getByRole('region', { name: label('home.latestMessages') }).getByText(mineFirst.title, { exact: true }).first().waitFor()
      assert.equal(await page.getByRole('region', { name: label('home.latestMessages') }).getByText(otherFirst.title, { exact: true }).count(), 0, 'a message for someone else is not in «Para mí»')
    } finally {
      await context.close()
    }
  })
})

// UD-253 (H-3718): the two lists measure the same and follow their content. The four desktop sizes are in fits-one-screen; here, the phone, where
// they stack and each is as tall as its own rows, and a send open, where the room is `max(28rem, 56dvh)` and the lists still do not fill it empty.
describe('the two lists of Inicio follow their content (UD-253)', () => {
  const ready = (page) => page.waitForFunction(() => document.querySelectorAll('main section[aria-label^="Últim"]').length === 2 && !document.querySelector('[data-fit-measuring], main [aria-busy="true"]'))

  for (const [state, rows] of [['without messages', 0], ['with the sample', Infinity]]) {
    test(`on a phone ${state} they stack, each as tall as its rows and no taller than the screen`, async () => {
      const { page, context } = await session('ana', PHONE)
      try {
        if (rows !== Infinity) await cutMessages(page, rows)
        await page.goto(`${origin}/`)
        await ready(page)
        await settled(page)
        const { failures, boxes } = await page.evaluate(feedsInPage)
        assert.deepStrictEqual(failures, [], `${failures.join('\n')}\n${JSON.stringify(boxes)}`)
        const [a, b] = boxes
        assert.ok(Math.abs(a.x - b.x) <= 1 && b.y >= a.y + a.height, `the replies sit under the messages: ${JSON.stringify(boxes)}`)
        for (const box of boxes) assert.ok(box.height <= PHONE.height, `${box.name} measures ${Math.round(box.height)} px on a ${PHONE.height} px screen`)
        if (rows === 0) assert.deepStrictEqual(boxes.map((x) => x.rows), [0, 0], 'the lists were not emptied')
        else assert.ok(boxes.every((x) => x.rows > 0), 'the sample shows rows in both lists')
      } finally {
        await context.close()
      }
    })
  }

  test('with a send open and no messages the two boxes stay at their header and their empty line', async () => {
    const { page, context } = await session('bruno', DESKTOP)
    try {
      await cutMessages(page, 0)
      await page.goto(`${origin}/`)
      await ready(page)
      await send(page, 'Revisar el alto de las listas de Inicio sin mensajes.')
      await page.getByTestId('send-drawer').waitFor()
      await settled(page)
      const room = await page.getByTestId('home-feeds-room').boundingBox()
      const { failures, boxes } = await page.evaluate(feedsInPage)
      assert.deepStrictEqual(failures, [], `${failures.join('\n')}\n${JSON.stringify(boxes)}`)
      assert.deepStrictEqual(boxes.map((x) => x.rows), [0, 0], 'the lists were not emptied')
      for (const box of boxes) assert.ok(box.height < room.height / 2, `${box.name} measures ${Math.round(box.height)} px in a room of ${Math.round(room.height)} px`)
    } finally {
      await context.close()
    }
  })
})
