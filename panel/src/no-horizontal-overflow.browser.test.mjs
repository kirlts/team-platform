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

const PORT = Number(process.env.PANEL_OVERFLOW_PORT ?? 9207)
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
  // The work of an agent in the sheet (B7): the session running and a delivery that failed, which adds the retry button to the panel on a phone.
  panel.work ??= await panel.control.agentWork()
  const work = [panel.work.session, panel.work.failed_delivery].map((id) => `/messages/${id}`)
  return ['/', '/messages', ...detail, ...work, '/areas', '/connections', '/team', '/settings']
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
          // The routes of the work of an agent must show its panel, or they prove nothing about it.
          if (path === `/messages/${panel.work.session}` || path === `/messages/${panel.work.failed_delivery}`) await page.getByTestId('agent-work').first().waitFor({ timeout: 10000 })
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

// Martín, 2026-10-28: «el tema de los hilos permite desplazamiento horizontal, eso no tiene sentido». The thread of a closed message with
// long replies, avatars, progress notices and the folded count must fit its own width at 390 px, and so must every box that holds it.
describe('the thread does not scroll sideways', () => {
  for (const width of [360, 390, 430]) {
    test(`${width}px`, async () => {
      const context = await panel.browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-CL' })
      const page = await context.newPage()
      try {
        await login(page, panel.origin)
        const body = await (await page.request.get(`${panel.origin}/api/messages?limit=200`)).json()
        const item = (body.items ?? body.messages ?? body.data ?? body).find((m) => /Hilo cerrado con avisos/.test(m.title))
        assert.ok(item, 'the sample data lacks the thread with notices')
        await page.goto(`${panel.origin}/messages/${item.id}`)
        await page.getByTestId('progress-note').first().waitFor()
        await settled(page)
        const m = await page.evaluate(() => {
          const out = []
          const vw = document.documentElement.clientWidth
          const thread = document.querySelector('[data-lane="reply-thread"]')
          for (let el = thread; el && el !== document.documentElement; el = el.parentElement) {
            if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}${el.dataset.lane ? `[${el.dataset.lane}]` : ''} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`)
          }
          for (const el of thread.querySelectorAll('*')) {
            const r = el.getBoundingClientRect()
            if (r.width > 1 && (r.right > vw + 1 || r.left < -1)) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(/\s+/).slice(0, 3).join('.')} left=${Math.round(r.left)} right=${Math.round(r.right)}`)
          }
          return { out: out.slice(0, 10), avatars: thread.querySelectorAll('[class*="rounded-full"]').length, notes: thread.querySelectorAll('[data-testid="progress-note"]').length }
        })
        assert.ok(m.notes >= 2 && m.avatars > 0, 'the thread shows notices and avatars')
        assert.deepStrictEqual(m.out, [], `the thread overflows at ${width}px:\n${m.out.join('\n')}`)
      } finally {
        await context.close()
      }
    })
  }
})
