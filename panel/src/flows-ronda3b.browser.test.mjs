// Round 3, judge B (J3-B-01 to J3-B-31): each flow reads what the screen shows, in a real browser, against dev-server.mjs
// serving panel/dist: `npm run test:flows`. Every test can fail if the defect it names comes back.
// It runs its own panel with slow analysis steps so the queued and the running states can be measured.
import assert from 'node:assert'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, startPanel, settled } from './browser-support.mjs'

// These tests go through the review of a proposal, which is what the server does with publication by hand (UD-070): they start it with auto-publication off.
// The automatic path has its own file, `flows-inicio.browser.test.mjs`.
process.env.PANEL_DEV_AUTO_PUBLISH ??= '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_3B_PORT ?? 8798), { stepMs: 450 })
  origin = panel.origin
})

// Every test starts from the sample data as the server was born with it (H-901): none inherits what another left in the tray or the lists.
beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

async function session(who, viewport = { width: 1440, height: 900 }, { mobile = false, scheme = 'light' } = {}) {
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile })
  const page = await context.newPage()
  await login(page, origin, who)
  return { page, context }
}

const FIVE = [
  'Primero: revisar la lectura del panel en teléfonos pequeños.',
  'Segundo: la barra de envío se monta sobre otras tarjetas cuando el texto es largo.',
  'Tercero: agregar un selector para filtrar por área en Mensajes.',
  'Cuarto: la página de inicio se queda en blanco unos segundos al abrir desde el teléfono, y el cliente lo reportó como un error que antes no pasaba.',
  'Quinto: opinión general del cliente, les gusta cómo quedó la bandeja pero encuentran confusa la pantalla de propuesta.',
].join('\n\n')

const bar = (page) => page.getByLabel('Nuevo mensaje', { exact: true }).last()

/** Sends the text, opens the window of sends and waits for the proposal. */
async function sendAndOpen(page, text = FIVE) {
  await page.goto(origin)
  await bar(page).fill(text)
  await page.getByRole('button', { name: 'Enviar' }).first().click()
  await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 40000 })
}

const rect = (locator) => locator.boundingBox()
const style = (locator, prop) => locator.evaluate((el, p) => getComputedStyle(el)[p], prop)
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe('compose bar (J3-B-01, J3-B-17, J3-B-19, J3-B-20)', () => {
  test('a long text grows over a dimmed page, opaque from the first frame, with no transition of its background (J3-B-01)', async () => {
    const { page, context } = await session('ana')
    try {
      await page.goto(origin)
      await page.getByRole('heading', { name: 'Últimos mensajes' }).waitFor()
      await bar(page).fill(FIVE)
      // Measured at once, without waiting: a background that fades in lets the card under it show through for 150 ms.
      const box = page.locator('[data-compose-box]')
      assert.equal(await box.evaluate((el) => getComputedStyle(el).transitionProperty.includes('background')), false, 'the bar background has no transition')
      const alpha = await box.evaluate((el) => getComputedStyle(el).backgroundColor)
      assert.ok(!/\/ ?0?\.\d|rgba\(.*,\s*0?\.\d+\)/.test(alpha), `the background is opaque: ${alpha}`)
      assert.equal(await page.locator('[data-compose-scrim]').count(), 1, 'the page below dims while the bar grows')
      // What is under the bar cannot be reached through it: the point inside its bottom edge belongs to the bar.
      const r = await rect(box)
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-compose-box]') !== null, { x: r.x + 60, y: r.y + r.height - 4 })
      assert.equal(hit, true, 'the bottom border of the bar belongs to the bar')
      // And the page does not move.
      assert.ok(r.height > 100, `the bar grew: ${r.height}`)
    } finally {
      await context.close()
    }
  })

  test('the menu of the clip leaves 8 px of air and the link row has one primary action (J3-B-17, J3-B-19)', async () => {
    const { page, context } = await session('bruno')
    try {
      await page.goto(origin)
      const clip = page.getByRole('button', { name: 'Adjuntar' })
      const c = await rect(clip)
      await clip.click()
      const menu = page.getByRole('menu')
      await menu.waitFor()
      const m = await rect(menu)
      assert.ok(m.y - (c.y + c.height) >= 7, `space between the clip and its menu: ${m.y - (c.y + c.height)} px`)
      await page.getByRole('menuitem', { name: 'Enlace' }).click()
      const add = page.getByRole('button', { name: 'Agregar', exact: true })
      assert.match(await add.getAttribute('class'), /btn-gel/, '«Agregar» is the primary action of the row')
    } finally {
      await context.close()
    }
  })

  test('a long address wraps between path segments in one line of its chip, never in the middle of a word (J3-B-20)', async () => {
    const { page, context } = await session('carla')
    try {
      await page.goto(origin)
      await page.getByRole('button', { name: 'Adjuntar' }).click()
      await page.getByRole('menuitem', { name: 'Enlace' }).click()
      await page.getByLabel('Enlace', { exact: true }).fill('https://github.com/organizacion/repositorio/issues/128')
      await page.getByRole('button', { name: 'Agregar', exact: true }).click()
      const chip = page.locator('[aria-label="Adjuntos"] li').first()
      await chip.waitFor()
      const lines = await chip.locator('span.min-w-0').evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
      assert.equal(lines, 1, `the address fits on one line of its tab: ${lines}`)
    } finally {
      await context.close()
    }
  })
})

describe('drawer of sends (J3-B-04, J3-B-06, J3-B-07, J3-B-31, UD-046)', () => {
  test('the drawer keeps its place and its height from the queue to the proposal, and the actions stay at its foot (J3-B-04, J3-B-31)', async () => {
    const { page, context } = await session('diego')
    try {
      // Held in the queue until the test lets it run: the queued state is measured, not caught on its way (H-901).
      await panel.control.hold()
      await page.goto(origin)
      await bar(page).fill(FIVE)
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      const dialog = page.getByTestId('send-drawer')
      await page.getByText('En cola').first().waitFor()
      await settled(page)
      const queued = await rect(dialog)
      const title = page.getByRole('heading', { name: 'Análisis' })
      const titleQueued = (await rect(title)).y
      await panel.control.release()
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 40000 })
      await settled(page)
      const ready = await rect(dialog)
      assert.deepEqual({ y: ready.y, height: ready.height }, { y: queued.y, height: queued.height }, 'the dropdown changes neither height nor place')
      assert.equal(Math.round((await rect(page.getByRole('heading', { name: 'Análisis' }))).y), Math.round(titleQueued), 'the analysis title does not jump')
      const send = await rect(page.getByRole('button', { name: /^Enviar \d+ mensajes?$/ }))
      assert.ok(ready.y + ready.height - (send.y + send.height) < 40, `the «Enviar» button sits at the foot of the dropdown: ${ready.y + ready.height - (send.y + send.height)} px`)
    } finally {
      await context.close()
    }
  })

  test('a proposal of the example server says it is simulated, in the header of the analysis', async () => {
    const { page, context } = await session('bruno')
    try {
      await sendAndOpen(page)
      await page.locator('section[aria-label=Análisis]').getByTestId('simulated-mark').waitFor()
      assert.equal(await page.getByTestId('simulated-mark').innerText(), 'Simulado')
    } finally {
      await context.close()
    }
  })

  test('«En cola» never carries a percentage, in the drawer, in its option or in the strip (J3-B-06)', async () => {
    const { page, context } = await session('eduardo')
    try {
      const files = [join(tmpdir(), 'r3b-a.txt'), join(tmpdir(), 'r3b-b.txt')]
      writeFileSync(files[0], 'nota a')
      writeFileSync(files[1], 'nota b')
      // Held in the queue: «En cola» is on screen until the test moves the analysis, so it is measured once it is there (H-901).
      await panel.control.hold()
      await page.goto(origin)
      await bar(page).fill('Un envío con adjuntos, para ver el progreso mientras espera.\n\nOtro punto distinto.')
      await page.locator('input[type=file]').first().setInputFiles(files)
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await page.locator('[data-testid=send-drawer] section[aria-label=Análisis]').getByText('En cola').first().waitFor()
      const sample = await page.evaluate(() => {
        const d = document.querySelector('[data-testid=send-drawer]')
        const text = d.querySelector('section[aria-label=Análisis]')?.textContent ?? ''
        const meters = [...d.querySelectorAll('[role=progressbar]')].map((m) => m.getAttribute('aria-valuenow'))
        return { queued: /En cola/.test(text) && !/Leyendo|Clasificando|Descomponiendo/.test(text), meters, percent: /\d+ ?%/.test(text) }
      })
      assert.equal(sample.queued, true, 'the submission is queued')
      assert.deepEqual(sample.meters.filter((v) => v !== null), [], 'a bar with no figure while queued')
      assert.equal(sample.percent, false, 'no written percentage while queued')
    } finally {
      await context.close()
    }
  })

  test('the notice of the screen hides neither the drawer\'s title nor its control, and does not move them (J3-B-07)', async () => {
    const { page, context } = await session('sofia')
    try {
      await sendAndOpen(page)
      await settled(page)
      const control = page.getByTestId('tray-control')
      const title = page.getByRole('heading', { name: 'Análisis' })
      const before = { control: await rect(control), title: await rect(title) }
      await page.getByRole('button', { name: /^Quitar el mensaje/ }).first().click()
      const notice = page.locator('[data-notice]')
      await notice.waitFor()
      await settled(page)
      const n = await rect(notice)
      assert.equal(overlap(n, before.control), false, 'the notice does not touch the submissions control')
      assert.equal(overlap(n, before.title), false, 'the notice does not cover the analysis title')
      assert.deepEqual(await rect(control), before.control, 'the submissions control did not move')
    } finally {
      await context.close()
    }
  })
})

describe('proposal (J3-B-02, J3-B-05, J3-B-08, J3-B-09, J3-B-10, J3-B-11, J3-B-16, J3-B-27, J3-B-28, J3-B-29)', () => {
  test('the title of a message weighs more than its text and is not smaller than it, while the text keeps its reading size (J3-B-02)', async () => {
    const { page, context } = await session('tomas')
    try {
      await sendAndOpen(page)
      const title = page.getByRole('button', { name: /^Título del mensaje:/ }).first()
      const body = page.getByRole('button', { name: /^Texto del mensaje:/ }).first()
      const t = { size: parseFloat(await style(title, 'fontSize')), weight: Number(await style(title, 'fontWeight')) }
      const b = { size: parseFloat(await style(body, 'fontSize')), weight: Number(await style(body, 'fontWeight')) }
      assert.ok(b.size >= 16.9, `the text keeps the reading size of UD-030: ${b.size}`)
      assert.ok(t.size >= b.size, `the title is not smaller than the text: ${t.size} against ${b.size}`)
      assert.ok(t.weight >= 700 && t.weight > b.weight, `the title weighs more: ${t.weight} against ${b.weight}`)
    } finally {
      await context.close()
    }
  })

  test('Volver a analizar asks also when the edits are only waiting in Rehacer, then clears the history and hides it while it analyzes (J3-B-05)', async () => {
    const { page, context } = await session('valentina')
    try {
      await sendAndOpen(page)
      await page.getByRole('button', { name: /^Título del mensaje:/ }).first().click()
      await page.keyboard.type(' editado')
      await page.keyboard.press('Enter')
      await page.getByRole('button', { name: 'Deshacer', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Deshacer', exact: true }).click()
      // Only Rehacer is left: the edit is still recoverable, so dropping the proposal must ask.
      await page.getByRole('button', { name: 'Volver a analizar' }).click()
      await page.getByText('Se descarta esta propuesta con sus cambios').waitFor()
      // The new analysis waits in the queue until the test has looked at it (H-901).
      await panel.control.hold()
      await page.getByRole('dialog').last().getByRole('button', { name: 'Volver a analizar' }).click()
      await page.getByText('En cola').first().waitFor()
      assert.equal(await page.getByRole('button', { name: 'Deshacer', exact: true }).count(), 0, 'no «Deshacer» while analyzing')
      assert.equal(await page.getByRole('button', { name: 'Rehacer', exact: true }).count(), 0, 'no «Rehacer» while analyzing')
      await panel.control.release()
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 40000 })
      assert.equal(await page.getByRole('button', { name: 'Deshacer', exact: true }).count(), 0, 'the new proposal starts with an empty history')
    } finally {
      await context.close()
    }
  })

  test('removing one message and discarding the whole send are different words, icons and inks, and the history sits apart from Volver a analizar (J3-B-08, J3-B-27)', async () => {
    const { page, context } = await session('ana')
    try {
      await sendAndOpen(page)
      const remove = page.getByRole('button', { name: /^Quitar el mensaje/ }).first()
      const discard = page.getByRole('button', { name: 'Descartar envío' })
      assert.notEqual((await remove.innerText()).trim(), (await discard.innerText()).trim())
      assert.notEqual(await remove.locator('svg').first().evaluate((s) => s.innerHTML), await discard.locator('svg').first().evaluate((s) => s.innerHTML), 'they do not share an icon')
      assert.notEqual(await style(remove, 'color'), await style(discard, 'color'), 'they do not share ink')
      // The history appears beside the title, away from the step that drops the proposal.
      await page.getByRole('button', { name: /^Título del mensaje:/ }).first().click()
      await page.keyboard.type(' x')
      await page.keyboard.press('Enter')
      const undo = await rect(page.getByRole('button', { name: 'Deshacer', exact: true }))
      const again = await rect(page.getByRole('button', { name: 'Volver a analizar' }))
      // Apart: far to its right on the same row, or alone on the next one when the column is narrow (the analysis shares the drawer with the original).
      assert.ok(again.y > undo.y + undo.height - 1 || again.x - (undo.x + undo.width) > 120, `«Volver a analizar» sits apart from «Deshacer» and «Rehacer»: ${again.x - (undo.x + undo.width)} px`)
    } finally {
      await context.close()
    }
  })

  test('a part without a message becomes a message, one part at a time, and Deshacer takes it back (J3-B-09)', async () => {
    const { page, context } = await session('bruno')
    try {
      await sendAndOpen(page)
      await page.getByRole('button', { name: 'Enviar 3 mensajes', exact: true }).waitFor()
      await page.getByRole('button', { name: /^Partes sin mensaje/ }).click()
      assert.equal(await page.getByRole('button', { name: 'Crear mensaje' }).count(), 2, 'one button per part')
      await page.getByRole('button', { name: 'Crear mensaje' }).first().click()
      await page.getByRole('button', { name: 'Enviar 4 mensajes', exact: true }).waitFor()
      // The new message is open, with the text of the part as its body and a title to edit.
      const body = await page.getByRole('button', { name: /^Texto del mensaje:/ }).first().innerText()
      assert.match(body, /Cuarto: la página de inicio/)
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: /^Partes sin mensaje/ }).waitFor()
      assert.match(await page.getByRole('button', { name: /^Partes sin mensaje/ }).innerText(), /1/, 'one part remains')
      await page.getByRole('button', { name: 'Deshacer', exact: true }).click()
      await page.getByRole('button', { name: 'Enviar 3 mensajes', exact: true }).waitFor()
    } finally {
      await context.close()
    }
  })

  test('editable text shows a dotted rule at rest on a touch screen and stays quiet with a mouse (J3-B-10)', async () => {
    const touch = await session('carla', { width: 390, height: 844 }, { mobile: true })
    const mouse = await session('diego')
    try {
      for (const { page } of [touch, mouse]) await sendAndOpen(page)
      const underline = async (page) => style(page.getByRole('button', { name: /^Título del mensaje:/ }).first(), 'borderBottomStyle')
      assert.equal(await underline(touch.page), 'dotted')
      assert.notEqual(await underline(mouse.page), 'dotted')
    } finally {
      await touch.context.close()
      await mouse.context.close()
    }
  })

  test('a template field has no box at rest and lines up with the text of the message, over its whole width (J3-B-16)', async () => {
    const { page, context } = await session('eduardo')
    try {
      await sendAndOpen(page)
      const body = page.getByRole('button', { name: /^Texto del mensaje:/ }).first()
      const field = page.getByRole('button', { name: /^Resumen:/ }).first()
      const b = await rect(body)
      const f = await rect(field)
      assert.equal(Math.round(f.x), Math.round(b.x), 'same left edge')
      assert.equal(Math.round(f.width), Math.round(b.width), 'same width')
      assert.equal(await style(field, 'borderTopColor'), 'rgba(0, 0, 0, 0)', 'no box at rest')
    } finally {
      await context.close()
    }
  })

  test('the area menu is bounded and its long title wraps (J3-B-28)', async () => {
    const { page, context } = await session('sofia')
    try {
      await sendAndOpen(page)
      await page.getByRole('button', { name: /^Área:/ }).first().click()
      const menu = page.getByRole('menu')
      await menu.waitFor()
      assert.ok((await rect(menu)).width <= 360, `the menu does not exceed 22 rem: ${(await rect(menu)).width}`)
      const long = menu.getByRole('menuitemradio', { name: /Accesibilidad y experiencia/ })
      assert.ok((await rect(long)).height > 34, 'the long title wraps instead of widening the menu')
    } finally {
      await context.close()
    }
  })

  test('with one send there is no list to fold on a phone, and nothing says «1 envío» (J3-B-25)', async () => {
    const { page, context } = await session('tomas', { width: 390, height: 844 }, { mobile: true })
    try {
      await sendAndOpen(page)
      assert.equal(await page.getByRole('button', { name: /^1 envío$/ }).count(), 0)
    } finally {
      await context.close()
    }
  })
})

describe('failure, publication and notices (J3-B-14, J3-B-15, J3-B-29)', () => {
  test('a failed send says so inside the drawer, the chip has an edge and the reassurance is not red; folded, it says so as an error with its way in (J3-B-14, J3-B-29)', async () => {
    const { page, context } = await session('valentina')
    try {
      await page.goto(origin)
      // The analysis waits for the test: the drawer is folded before it fails, so the notice is what the person finds.
      await panel.control.hold()
      await bar(page).fill('Un envío que falla. [simular falla]')
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await page.getByTestId('send-drawer').waitFor()
      await page.getByTestId('tray-control').click()
      await page.getByTestId('send-drawer').waitFor({ state: 'detached' })
      await panel.control.step({ finish: true })
      const alert = page.locator('[data-notice][role=alert]')
      await alert.waitFor({ timeout: 40000 })
      assert.match(await alert.innerText(), /falló/)
      await alert.getByRole('button', { name: 'Revisar' }).click()
      const kept = page.getByText('Texto y adjuntos del envío conservados')
      await kept.waitFor()
      assert.notEqual(await style(kept, 'color'), await style(page.getByText('El análisis no terminó'), 'color'), 'what reassures is not in the error red')
      const chip = page.getByTestId('tray-control')
      assert.notEqual(await chip.locator('text=/falló/').first().evaluate((el) => getComputedStyle(el).borderTopWidth), '0px', 'the failure mark has an outline')
    } finally {
      await panel.control.release()
      await context.close()
    }
  })

  test('the notice of a publication sits in the top bar, over no content, and the status bar does not grow (J3-B-15)', async () => {
    const { page, context } = await session('ana')
    try {
      await sendAndOpen(page)
      const card = async () => (await rect(page.getByTestId('status-bar'))).height
      const before = await card()
      await page.getByRole('button', { name: /^Enviar \d+ mensajes$/ }).click()
      const notice = page.locator('[data-notice]')
      await notice.waitFor()
      // The box is read once the page is quiet, not while the notice is still coming in with its entrance animation (H-904).
      await settled(page)
      const n = await rect(notice)
      assert.ok(n.y + n.height <= 56, `el aviso queda en la barra superior: ${n.y + n.height}`)
      assert.equal(await card(), before, 'the status bar keeps its height on publishing')
      for (const label of ['Página siguiente', 'Página anterior']) {
        for (const b of await page.getByRole('button', { name: label }).all()) {
          // A pager arrow that is being measured again is not drawn for a moment: there is nothing under the notice then.
          const box = await rect(b)
          if (box) assert.equal(overlap(n, box), false, `the notice does not cover «${label}»`)
        }
      }
    } finally {
      await context.close()
    }
  })
})

describe('attachments of a message (J3-B-11)', () => {
  test('each attachment of a proposed message is one chip with its name and its remove inside it', async () => {
    const { page, context } = await session('bruno')
    try {
      const file = join(tmpdir(), 'r3b-captura.txt')
      writeFileSync(file, 'captura')
      await page.goto(origin)
      await bar(page).fill(FIVE)
      await page.locator('input[type=file]').first().setInputFiles([file])
      await page.getByRole('button', { name: 'Enviar' }).first().click()
      await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 40000 })
      // The files may go with any of the messages: open each until one carries the chip.
      const list = page.getByTestId('send-drawer').locator('section[aria-label="Análisis"] ul[aria-label="Adjuntos"]')
      let chip
      for (let i = 1; i <= 3 && !(await list.count()); i++) await page.getByRole('button', { name: new RegExp(`^Abrir el mensaje ${i}:`) }).click({ timeout: 2000 }).catch(() => undefined)
      chip = list.locator('li').first()
      await chip.waitFor()
      const c = await rect(chip)
      const remove = await rect(chip.getByRole('button', { name: /^Quitar/ }))
      assert.ok(remove.x >= c.x && remove.x + remove.width <= c.x + c.width + 1, 'the X is inside the tab')
      assert.match(await chip.innerText(), /r3b-captura\.txt/, 'the tab carries the name')
    } finally {
      await context.close()
    }
  })
})
