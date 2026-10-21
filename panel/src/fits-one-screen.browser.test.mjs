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
import { login, startPanel, settled } from './browser-support.mjs'

// These tests go through the review of a proposal, which is what the server does with publication by hand (UD-070): they start it with auto-publication off.
// The automatic path has its own file, `flows-inicio.browser.test.mjs`.
process.env.PANEL_DEV_AUTO_PUBLISH ??= '0'

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

/**
 * Views whose page is allowed to scroll (UD-123). Dueño, 2026-10-21: «La parte para escribir la descripción del proyecto tiene texto
 * truncado que obliga a desplazarse dentro de la misma página para escribir la configuración del proyecto. Eso es un gran problema.»
 * Configuración holds a project description that can be as long as a master spec; the fix is not a smaller frame with a scroll inside it but an
 * editor as tall as its text, and the page (the `<main>` of the shell) is what scrolls. These views are exempt ONLY from the checks of document
 * height, region height and content below the window edge; own lanes, hidden overflow, text under 12 px and repeated text still apply to them.
 */
export const SCROLLING_PAGES = ['configuración']
/** Characters seeded into the project description of Configuración, to measure the editor with a long text. */
const LONG_PROJECT = 12000

// FIT_BREAK=textarea-capped puts a max height and an own scroll on the project editor (it must fail); FIT_BREAK=documento-alto adds a 2000 px block to the document; FIT_BREAK=carril adds a lane that
// scrolls without being declared; FIT_BREAK=oculto hides the overflow of the document; FIT_BREAK=repetido draws the same sentence twice.
const BREAK = process.env.FIT_BREAK ?? ''

before(async () => {
  panel = await startPanel(PORT)
  ORIGIN = panel.origin
})

after(async () => {
  await panel?.control.reset().catch(() => {})
  await panel?.stop()
})

/** Every array in `value` eight times; objects with an `id` get `~k` appended (k = 0 keeps the original). */
export function multiply(value, times = TIMES, key = '') {
  if (Array.isArray(value)) {
    if (value.every((x) => typeof x === 'string') && (key.endsWith('_ids'))) {
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
    // The event stream never ends: fetching it through the route hangs the page's teardown.
    if (url.pathname === '/api/events') return route.continue()
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

/**
 * Texts of 20 or more characters that the view shows twice (UD-026): the same data is never drawn two times in a view.
 * `<main>` only: the navigation lists areas on purpose. An element can declare `data-repeat-ok` when the repetition is
 * the point (the reply to a message names the message it answers); the declaration sits next to a comment saying why.
 */
function repeatsInPage() {
  const seen = new Map()
  for (const el of document.querySelectorAll('main *')) {
    if (el.closest('[data-repeat-ok], .sr-only, textarea') || el.classList.contains('sr-only')) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim()
    if (own.length < 20) continue
    seen.set(own, (seen.get(own) ?? 0) + 1)
  }
  return [...seen].filter(([, n]) => n > 1).map(([text, n]) => `«${text.slice(0, 60)}» ×${n}`)
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
  // J1-A-53: no visible text under 12 px (the support step of the type scale). The initials of an avatar are
  // decoration (aria-hidden, the name always sits next to them) and are the one exemption.
  const small = new Set()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || !n.textContent.trim() || el.closest('.sr-only') || el.closest('script,style') || el.closest('[aria-hidden=true]')) continue
    const r = rect(el)
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue
    const size = parseFloat(getComputedStyle(el).fontSize)
    if (size < 11.99) small.add(`${size.toFixed(1)} px «${n.textContent.trim().slice(0, 30)}»`)
  }
  // An open dialog locks the page's scroll on purpose (it is a layer over the page, not the page); without one, hidden overflow is a failure.
  const hidden = !document.querySelector('[role="dialog"]') && (getComputedStyle(document.documentElement).overflowY === 'hidden' || getComputedStyle(document.body).overflowY === 'hidden')
  return { doc: se.scrollHeight, win: innerHeight, mainOver, mainBox: main ? main.clientHeight : 0, below, carriles, small: [...small], hidden, wide: se.scrollWidth - se.clientWidth, withBreak }
}

/** Puts a long description in the project, as the Editor would (the dev server keeps it until `control.reset`). */
async function seedProject(page) {
  const paragraph = 'Párrafo de una descripción larga del proyecto, con el contexto que el análisis recibe de cada mensaje del equipo. '
  const description = paragraph.repeat(Math.ceil(LONG_PROJECT / paragraph.length)).slice(0, LONG_PROJECT)
  const res = await page.request.patch(`${ORIGIN}/api/settings/project`, { data: { description }, headers: { 'x-team-request': 'panel' } })
  assert.ok(res.ok(), `no se pudo sembrar el proyecto: ${res.status()}`)
}

/** Opens a path and waits for the view's heading, then for the network and the layout to settle. */
async function open(page, path) {
  await page.goto(`${ORIGIN}${path}`)
  await page.locator('main h1').first().waitFor()
  // A view that never goes quiet says which one it is (the amplified lists once left a request loop open).
  await page.waitForLoadState('networkidle').catch(async (error) => {
    const recent = await page.evaluate(() => performance.getEntriesByType('resource').slice(-12).map((e) => e.name.replace(location.origin, '')))
    throw new Error(`${path} never went quiet: ${error.message}; last requests: ${recent.join(', ')}`)
  })
  await settled(page)
}

async function sendInput(page) {
  const text = 'Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?\n\nSaludos al equipo.'
  await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill(text)
  await page.locator('input[type=file]:not([capture])').setInputFiles([
    { name: 'nota-de-voz.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(8044, 128) },
    { name: 'feedback.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('ejemplo') },
  ])
  await page.getByRole('button', { name: 'Enviar' }).first().click()
  // The drawer under the bar opens by itself (UD-046) and stays open while it is measured.
  await page.getByRole('button', { name: /^Área:/ }).first().waitFor({ timeout: 20000 })
  await settled(page)
}

/**
 * Ten sends one after another (UD-025). The bar empties at each send and the tray keeps its frame: after the tenth
 * the page is exactly as tall as after the first. Returns that first measure to compare with.
 */
async function sendTen(page) {
  const bar = page.getByLabel('Nuevo mensaje', { exact: true }).last()
  const measure = () => page.evaluate(() => ({ doc: document.scrollingElement.scrollHeight, main: document.querySelector('main').scrollHeight }))
  let base
  for (let i = 1; i <= 10; i++) {
    await bar.fill(`Envío ${i} de la serie: revisar el punto ${i} y avisar al equipo.`)
    await page.getByRole('button', { name: 'Enviar' }).first().click()
    if (i === 1) {
      await page.getByTestId('tray-control').waitFor()
      await settled(page)
      base = await measure()
    }
  }
  // They finish at staggered times: wait until the tray holds the ten and the last ones are ready.
  // Lists come back multiplied in the amplified run, so the count is not compared: the sends are done when none is still being analyzed.
  await page.waitForFunction(() => /para revisar/.test(document.querySelector('[data-testid="tray-control"]')?.textContent ?? '') && !/en análisis/.test(document.querySelector('[data-testid="tray-control"]')?.textContent ?? ''), null, { timeout: 40000 })
  await settled(page)
  return base
}

/** The views: path, and an optional step that prepares the state (sending an input, for instance). */
const VIEWS = [
  { name: 'inicio', path: '/' },
  { name: 'inicio con propuesta', path: '/', prepare: sendInput },
  { name: 'inicio con diez envíos', path: '/', prepare: sendTen, compare: true },
  { name: 'mensajes', path: '/messages' },
  { name: 'detalle', path: null },
  { name: 'áreas', path: '/areas' },
  { name: 'área abierta', path: '/areas/a-error' },
  { name: 'equipo', path: '/team' },
  { name: 'configuración', path: '/settings' },
]

const report = []

// A list that has settled asks for nothing: its thumbnails are drawn once. The frame of a list measures itself against its neighbors, so a neighbor that
// changes size at every measure (the strip of areas that wrapped and unwrapped, H-1405) made both lists draw their sixty measuring rows again and again,
// and every video thumbnail asked for its file each time. The count that fails is derived from what is on screen: no thumbnail may ask for its URL
// more than twice (its first draw and one measure) in five seconds, whatever the number of thumbnails.
for (const [width, height] of SIZES) {
  describe(`${width}x${height} the lists do not ask again for what they already drew`, () => {
    test('no URL is requested more than twice per thumbnail on screen in five seconds, with every list ×8', async () => {
      const context = await panel.browser.newContext({ viewport: { width, height }, locale: 'es-CL' })
      const page = await context.newPage()
      try {
        await login(page, ORIGIN)
        await amplify(page)
        await open(page, '/')
        // The window starts once the page is quiet: what is asked from here on is the loop, not the first draw.
        const asked = new Map()
        page.on('request', (r) => {
          const url = new URL(r.url())
          if (url.pathname.startsWith('/api/') && url.pathname !== '/api/events') asked.set(url.pathname, (asked.get(url.pathname) ?? 0) + 1)
        })
        const thumbs = await page.evaluate(() => {
          const count = {}
          for (const el of document.querySelectorAll('main video[src], main img[src]')) {
            const path = new URL(el.getAttribute('src'), location.href).pathname
            count[path] = (count[path] ?? 0) + 1
          }
          return count
        })
        // Five seconds of the page left alone, counted by what the browser does (a frame clock), not by a pause.
        await page.evaluate(
          () =>
            new Promise((resolve) => {
              const start = performance.now()
              const tick = () => (performance.now() - start >= 5000 ? resolve(undefined) : requestAnimationFrame(tick))
              requestAnimationFrame(tick)
            }),
        )
        const failures = [...asked].filter(([path, n]) => n > 2 * Math.max(1, thumbs[path] ?? 0)).map(([path, n]) => `${path} ×${n} (hay ${thumbs[path] ?? 0} en pantalla)`)
        assert.deepStrictEqual(failures, [], `Repeated requests within five seconds:\n${failures.join('\n')}`)
      } finally {
        await page.unrouteAll({ behavior: 'ignoreErrors' })
        await context.close()
      }
    })
  })
}

for (const [width, height] of SIZES) {
  for (const [state, amplified] of [
    ['con lo sembrado', false],
    [`con cada lista ×${TIMES}`, true],
  ]) {
    describe(`${width}x${height} ${state}`, () => {
      test('every view fits in the window', async () => {
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
            if (view.name === 'configuración') await seedProject(page)
            await open(page, path)
            const base = view.prepare ? await view.prepare(page) : undefined
            if (BREAK === 'documento-alto' && view.name === 'inicio') await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<div style="height:2000px">x</div>'))
            if (BREAK === 'carril' && view.name === 'equipo') await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<div style="height:80px;overflow-y:auto"><div style="height:400px">x</div></div>'))
            if (BREAK === 'repetido' && view.name === 'equipo') await page.evaluate(() => document.querySelector('main').insertAdjacentHTML('beforeend', '<p>Este texto aparece dos veces en la vista.</p><p>Este texto aparece dos veces en la vista.</p>'))
            if (BREAK === 'oculto' && view.name === 'mensajes') await page.evaluate(() => (document.documentElement.style.overflowY = 'hidden'))
            if (BREAK === 'textarea-capped' && view.name === 'configuración') await page.evaluate(() => Object.assign(document.querySelector('textarea[aria-label="Proyecto"]').style, { maxHeight: '200px', overflowY: 'auto' }))
            const m = await page.evaluate(measureInPage, { lanes: LANES, withBreak: BREAK })
            if (!amplified) {
              const repeats = await page.evaluate(repeatsInPage)
              if (repeats.length) failures.push(`${view.name} (${path}): text repeated in the view: ${repeats.join('; ')}`)
            }
            report.push({ size: `${width}x${height}`, data: amplified ? `x${TIMES}` : 'sembrado', view: view.name, doc: m.doc, win: m.win, main: m.mainBox + m.mainOver, below: m.below })
            const scrolls = SCROLLING_PAGES.includes(view.name)
            if (scrolls) {
              // The long description is what makes the page scroll, and the editor itself never does (it is as tall as its text).
              const editor = await page.evaluate(() => {
                const el = document.querySelector('textarea[aria-label="Proyecto"]')
                return el ? { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY, chars: el.value.length } : null
              })
              if (!editor) failures.push(`${view.name} (${path}): there is no project editor`)
              else {
                if (editor.chars < LONG_PROJECT) failures.push(`${view.name} (${path}): the long text was not seeded (${editor.chars} characters)`)
                if (editor.scrollHeight > editor.clientHeight + 1 || editor.overflowY === 'auto' || editor.overflowY === 'scroll') failures.push(`${view.name} (${path}): the project editor scrolls on its own (${editor.scrollHeight} px of text in ${editor.clientHeight}, overflow-y ${editor.overflowY})`)
              }
              if (m.mainOver <= 1) failures.push(`${view.name} (${path}): with ${LONG_PROJECT} characters the page does not scroll, so the text is cut somewhere`)
            }
            if (!scrolls && m.doc > m.win) failures.push(`${view.name} (${path}): document of ${m.doc} px in a window of ${m.win} (${(m.doc / m.win).toFixed(2)} windows)`)
            if (!scrolls && m.mainOver > 1) failures.push(`${view.name} (${path}): the main region scrolls ${m.mainOver} px on its own (${m.mainBox + m.mainOver} px in ${m.mainBox})`)
            if (!scrolls && m.below > m.win) failures.push(`${view.name} (${path}): content down to ${m.below} px in a window of ${m.win}`)
            // On a page that scrolls (UD-123) the <main> of the shell is the page's own scrolling region; any other lane still fails.
            const lanes = scrolls ? m.carriles.filter((c) => !c.startsWith('main.')) : m.carriles
            if (lanes.length) failures.push(`${view.name} (${path}): own vertical lanes outside the allow-list: ${lanes.join(', ')}`)
            if (m.small.length) failures.push(`${view.name} (${path}): text below 12 px: ${m.small.slice(0, 5).join('; ')}`)
            if (m.hidden) failures.push(`${view.name} (${path}): the document hides its overflow with overflow hidden`)
            if (view.compare && base && (m.doc !== base.doc || m.mainBox + m.mainOver !== base.main)) failures.push(`${view.name} (${path}): ten inputs changed the height (document ${base.doc} to ${m.doc}, region ${base.main} to ${m.mainBox + m.mainOver})`)
            if (m.wide > 0) failures.push(`${view.name} (${path}): the document is ${m.wide} px wider than the window`)
          }
        } finally {
          await page.unrouteAll({ behavior: 'ignoreErrors' })
          await context.close()
        }
        assert.deepStrictEqual(failures, [], `Views that do not fit ${state} at ${width}x${height}:\n${failures.join('\n')}`)
      })
    })
  }
}

after(() => {
  if (!process.env.FIT_REPORT && !report.length) return
  const rows = report.map((r) => `${r.size.padEnd(9)} ${r.data.padEnd(9)} ${r.view.padEnd(20)} documento ${String(r.doc).padStart(5)} · ventana ${r.win} · región ${String(r.main).padStart(5)} · contenido hasta ${r.below}`)
  console.log('\nFit measurements (px):\n' + rows.join('\n'))
})
