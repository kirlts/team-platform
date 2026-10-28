// A wider typeface or a larger letter must not break the composition (plan 1.0.0, finding of the theme judge): in Settings, Areas and Team the
// content wraps or yields, and no box overlaps another or sticks out of the box that holds it. Two ways of making the letters wider, both
// measured at 1440x900 and 390x844: the host's sheet setting a wide system face (DejaVu Sans), and the root font size at 120 %.
// Real browser against dev-server.mjs serving panel/dist (`npm run test:flows`).
import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { installHelpers, runDetector } from '../scripts/ui-detectors.mjs'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_WIDE_FONT_PORT ?? 8984), { stepMs: 80 })
  origin = panel.origin
})
after(async () => {
  await panel?.stop()
})

const WIDE_FACE = `:root{--font-sans:"DejaVu Sans",Verdana,sans-serif;--font-display:"DejaVu Sans",Verdana,sans-serif;}`
const BIG_LETTER = `html{font-size:120%}`
const ROUTES = ['/settings', '/areas', '/team']
const SIZES = [['1440x900', { width: 1440, height: 900 }, false], ['390x844', { width: 390, height: 844 }, true]]

/** Elements with text or a control whose box leaves the box of the element that holds it, sideways (the text does not wrap or yield). */
function stickingOut(STICK_PX = 8) {
  const out = []
  const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : ''} «${(el.textContent ?? '').trim().slice(0, 24)}»`
  for (const el of document.querySelectorAll('main#main *')) {
    const isLeafText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (!isLeafText && !['BUTTON', 'A', 'INPUT', 'SELECT'].includes(el.tagName)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue
    const p = el.parentElement
    const s = getComputedStyle(p)
    // A scroll container or a clipped box shows only its part on purpose; an ellipsis on the element itself is the designed cut of a name.
    if (s.overflowX !== 'visible') continue
    const pr = p.getBoundingClientRect()
    if (pr.width === 0) continue
    // 8 px: the 6 px that the edit-in-place fields and the keyboard-focus rings take with a negative margin on purpose.
    const by = Math.max(r.right - pr.right, pr.left - r.left)
    if (by > STICK_PX) out.push(`${label(el)} sticks out of ${label(p)} by ${Math.round(by)} px`)
  }
  return out
}

async function measure(css) {
  const found = []
  for (const [size, viewport, mobile] of SIZES) {
    await panel.control.reset()
    const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light', isMobile: mobile, hasTouch: mobile })
    await context.addInitScript(() => { try { localStorage.setItem('team-theme', 'light') } catch { /* the browser's scheme is light */ } })
    try {
      const page = await context.newPage()
      await login(page, origin, 'ana')
      for (const path of ROUTES) {
        await page.goto(`${origin}${path}`)
        await page.locator('main#main').waitFor()
        await page.addStyleTag({ content: css })
        await page.evaluate(() => document.fonts.ready)
        await settled(page)
        await page.evaluate(installHelpers)
        const overlap = await runDetector(page, 'overlap')
        for (const f of overlap.findings) found.push(`${size} ${path}: ${f.detail}`)
        for (const s of await page.evaluate(stickingOut, 8)) found.push(`${size} ${path}: ${s}`)
        const wide = await runDetector(page, 'horizontal-scroll')
        for (const f of wide.findings) found.push(`${size} ${path}: ${f.detail}`)
      }
    } finally {
      await context.close()
    }
  }
  return found
}

describe('Composition with wider letters', () => {
  test('a wide system face set by the host sheet: nothing overlaps and nothing leaves its box', async () => {
    const context = await panel.browser.newContext()
    const page = await context.newPage()
    const widths = await page.evaluate(() => {
      const w = (face) => { const s = document.createElement('span'); s.style.cssText = `font:15px ${face};position:absolute;white-space:nowrap`; s.textContent = 'Cambiar contraseña Retroalimentación'; document.body.append(s); const n = s.getBoundingClientRect().width; s.remove(); return n }
      return { dejavu: w('"DejaVu Sans", monospace'), fallback: w('"Nonexistent Face", monospace') }
    })
    await context.close()
    // Without the face on the machine the browser falls back and the check would measure nothing: the test says so instead of passing.
    assert.notEqual(widths.dejavu, widths.fallback, 'DejaVu Sans is not installed on this machine')
    assert.deepEqual(await measure(WIDE_FACE), [])
  })

  test('the root font size at 120 %: nothing overlaps and nothing leaves its box', async () => {
    assert.deepEqual(await measure(BIG_LETTER), [])
  })

  test('the checks see a real break: a box forced narrower than its button is reported', async () => {
    const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL' })
    try {
      const page = await context.newPage()
      await login(page, origin, 'ana')
      await page.goto(`${origin}/settings`)
      await page.locator('main#main').waitFor()
      await page.addStyleTag({ content: `main#main button{white-space:nowrap;min-width:700px}` })
      await settled(page)
      assert.ok((await page.evaluate(stickingOut, 8)).length > 0)
    } finally {
      await context.close()
    }
  })
})
