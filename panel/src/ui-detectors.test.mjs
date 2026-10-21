// The UI detectors (scripts/ui-detectors.mjs): each one is a pure function over the DOM, so each is
// tried on a minimal page with a failure and a clean case, and the whole pass is run once on a short
// real corrida. Run with `node --test src/ui-detectors.test.mjs`; the port comes from PANEL_DETECTORS_PORT.
// Not picked up by vitest (it only includes *.test.ts / *.test.tsx).

import { after, before, describe, test } from 'node:test'
import assert from 'node:assert'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { DETECTORS, installHelpers, readTypeScale, runDetector, SCREEN_IDS } from '../scripts/ui-detectors.mjs'

let browser
let page

before(async () => {
  browser = await chromium.launch({ headless: true, args: ['--ozone-platform=headless'] })
  page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
})
after(async () => {
  await browser?.close()
})

async function detect(name, html, input) {
  await page.setContent(`<!doctype html><html><body style="margin:0;font:15px/1.45 sans-serif">${html}</body></html>`)
  await page.evaluate(installHelpers)
  return runDetector(page, name, input)
}

describe('overlap', () => {
  test('flags two texts that cover each other', async () => {
    const r = await detect('overlap', '<div style="position:relative"><p style="position:absolute;top:0;left:0;margin:0">First text here</p><p style="position:absolute;top:5px;left:10px;margin:0">Second text here</p></div>')
    assert.equal(r.findings.length, 1)
    assert.equal(r.findings[0].rule, 'overlap')
  })
  test('ignores texts in a column, a dialog layer and a sticky header', async () => {
    const r = await detect('overlap', '<p>One</p><p>Two</p><div role="dialog" style="position:absolute;top:0;left:0"><p style="margin:0">Layer</p></div><h2 style="position:sticky;top:0;margin:0">Sticky</h2>')
    assert.deepEqual(r.findings, [])
  })
})

describe('tap-target', () => {
  test('flags two small buttons side by side', async () => {
    const r = await detect('tap-target', '<button style="width:16px;height:16px;padding:0">a</button><button style="width:16px;height:16px;padding:0">b</button>')
    assert.equal(r.findings.length, 2)
    assert.equal(r.findings[0].measure.width, 16)
  })
  test('accepts a 24 px control and an isolated small one', async () => {
    const r = await detect('tap-target', '<button style="width:24px;height:24px;padding:0">a</button><div style="height:200px"></div><button style="width:16px;height:16px;padding:0">b</button>')
    assert.deepEqual(r.findings, [])
  })
})

describe('sibling-alignment', () => {
  const item = (right, top = 0) => `<li style="position:relative;height:32px;list-style:none"><span>Label</span><span style="position:absolute;right:${right}px;top:${top}px;width:12px;height:12px;background:#000">2</span></li>`
  test('flags counts whose right edge differs by more than 1 px and one off the row center', async () => {
    const r = await detect('sibling-alignment', `<ul style="width:240px;margin:0;padding:0">${item(8)}${item(14)}${item(8, 4)}</ul>`)
    assert.ok(r.findings.some((f) => f.measure.axis === 'right' && f.measure.spread === 6), JSON.stringify(r.findings))
    assert.ok(r.findings.some((f) => f.measure.axis === 'center'), JSON.stringify(r.findings))
  })
  test('accepts counts on one edge and one center, and rows without a count', async () => {
    const r = await detect('sibling-alignment', `<ul style="width:240px;margin:0;padding:0">${item(8, 10)}<li style="height:32px;list-style:none">Only a label that is long enough to be wide</li>${item(8, 10)}</ul>`)
    assert.deepEqual(r.findings, [])
  })
})

describe('type-scale', () => {
  const scale = readTypeScale()
  test('reads the steps of styles.css', () => {
    assert.deepEqual(scale.steps.slice(0, 3).map((px) => Math.round(px)), [12, 15, 17])
    assert.equal(scale.headingMin, 18.75)
  })
  test('flags a size outside the scale', async () => {
    const r = await detect('type-scale', '<p style="font-size:13.8px">Odd size</p>', scale)
    assert.equal(r.findings.length, 1)
    assert.equal(r.findings[0].measure.font_size_px, 13.8)
  })
  test('accepts the steps and a heading size', async () => {
    const r = await detect('type-scale', '<p style="font-size:12px">a</p><p style="font-size:15px">b</p><h1 style="font-size:29px">c</h1>', scale)
    assert.deepEqual(r.findings, [])
  })
})

describe('contrast', () => {
  test('flags light grey text on white', async () => {
    const r = await detect('contrast', '<div style="background:#fff"><p style="color:#bbb">Faint text</p></div>')
    assert.equal(r.findings.length, 1)
    assert.ok(r.findings[0].measure.ratio < 4.5)
  })
  test('accepts black on white and skips text on a gradient', async () => {
    const r = await detect('contrast', '<div style="background:#fff"><p style="color:#000">Clear</p></div><div style="background:linear-gradient(red,blue)"><p style="color:#bbb">On gradient</p></div>')
    assert.deepEqual(r.findings, [])
    assert.equal(r.unmeasurable, 1)
  })
})

describe('overflow-clip', () => {
  test('flags a cut text and a box outside the window', async () => {
    const r = await detect('overflow-clip', '<div style="width:50px;overflow:hidden;white-space:nowrap">A very long text that is cut</div><p style="position:absolute;left:780px;margin:0;width:100px">Out of the window</p>')
    assert.equal(r.findings.length, 2)
  })
  test('accepts a text that fits', async () => {
    const r = await detect('overflow-clip', '<div style="width:300px;overflow:hidden">Short</div>')
    assert.deepEqual(r.findings, [])
  })
})

describe('horizontal-scroll', () => {
  test('flags a document wider than the window', async () => {
    const r = await detect('horizontal-scroll', '<div style="width:1200px;height:10px">wide</div>')
    assert.equal(r.findings.length, 1)
    assert.ok(r.findings[0].measure.overflow_px >= 400)
  })
  test('accepts a document that fits', async () => {
    assert.deepEqual((await detect('horizontal-scroll', '<p>fits</p>')).findings, [])
  })
})

describe('page-height', () => {
  test('reports a ratio above 1 for a tall document and 1 for a short one', async () => {
    const tall = await detect('page-height', '<div style="height:1500px">tall</div>')
    assert.equal(tall.ratio, 2.5)
    const short = await detect('page-height', '<p>short</p>')
    assert.equal(short.ratio, 1)
  })
})

describe('equal-weight', () => {
  const chip = (n) => Array.from({ length: n }, (_, i) => `<span style="background:#d0021b;color:#fff;padding:4px">Alert ${i}</span> `).join('')
  test('flags more than three chips with the same saturated fill', async () => {
    const r = await detect('equal-weight', chip(5), { max: 3 })
    assert.equal(r.findings.length, 1)
    assert.equal(r.findings[0].measure.count, 5)
  })
  test('accepts three chips and neutral fills', async () => {
    const r = await detect('equal-weight', chip(3) + Array.from({ length: 6 }, () => '<span style="background:#e8e8ee;padding:4px">grey</span>').join(''), { max: 3 })
    assert.deepEqual(r.findings, [])
  })
})

describe('voice', () => {
  const patterns = [{ id: 'second-person', source: '\\b(puedes|tienes)\\b', flags: 'iu' }]
  test('flags a visible text that matches a pattern', async () => {
    const r = await detect('voice', '<p>Aquí puedes escribir</p>', { patterns })
    assert.equal(r.findings.length, 1)
  })
  test('accepts an instrument label', async () => {
    assert.deepEqual((await detect('voice', '<p>Mensajes</p>', { patterns })).findings, [])
  })
})

describe('the whole pass', () => {
  test('a short real corrida writes a JSON with the declared shape', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'ui-detectors-')), 'detectors.json')
    // The unit browser is closed first: one browser at a time.
    await browser.close()
    browser = undefined
    execFileSync('node', ['scripts/ui-detectors.mjs', '--screens', 'home', '--viewports', 'desktop', '--themes', 'light', '--out', out], {
      env: { ...process.env, PANEL_DETECTORS_PORT: process.env.PANEL_DETECTORS_PORT ?? '8974' },
      stdio: 'ignore',
      cwd: new URL('..', import.meta.url).pathname,
    })
    assert.ok(existsSync(out))
    const report = JSON.parse(readFileSync(out, 'utf8'))
    assert.ok(!Number.isNaN(Date.parse(report.generated_at)))
    assert.deepEqual(report.viewports, ['desktop'])
    assert.deepEqual(report.themes, ['light'])
    assert.deepEqual(Object.keys(report.screens), ['home'])
    assert.ok(SCREEN_IDS.includes('home'))
    const home = report.screens.home
    assert.equal(home.route, '/')
    assert.equal(typeof home.page_height_ratio['desktop-light'], 'number')
    assert.ok(Array.isArray(home.findings))
    for (const f of home.findings) {
      assert.deepEqual(Object.keys(f).sort(), ['detail', 'measure', 'rule', 'selector', 'theme', 'viewport'])
      assert.ok(Object.keys(DETECTORS).includes(f.rule))
    }
    assert.ok(Array.isArray(report.skipped))
    assert.equal(report.summary.total, home.findings.length)
    assert.equal(typeof report.summary.by_rule, 'object')
    assert.equal(report.summary.by_screen.home, home.findings.length)
  })
})
