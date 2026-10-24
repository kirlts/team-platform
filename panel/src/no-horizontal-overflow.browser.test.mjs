// Martín, 2026-10-24: «el sitio en móvil permite desplazamiento horizontal, eso es una falta grave». On a phone, nothing visible may
// reach past the right edge of the viewport, in any view, at 360, 390 and 430 px. Measured in the browser against dev-server.mjs
// serving panel/dist, with the sample data that holds the cases that broke it (a reply with a JSON code block, long paths and URLs,
// unbroken words, link attachments): `npm run test:overflow`.
//
// A view fails when `scrollWidth > clientWidth` on the document, or when a visible element's right edge is past the viewport. An
// element clipped by an ancestor that scrolls or clips by itself (a code block that scrolls INSIDE its box) counts by its clipped edge.
//
// Falsified on 2026-10-24: with OVERFLOW_BREAK=1 a 900 px wide block is added to every view and this test fails with the route and the element.
import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH ??= '0'
process.env.PANEL_DEV_MEDIA = '1'
process.env.PANEL_DEV_OVERFLOW = '1'

const PORT = Number(process.env.PANEL_OVERFLOW_PORT ?? 8797)
const WIDTHS = [360, 390, 430]
const BREAK = process.env.OVERFLOW_BREAK === '1'
let panel

before(async () => {
  panel = await startPanel(PORT)
})
after(async () => {
  await panel?.control.reset().catch(() => {})
  await panel?.stop()
})

/** Runs in the page: the visible elements whose (clipped) right edge is past the viewport, and the document's own overflow. */
function measure() {
  const vw = document.documentElement.clientWidth
  const describeEl = (el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 4).join('.')}` : ''}`
  const out = []
  for (const el of document.body.querySelectorAll('*')) {
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    // Visually hidden helpers (sr-only) are not content.
    if (rect.width <= 1 && rect.height <= 1) continue
    let right = rect.right
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = getComputedStyle(a)
      if (a !== document.body && a.id !== 'main' && s.overflowX !== 'visible') right = Math.min(right, a.getBoundingClientRect().right)
    }
    // An SVG child or a text node inside a clipped box is covered by its box; the measure is of the element itself.
    if (right > vw + 1) out.push(`${describeEl(el)} right=${Math.round(right)}`)
  }
  // `<main>` is the page's own scroller: what it cannot fit is a page that drags sideways, so it never counts as a clip.
  const main = document.querySelector('main#main')
  if (main && main.scrollWidth > main.clientWidth) out.unshift(`main#main scrollWidth ${main.scrollWidth} > clientWidth ${main.clientWidth}`)
  return { vw, scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, offenders: out.slice(0, 12) }
}

async function routes(page) {
  const res = await page.request.get(`${panel.origin}/api/messages?limit=200`)
  const body = await res.json()
  const items = body.items ?? body.messages ?? body.data ?? body
  const ids = items.map((m) => ({ id: m.id, title: m.title }))
  const long = ids.find((m) => /Hilo largo/.test(m.title))
  const gallery = ids.find((m) => /Galería de seis/.test(m.title))
  const voice = ids.find((m) => /Grabación|voz/.test(m.title))
  const withReplies = ids.find((m) => /Agregar exportación/.test(m.title))
  assert.ok(long, 'the sample data lacks the long thread')
  const detail = [long, gallery, voice, withReplies].filter(Boolean).map((m) => `/messages/${m.id}`)
  return ['/', '/messages', ...detail, '/areas', '/connections', '/team', '/settings']
}

describe('no horizontal overflow on a phone', () => {
  for (const width of WIDTHS) {
    test(`${width}px`, async () => {
      const context = await panel.browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-CL' })
      const page = await context.newPage()
      try {
        await login(page, panel.origin)
        const failures = []
        for (const path of await routes(page)) {
          await page.goto(`${panel.origin}${path}`)
          await page.locator('main#main').waitFor()
          await settled(page)
          if (BREAK) await page.evaluate(() => document.querySelector('main#main').insertAdjacentHTML('beforeend', '<div id="break" style="width:900px;height:20px">x</div>'))
          const m = await page.evaluate(measure)
          if (m.scrollWidth > m.vw || m.bodyScrollWidth > m.vw) failures.push(`${path}: scrollWidth ${m.scrollWidth}/${m.bodyScrollWidth} > ${m.vw}`)
          if (m.offenders.length) failures.push(`${path}: ${m.offenders.join(' | ')}`)
        }
        assert.deepStrictEqual(failures, [], `horizontal overflow at ${width}px:\n${failures.join('\n')}`)
      } finally {
        await context.close()
      }
    })
  }
})
