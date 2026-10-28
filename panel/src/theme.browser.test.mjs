// H-3732: the finish variables of the theme contract (MASTER-SPEC 7.8) in a real browser against dev-server.mjs serving panel/dist
// (`npm run test:flows`). Each variable exists with the value that leaves the panel as it was, and a host sheet that redefines it in :root
// changes what the panel draws, in both themes.
import assert from 'node:assert'
import { after, before, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_THEME_PORT ?? 8731), { stepMs: 80 })
  origin = panel.origin
})

after(async () => {
  await panel?.stop()
})

/**
 * What the panel gives each variable when no host sheet is loaded. A `css` entry is compared by what the browser computes for the
 * property with the variable against what it computes with the literal value (the browser writes colors in its own form); a `has`
 * entry is a substring of the gradient. `dark` is the value the dark theme had of its own.
 */
const DEFAULTS = {
  '--btn-gloss': { has: 'linear-gradient(180deg' },
  '--btn-border': { prop: 'border-top-color', light: 'oklch(0.3 0.1 255 / 0.55)', dark: 'oklch(0.85 0.1 240 / 0.6)' },
  '--btn-text-shadow': { prop: 'text-shadow', light: '0 1px 0 oklch(0.2 0.1 260 / 0.35)', dark: 'none' },
  '--orb-gloss': { has: 'radial-gradient(circle at 32% 26%' },
  '--orb-glow': { has: 'radial-gradient(circle at 50% 120%' },
  '--orb-ink': { prop: 'color', light: 'oklch(0.99 0 0)', dark: 'oklch(0.18 0.04 260)' },
  '--orb-text-shadow': { prop: 'text-shadow', light: '0 1px 1px oklch(0.2 0.1 260 / 0.55)', dark: 'none' },
  '--orb-shadow': { prop: 'box-shadow', is: 'inset 0 -2px 3px oklch(0.2 0.1 260 / 0.35), 0 1px 2px oklch(0.3 0.12 255 / 0.45)' },
  '--chrome-border': { prop: 'border-top-color', is: 'var(--color-line-strong)' },
  '--chrome-shadow': { prop: 'box-shadow', is: '0 8px 20px -12px oklch(0.35 0.14 255 / 0.5)' },
  '--selected-bg': { prop: 'background-color', is: 'var(--color-selected)' },
  '--selected-border': { prop: 'border-top-color', is: 'var(--color-accent)' },
  '--selected-ink': { prop: 'color', is: 'var(--color-fg)' },
  '--selected-shadow': { prop: 'box-shadow', is: 'none' },
  '--segmented-track': { prop: 'background-color', is: 'var(--color-raised)' },
  '--card-edge-width': { prop: 'width', is: '3px' },
}

/** The flat finish a host sets in :root: plain primary, plain avatar, one line under the bar, a pill on a track, no edge on the card. */
const FLAT = `:root{
  --btn-gloss:none;--btn-border:rgb(1, 2, 3);--btn-text-shadow:none;
  --orb-gloss:none;--orb-glow:none;--orb-ink:rgb(4, 5, 6);--orb-text-shadow:none;--orb-shadow:none;
  --chrome-border:rgb(7, 8, 9);--chrome-shadow:none;
  --selected-bg:rgb(250, 251, 252);--selected-border:rgb(10, 11, 12);--selected-ink:rgb(13, 14, 15);--selected-shadow:0 1px 2px rgb(0, 0, 0);
  --segmented-track:rgb(230, 231, 232);--card-edge-width:0px;
}`

async function open(colorScheme, path = '/') {
  const context = await panel.browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-CL', colorScheme })
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('team-theme', t)
    } catch {
      // Without storage the theme follows the browser's, which is already the requested one.
    }
  }, colorScheme)
  const page = await context.newPage()
  await login(page, origin, 'ana')
  if (path !== '/') await page.goto(`${origin}${path}`)
  await page.locator('main#main h1').first().waitFor()
  await settled(page)
  return { page, context }
}

/** The host sheet arrives; the controls animate their colors (140 ms), so the page is let to settle before it is measured. */
async function host(page) {
  await page.addStyleTag({ content: FLAT })
  await settled(page)
}

const style = (page, selector, props) =>
  page.locator(selector).first().evaluate((el, ps) => Object.fromEntries(ps.map((p) => [p, getComputedStyle(el).getPropertyValue(p)])), props)

describe('Theme contract: finish variables', () => {
  for (const scheme of ['light', 'dark']) {
    test(`${scheme}: every variable exists with the value that leaves the panel as it was`, async () => {
      const { page, context } = await open(scheme)
      try {
        const got = await page.evaluate(
          ([entries, scheme]) =>
            entries.map(([name, want]) => {
              const raw = getComputedStyle(document.documentElement).getPropertyValue(name).replace(/\s+/g, ' ').trim()
              if (!want.prop) return { name, raw }
              const probe = document.body.appendChild(document.createElement('i'))
              probe.style.setProperty(want.prop, `var(${name})`)
              const viaVariable = getComputedStyle(probe).getPropertyValue(want.prop)
              probe.style.removeProperty(want.prop)
              probe.style.setProperty(want.prop, want.is ?? want[scheme])
              const literal = getComputedStyle(probe).getPropertyValue(want.prop)
              probe.remove()
              return { name, raw, viaVariable, literal }
            }),
          [Object.entries(DEFAULTS), scheme],
        )
        for (const g of got) {
          const want = DEFAULTS[g.name]
          if (want.has) assert.ok(g.raw.includes(want.has), `${g.name} = «${g.raw}» no contiene «${want.has}»`)
          else {
            assert.ok(g.raw !== '', `${g.name} no existe`)
            assert.equal(g.viaVariable, g.literal, g.name)
          }
        }
      } finally {
        await context.close()
      }
    })

    test(`${scheme}: a host sheet that redefines them changes the primary button and the bar`, async () => {
      const { page, context } = await open(scheme)
      try {
        // The bar of text is glass while it is empty (DISENO.md): the gel is there once there is something to send.
        await page.getByLabel('Nuevo mensaje', { exact: true }).last().fill('Texto para que Enviar sea la acción de la pantalla')
        const btn = 'button.btn-gel'
        const before = await style(page, btn, ['background-image', 'border-top-color', 'text-shadow'])
        assert.ok(before['background-image'].split('linear-gradient').length - 1 >= 2, `gel de fábrica sin brillo: ${before['background-image']}`)
        const chromeBefore = await style(page, '.chrome-bar', ['box-shadow', 'border-bottom-color'])
        assert.notEqual(chromeBefore['box-shadow'], 'none')
        await host(page)
        const after = await style(page, btn, ['background-image', 'border-top-color', 'text-shadow'])
        assert.equal(after['background-image'].split('linear-gradient').length - 1, 1, `el brillo sigue: ${after['background-image']}`)
        assert.equal(after['border-top-color'], 'rgb(1, 2, 3)')
        assert.equal(after['text-shadow'], 'none')
        const chrome = await style(page, '.chrome-bar', ['box-shadow', 'border-bottom-color'])
        assert.equal(chrome['box-shadow'], 'none')
        assert.equal(chrome['border-bottom-color'], 'rgb(7, 8, 9)')
      } finally {
        await context.close()
      }
    })

    test(`${scheme}: a host sheet that redefines them changes the avatar`, async () => {
      const { page, context } = await open(scheme)
      try {
        const props = ['background-image', 'color', 'text-shadow', 'box-shadow']
        const before = await style(page, '.orb', props)
        assert.ok(before['background-image'].includes('radial-gradient'))
        await host(page)
        const after = await style(page, '.orb', props)
        assert.ok(!after['background-image'].includes('radial-gradient'), after['background-image'])
        assert.equal(after.color, 'rgb(4, 5, 6)')
        assert.equal(after['text-shadow'], 'none')
        assert.equal(after['box-shadow'], 'none')
      } finally {
        await context.close()
      }
    })

    test(`${scheme}: a host sheet that redefines them changes the chosen option of a switch and its track`, async () => {
      const { page, context } = await open(scheme, '/areas/a-error')
      try {
        const chosen = '[role=radiogroup] button[aria-checked=true]'
        const props = ['background-color', 'border-top-color', 'color', 'box-shadow']
        const before = await style(page, chosen, props)
        assert.equal(before['box-shadow'], 'none')
        const trackBefore = await style(page, '.opt-track', ['background-color'])
        await host(page)
        const after = await style(page, chosen, props)
        assert.equal(after['background-color'], 'rgb(250, 251, 252)')
        assert.equal(after['border-top-color'], 'rgb(10, 11, 12)')
        assert.equal(after.color, 'rgb(13, 14, 15)')
        assert.notEqual(after['box-shadow'], 'none')
        const track = await style(page, '.opt-track', ['background-color'])
        assert.notEqual(trackBefore['background-color'], track['background-color'])
        assert.equal(track['background-color'], 'rgb(230, 231, 232)')
      } finally {
        await context.close()
      }
    })

    test(`${scheme}: the width of the state edge of a card is the variable`, async () => {
      const { page, context } = await open(scheme, '/messages')
      try {
        const card = 'article.group'
        await page.locator(card).first().waitFor()
        const before = await style(page, card, ['box-shadow'])
        assert.match(before['box-shadow'], /inset/)
        assert.match(before['box-shadow'], / 3px 0px 0px/)
        await host(page)
        const after = await style(page, card, ['box-shadow'])
        assert.match(after['box-shadow'], / 0px 0px 0px/)
      } finally {
        await context.close()
      }
    })
  }
})
