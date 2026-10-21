// UD-017: every view fits one screen at 1440x900 and 1280x720, with the seeded data and with every
// list multiplied by eight. Measured in the browser (Playwright, headless Chromium) against
// dev-server.mjs serving panel/dist; run it with `npm run test:fit`.
//
// A view fails when
//   - the document is taller than the window (`scrollingElement.scrollHeight > innerHeight`),
//   - `<main>` (the shell's content region) is taller than its box: it would scroll on its own,
//   - any other element has a vertical scroll of its own outside LANES (the declared allowlist),
//   - any element sits below the window edge (content pushed out of sight), or
//   - the document hides its overflow (`overflow: hidden` on html or body) instead of fitting.
//
// The multiplication of lists happens in the browser (page.route): every array in a JSON response
// comes back eight times, with ids suffixed `~k` and every `*_ids` list expanded to match; the
// dev server is not touched. Without a window of data, a view that fits because it is empty has
// proved nothing.
//
// Falsified on 2026-10-20: breaking FIT_BREAK=documento-alto (a 2000 px block in Inicio) made this
// test fail with the route and the height; see FIT_BREAK below.

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert'
import { login, startPanel } from './browser-support.mjs'

const PORT = Number(process.env.PANEL_FIT_PORT ?? 8795)
let panel
let ORIGIN = ''
const TIMES = 8
const SIZES = [
  [1440, 900],
  [1280, 720],
]

/**
 * Vertical lanes allowed to scroll by themselves. Each one is a region whose content has no upper
 * bound that a person controls: a navigation list, a pasted text and the text controls. Anything
 * else that scrolls is a view that does not fit.
 */
export const LANES = [
  '[data-lane]', // declared in the markup, next to a comment saying why
  'textarea',
  'select',
  'audio',
  '[role="listbox"]',
  '[role="menu"]',
]

// FIT_BREAK=documento-alto adds a 2000 px block to the document; FIT_BREAK=carril adds a lane that
// scrolls without being declared; FIT_BREAK=oculto hides the overflow of the document.
const BREAK = process.env.FIT_BREAK ?? ''

before(async () => {
  panel = await startPanel(PORT)
  ORIGIN = panel.origin
})

after(async () => {
  await panel?.stop()
})

/** Every array in `value` eight times; objects with an `id` get `~k` appended (k = 0 keeps the original). */
export function multiply(value, times = TIMES, key = '') {
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x === 'string') && (key.endsWith('_ids') || key === 'domains')) {
      if (key === 'domains') return value.flatMap((x) => Array.from({ length: times }, (_, k) => (k === 0 ? x : `${x} ${k + 1}`)))
      return value.flatMap((x) => Array.from({ length: times }, (_, k) => (k === 0 ? x : `${x}~${k}`)))
    }
    return value.flatMap((item) =>
      Array.from({ length: times }, (_, k) => {
        const copy = multiply(item, times, key)
        if (k > 0 && copy && typeof copy === 'object' && typeof copy.id === 'string') copy.id = `${copy.id}~${k}`
        return copy
      }),
    )
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, multiply(v, times, k)]))
  return value
}

async function amplify(page) {
  await page.route(/\/api\//, async (route) => {
    const request = route.request()
    if (request.method() !== 'GET') return route.continue()
    const url = new URL(request.url())
    const original = url.pathname.replace(/~\d+/g, '')
    const response = await route.fetch({ url: `${url.origin}${original}${url.search}` })
    const type = response.headers()['content-type'] ?? ''
    if (!type.includes('application/json')) return route.fulfill({ response })
    if (/^\/api\/(me|health)$/.test(original)) return route.fulfill({ response })
    const body = await response.json().catch(() => null)
    if (body === null) return route.fulfill({ response })
    return route.fulfill({ response, json: multiply(body) })
  })
}

/** Runs in the page. */
function measureInPage({ lanes, withBreak }) {
  const se = document.scrollingElement
  const main = document.querySelector('main')
  const matches = (el) => lanes.some((s) => el.matches(s) || el.closest(s))
  const rect = (el) => el.getBoundingClientRect()
  const label = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : ''}`
  const carriles = [...document.querySelectorAll('body *')]
    .filter((el) => {
      const o = getComputedStyle(el).overflowY
      return (o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 1 && !matches(el)
    })
    .map(label)
  // The region <main> is the shell's content: if it needs to scroll, the view does not fit.
  const mainOver = main ? main.scrollHeight - main.clientHeight : 0
  const below = Math.max(
    0,
    ...[...document.querySelectorAll('main *')]
      .filter((el) => {
        const r = rect(el)
        return r.width > 0 && r.height > 0 && !el.closest('[data-lane]') && getComputedStyle(el).visibility !== 'hidden'
      })
      .map((el) => Math.round(rect(el).bottom + window.scrollY)),
  )
  const hidden = getComputedStyle(document.documentElement).overflowY === 'hidden' || getComputedStyle(document.body).overflowY === 'hidden'
  return { doc: se.scrollHeight, win: innerHeight, mainOver, mainBox: main ? main.clientHeight : 0, below, carriles, hidden, wide: se.scrollWidth - se.clientWidth, withBreak }
}

/** Opens a path and waits for the view's heading, then for the network and the layout to settle. */
async function open(page, path) {
  await page.goto(`${ORIGIN}${path}`)
  await page.locator('main h1').first().waitFor()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
}

async function sendInput(page) {
  const text = 'Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?\n\nSaludos al equipo.'
  await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill(text)
  await page.locator('input[type=file]:not([capture])').setInputFiles([
    { name: 'nota-de-voz.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(8044, 128) },
    { name: 'feedback.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('ejemplo') },
  ])
  await page.getByRole('button', { name: 'Enviar' }).first().click()
  await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
  await page.waitForTimeout(600)
}

/** The views: path, and an optional step that prepares the state (sending an input, for instance). */
const VIEWS = [
  { name: 'inicio', path: '/' },
  { name: 'inicio con propuesta', path: '/', prepare: sendInput },
  { name: 'mensajes', path: '/messages' },
  { name: 'detalle', path: null },
  { name: 'áreas', path: '/areas' },
  { name: 'área abierta', path: '/areas/a-error' },
  { name: 'equipo', path: '/team' },
  { name: 'configuración', path: '/settings' },
]

const report = []

for (const [width, height] of SIZES) {
  for (const [state, amplified] of [
    ['con lo sembrado', false],
    [`con cada lista ×${TIMES}`, true],
  ]) {
    describe(`${width}x${height} ${state}`, () => {
      test('cada vista cabe en la ventana', async () => {
        const context = await panel.browser.newContext({ viewport: { width, height }, locale: 'es-CL', colorScheme: 'light' })
        const page = await context.newPage()
        const failures = []
        try {
          await login(page, ORIGIN)
          if (amplified) await amplify(page)
          // The long message with every medium and a thread: the one with the most to show.
          const body = await (await page.request.get(`${ORIGIN}/api/messages`)).json()
          const list = Array.isArray(body) ? body : body.items
          const rich = list.find((m) => m.title.startsWith('Revisar la lectura')) ?? list[0]
          for (const view of VIEWS) {
            const path = view.path ?? `/messages/${rich.id}`
            await open(page, path)
            if (view.prepare) await view.prepare(page)
            if (BREAK === 'documento-alto' && view.name === 'inicio') await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<div style="height:2000px">x</div>'))
            if (BREAK === 'carril' && view.name === 'equipo') await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<div style="height:80px;overflow-y:auto"><div style="height:400px">x</div></div>'))
            if (BREAK === 'oculto' && view.name === 'mensajes') await page.evaluate(() => (document.documentElement.style.overflowY = 'hidden'))
            const m = await page.evaluate(measureInPage, { lanes: LANES, withBreak: BREAK })
            report.push({ size: `${width}x${height}`, data: amplified ? `x${TIMES}` : 'sembrado', view: view.name, doc: m.doc, win: m.win, main: m.mainBox + m.mainOver, below: m.below })
            if (m.doc > m.win) failures.push(`${view.name} (${path}): documento de ${m.doc} px en una ventana de ${m.win} (${(m.doc / m.win).toFixed(2)} ventanas)`)
            if (m.mainOver > 1) failures.push(`${view.name} (${path}): la región principal desplaza ${m.mainOver} px por su cuenta (${m.mainBox + m.mainOver} px en ${m.mainBox})`)
            if (m.below > m.win) failures.push(`${view.name} (${path}): contenido hasta ${m.below} px en una ventana de ${m.win}`)
            if (m.carriles.length) failures.push(`${view.name} (${path}): carriles verticales propios fuera de la lista blanca: ${m.carriles.join(', ')}`)
            if (m.hidden) failures.push(`${view.name} (${path}): el documento esconde su desborde con overflow hidden`)
            if (m.wide > 0) failures.push(`${view.name} (${path}): el documento se ensancha ${m.wide} px más que la ventana`)
          }
        } finally {
          await page.unrouteAll({ behavior: 'ignoreErrors' })
          await context.close()
        }
        assert.deepStrictEqual(failures, [], `Vistas que no caben ${state} a ${width}x${height}:\n${failures.join('\n')}`)
      })
    })
  }
}

after(() => {
  if (!process.env.FIT_REPORT && !report.length) return
  const rows = report.map((r) => `${r.size.padEnd(9)} ${r.data.padEnd(9)} ${r.view.padEnd(20)} documento ${String(r.doc).padStart(5)} · ventana ${r.win} · región ${String(r.main).padStart(5)} · contenido hasta ${r.below}`)
  console.log('\nMedidas de ajuste (px):\n' + rows.join('\n'))
})
