// The colored edges of the panel are theme variables (MASTER-SPEC 7.8): a host sheet that turns them off leaves no visible border in a
// chromatic color on any screen, the status light has no halo and the chosen option of a quiet switch is the host's pill. Real browser
// against dev-server.mjs serving panel/dist (`npm run test:flows`), at 1440x900 and 390x844, in both themes.
import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''
const csrf = { 'x-team-request': 'panel' }

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_THEME_EDGES_PORT ?? 8732), { stepMs: 80 })
  origin = panel.origin
})
after(async () => {
  await panel?.stop()
})

/** What a host that separates by tone and never by a colored line sets in :root. */
const NO_EDGES = `:root{
  --card-edge-width:0px;--ai-edge-width:0px;--area-chip-edge-width:0px;--tint-border-width:0px;--notice-edge-width:0px;--led-shadow:none;
  --selected-border:transparent;--btn2-hover-border:var(--color-line-strong);--btn-danger-hover-border:transparent;
  --control-hover-edge:var(--color-line-strong);--pressed-edge:var(--color-line-strong);
  --quiet-tab-edge:transparent;--quiet-tab-bg:rgb(250, 251, 252);--quiet-tab-radius:9999px;--quiet-tab-shadow:0 1px 2px rgb(0, 0, 0);--quiet-tab-track:rgb(230, 231, 232);
}`

/** Visible borders whose color is not a gray: the spread between the channels, by the alpha, above a threshold a gray never reaches. */
function chromaticEdges() {
  const chroma = (c) => {
    const m = c.match(/rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[,/ ]+([\d.]+))?/)
    if (!m) return 0
    const [r, g, b] = [m[1], m[2], m[3]].map(Number)
    return (Math.max(r, g, b) - Math.min(r, g, b)) * (m[4] === undefined ? 1 : Number(m[4]))
  }
  const out = []
  for (const el of document.querySelectorAll('#main *, header *')) {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0 || el === document.activeElement) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden') continue
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== 'none' && chroma(s[`border${side}Color`]) > 12) {
        out.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 4).join('.')} ${side} ${s[`border${side}Color`]}`)
        break
      }
    }
  }
  return out
}

async function routes(page) {
  const review = await (await page.request.post(`${origin}/api/_control/review`, { headers: csrf })).json()
  const list = (await (await page.request.get(`${origin}/api/messages?limit=200`)).json()).items
  const replies = list.find((m) => /Agregar exportación/.test(m.title))
  assert.ok(replies, 'the sample data lacks the message with replies')
  await page.request.post(`${origin}/api/messages/${replies.id}/forward`, { data: { member_id: 'u-bruno', comment: 'Para que lo mires' }, headers: csrf })
  return ['/', '/messages', `/messages/${review.message_id}`, `/messages/${replies.id}`, '/areas', '/areas/a-error', '/team', '/settings', '/connections']
}

describe('Theme contract: a host without colored edges', () => {
  for (const scheme of ['light', 'dark']) {
    for (const [name, viewport, mobile] of [['desktop', { width: 1440, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
      test(`${scheme}, ${name}: no screen draws a border in a color`, async () => {
        await panel.control.reset()
        const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: scheme, isMobile: mobile, hasTouch: mobile })
        await context.addInitScript(([css, t]) => {
          try { localStorage.setItem('team-theme', t) } catch { /* the theme follows the browser's */ }
          document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.append(s) })
        }, [NO_EDGES, scheme])
        try {
          const page = await context.newPage()
          await login(page, origin, 'ana')
          const found = []
          for (const path of await routes(page)) {
            await page.goto(`${origin}${path}`)
            await page.locator('main#main').waitFor()
            await settled(page)
            for (const edge of await page.evaluate(chromaticEdges)) found.push(`${path}: ${edge}`)
          }
          assert.deepEqual(found, [])
        } finally {
          await context.close()
        }
      })
    }
  }

  test('the status light, the forward notice and the quiet switch take the host values', async () => {
    await panel.control.reset()
    const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme: 'light' })
    try {
      const page = await context.newPage()
      await login(page, origin, 'ana')
      const paths = await routes(page)
      await page.goto(`${origin}${paths[3]}`)
      await page.getByTestId('forward-notice').waitFor()
      await settled(page)
      const notice = () => page.getByTestId('forward-notice').evaluate((el) => getComputedStyle(el).borderLeftWidth)
      const led = () => page.locator('.led').first().evaluate((el) => getComputedStyle(el, '::before').boxShadow)
      assert.equal(await notice(), '2px')
      assert.notEqual(await led(), 'none')
      await page.addStyleTag({ content: NO_EDGES })
      await settled(page)
      assert.equal(await notice(), '0px')
      assert.equal(await led(), 'none')
      await page.goto(origin)
      await page.locator('main#main').waitFor()
      await page.addStyleTag({ content: NO_EDGES })
      await settled(page)
      const chosen = await page.locator('[role=radiogroup] button[aria-checked=true].border-b-2').first().evaluate((el) => {
        const s = getComputedStyle(el)
        return { bg: s.backgroundColor, edge: s.borderBottomColor, shadow: s.boxShadow, track: getComputedStyle(el.parentElement).backgroundColor }
      })
      assert.equal(chosen.bg, 'rgb(250, 251, 252)')
      assert.equal(chosen.edge, 'rgba(0, 0, 0, 0)')
      assert.notEqual(chosen.shadow, 'none')
      assert.equal(chosen.track, 'rgb(230, 231, 232)')
    } finally {
      await context.close()
    }
  })
})
