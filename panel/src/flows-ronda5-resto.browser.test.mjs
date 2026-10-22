// Ronda 5 of the judges, the screens Entrada, Equipo, Configuración, Conexiones and the drawer of Inicio, in a real browser against
// dev-server.mjs serving panel/dist: `npm run test:flows`. Each test can fail if the defect it names comes back.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '1'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_RONDA5_PORT ?? 8967), { stepMs: 80 })
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

async function open(viewport, scheme, who, path = '/') {
  const mobile = viewport.width < 768
  const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
  const page = await context.newPage()
  if (who) {
    await login(page, origin, who)
    if (path !== '/') {
      await page.goto(origin + path)
      await page.locator('main#main').waitFor()
    }
  } else await page.goto(origin)
  await settled(page)
  return { page, context }
}

describe('Entrada', () => {
  for (const [name, viewport] of [['desktop', DESKTOP], ['phone', PHONE]]) {
    for (const scheme of ['light', 'dark']) {
      test(`the text of «Entrar» is centered in its button: ${name}, ${scheme}`, async () => {
        const { page, context } = await open(viewport, scheme, null)
        try {
          const button = page.getByRole('button', { name: 'Entrar' })
          const box = await button.boundingBox()
          const text = await button.evaluate((el) => {
            const range = document.createRange()
            range.selectNodeContents(el)
            const r = range.getBoundingClientRect()
            return { x: r.x, width: r.width }
          })
          const delta = Math.abs(text.x + text.width / 2 - (box.x + box.width / 2))
          assert.ok(delta <= 1, `the text is ${delta.toFixed(1)} px off the center of the button`)
        } finally {
          await context.close()
        }
      })
    }
  }
})

describe('Equipo', () => {
  test('«Desactivar» is an outlined action as tall as the other actions of the row, and the fourth column has a heading', async () => {
    const { page, context } = await open(DESKTOP, 'light', 'ana', '/team')
    try {
      const action = page.getByRole('button', { name: /^Desactivar a / }).first()
      await action.waitFor()
      const look = await action.evaluate((el) => {
        const s = getComputedStyle(el)
        return { border: parseFloat(s.borderTopWidth), height: el.getBoundingClientRect().height, size: parseFloat(s.fontSize) }
      })
      assert.ok(look.border >= 1, 'the action has an outline')
      assert.ok(look.height >= 28, `the action is ${look.height} px tall`)
      assert.ok(look.size >= 14, `the label is ${look.size} px`)
      const add = await page.getByRole('button', { name: 'Agregar miembro' }).evaluate((el) => el.getBoundingClientRect().height)
      assert.ok(Math.abs(add - look.height) <= 4, 'the action is as tall as «Agregar miembro»')
      assert.equal(await page.getByRole('columnheader').count() + (await page.getByText('Acciones', { exact: true }).count()) > 0, true)
      assert.equal(await page.getByText('Acciones', { exact: true }).count(), 1, 'the column of actions is named')
    } finally {
      await context.close()
    }
  })

  test('a role says what it allows on hover and to a screen reader, with no visible help text', async () => {
    const { page, context } = await open(DESKTOP, 'light', 'ana', '/team')
    try {
      const chip = page.getByRole('button', { name: /^Rol de Bruno/ }).first()
      await chip.waitFor()
      assert.match(await chip.getAttribute('title'), /Envía mensajes|Administra/)
      assert.match(await chip.getAttribute('aria-label'), /\. (Envía mensajes|Administra)/)
      assert.equal(await page.getByText('Envía mensajes y responde').count(), 0, 'the explanation is not drawn')
    } finally {
      await context.close()
    }
  })
})

describe('Configuración', () => {
  test('the select of Proveedor and the menu of Idioma share height, face and chevron', async () => {
    const { page, context } = await open(DESKTOP, 'light', 'ana', '/settings')
    try {
      const select = page.locator('li[data-slot] select').first()
      await select.waitFor()
      const language = page.getByRole('button', { name: /^Idioma/ })
      const face = (el) => el.evaluate((node) => {
        const s = getComputedStyle(node)
        return { h: node.getBoundingClientRect().height, appearance: s.appearance, border: s.borderTopColor, radius: s.borderTopLeftRadius, size: s.fontSize, chevron: !!(node.parentElement.querySelector('svg') ?? node.querySelector('svg')) }
      })
      const a = await face(select)
      const b = await face(language)
      assert.equal(a.h, b.h, 'same height')
      assert.equal(a.appearance, 'none', 'no arrow of the system')
      assert.equal(a.border, b.border)
      assert.equal(a.radius, b.radius)
      assert.equal(a.size, b.size)
      assert.ok(a.chevron && b.chevron, 'both carry the chevron of the panel')
    } finally {
      await context.close()
    }
  })

  test('«Funciones» is a group label and «Texto» a row title: they do not share weight and ink', async () => {
    const { page, context } = await open(DESKTOP, 'light', 'ana', '/settings')
    try {
      const group = page.getByRole('heading', { name: 'Funciones', level: 3 })
      const row = page.getByRole('heading', { name: 'Texto', level: 4 })
      await row.waitFor()
      const ink = (el) => el.evaluate((n) => ({ weight: getComputedStyle(n).fontWeight, color: getComputedStyle(n).color }))
      const [g, r] = [await ink(group), await ink(row)]
      assert.ok(Number(r.weight) > Number(g.weight), `weights ${g.weight} and ${r.weight}`)
      assert.notEqual(g.color, r.color)
    } finally {
      await context.close()
    }
  })

  test('«Publicación automática» says what is published and where, in one line under 90 characters', async () => {
    const { page, context } = await open(PHONE, 'light', 'ana', '/settings')
    try {
      const hint = page.locator('#hint-publication')
      await hint.waitFor()
      const text = await hint.innerText()
      assert.match(text, /mensajes en el proyecto/)
      assert.ok(text.length <= 90)
    } finally {
      await context.close()
    }
  })
})

describe('Conexiones', () => {
  test('on a phone each connection says what it is on hover, with no reason under the title', async () => {
    const { page, context } = await open(PHONE, 'light', 'ana', '/connections')
    try {
      await page.getByRole('heading', { name: 'Conexiones', level: 1 }).waitFor()
      assert.equal(await page.getByText('Apagadas hasta').count(), 0, 'the owner removed the reason (UD-253)')
      for (const name of ['API', 'MCP', 'Correo']) {
        const row = page.locator('[title]').filter({ hasText: new RegExp(`^${name}$`) })
        assert.ok((await row.getAttribute('title')).length > 10, `${name} has a gloss`)
      }
    } finally {
      await context.close()
    }
  })
})

describe('the drawer of Inicio', () => {
  const TEXT = 'Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?'

  test('a text typed on a phone never shows a half line at the top of the bar', async () => {
    const { page, context } = await open(PHONE, 'light', 'bruno')
    try {
      const field = page.getByTestId('compose-text')
      await field.fill(TEXT)
      await settled(page)
      const m = await field.evaluate((el) => ({ top: el.scrollTop, line: parseFloat(getComputedStyle(el).lineHeight), over: el.scrollHeight - el.clientHeight }))
      assert.ok(m.over <= 1, `the three paragraphs fit with no scroll (${m.over} px over)`)
      await field.fill(`${TEXT}\n\n${TEXT}`)
      await settled(page)
      const long = await field.evaluate((el) => ({ top: el.scrollTop, line: parseFloat(getComputedStyle(el).lineHeight) }))
      const rest = long.top % long.line
      assert.ok(Math.min(rest, long.line - rest) <= 1.5, `a long text scrolls by whole lines: ${long.top} of ${long.line}`)
    } finally {
      await context.close()
    }
  })

  test('a text-only send says «Enviando» and the title of the analysis stays where it is until the analysis', async () => {
    const { page, context } = await open(DESKTOP, 'light', 'bruno')
    try {
      let release = () => {}
      const gate = new Promise((resolve) => (release = resolve))
      await page.route(/\/api\/inputs$/, async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        await gate
        await route.continue()
      })
      await panel.control.hold()
      await page.getByTestId('compose-text').fill('Un envío sólo de texto.')
      await page.getByTestId('compose-send').click()
      const drawer = page.getByTestId('send-drawer')
      await drawer.getByText('Enviando', { exact: true }).first().waitFor()
      assert.equal(await drawer.getByText('Subiendo').count(), 0, 'no upload without files')
      const sending = (await drawer.getByRole('heading', { name: 'Análisis' }).boundingBox()).y
      release()
      await drawer.getByTestId('analysis-box').waitFor()
      await settled(page)
      const analysing = (await drawer.getByRole('heading', { name: 'Análisis' }).boundingBox()).y
      assert.equal(Math.round(sending), Math.round(analysing), 'the heading does not jump between the phases')
      await panel.control.release()
    } finally {
      await context.close()
    }
  })

  test('on a phone the published result starts in the first screen after a send, and the original opens whole', async () => {
    const { page, context } = await open(PHONE, 'light', 'bruno')
    try {
      await page.getByTestId('compose-text').fill(TEXT)
      await page.getByTestId('compose-send').click()
      const drawer = page.getByTestId('send-drawer')
      const card = drawer.getByTestId('published-message').first()
      await card.waitFor({ timeout: 20000 })
      await settled(page)
      // The result starts with its count (UD-257).
      const top = (await drawer.getByTestId('message-tally').boundingBox()).y
      const original = await drawer.getByTestId('original-box').boundingBox()
      assert.ok(original.height < 150, `the original takes ${original.height} px`)
      assert.ok(top < 844 * 0.62, `the result starts at ${top} px of an 844 px screen`)
      await drawer.getByRole('button', { name: 'Ver más' }).click()
      await drawer.getByText('Pregunta: ¿el audio máximo sigue en 25 MB?').first().waitFor()
    } finally {
      await context.close()
    }
  })
})
