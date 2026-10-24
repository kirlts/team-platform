// The walkthrough of a proposal (UD-275): the shape of what it writes. Headless Chromium against a page of its own; nothing deployed.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { pathToFileURL } from 'node:url'
import { checkCaptures } from './team.mjs'
import { clock, recordWalkthrough, webmSize } from './walkthrough.mjs'

const PAGE = '<!doctype html><meta charset="utf-8"><title>Ficha</title><body style="font:16px sans-serif"><h1>Ficha</h1><button id="foto" onclick="document.getElementById(\'r\').textContent=\'Foto guardada\'">Tomar fotografía</button><p id="r"></p></body>'
const STEPS = [{ label: 'Abrir la ficha' }, { label: 'Apretar Tomar fotografía', click: '#foto' }, { label: 'Ver el resultado', target: '#r' }]
const MAX_VIDEO_BYTES = 50 * 1024 * 1024 // the test's own limit; the host's is UPLOAD_MAX_VIDEO_BYTES

describe('team walkthrough', () => {
  let server, url, playwright, dir
  before(async () => {
    server = createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE) })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${server.address().port}/`
    // Playwright is a dependency of the panel (its browser tests); a host that records walkthroughs has its own.
    const fromPanel = createRequire(new URL('../panel/package.json', import.meta.url))
    playwright = await import(pathToFileURL(fromPanel.resolve('playwright')).href)
    dir = mkdtempSync(join(tmpdir(), 'walkthrough-'))
  })
  after(() => { server.close(); rmSync(dir, { recursive: true, force: true }) })

  it('records a numbered route at the size of the profile: video, one screenshot per step, the second of each step', async () => {
    const out = join(dir, 'desktop')
    const r = await recordWalkthrough({ url, steps: STEPS, profiles: ['desktop'], outDir: out, place: 'Fichas > Paciente', as: 'Clínica Sur, recepción', masked: true, playwright })
    assert.deepEqual(r.failed, [])
    const video = readFileSync(join(out, 'walkthrough-desktop.webm'))
    assert.deepEqual(webmSize(video), { width: 1280, height: 720 }, 'the video is the size of the viewport, no bars')
    assert.ok(video.length < MAX_VIDEO_BYTES, `${video.length} bytes`)
    assert.deepEqual(r.steps.map((s) => s.n), [1, 2, 3])
    const times = r.steps.map((s) => s.at_ms)
    assert.deepEqual(times, [...times].sort((a, b) => a - b), 'the steps go in the order of the video')
    assert.ok(times.at(-1) < r.videos[0].duration_ms, 'every step starts inside the video')
    for (const s of r.steps) assert.ok(statSync(join(out, s.shot)).size > 0)
    assert.deepEqual(r.captures.map((c) => c.alt), [`Recorrido · ${clock(r.videos[0].duration_ms)}`, ...r.steps.map((s) => `${clock(s.at_ms)} · Paso ${s.n} · ${s.label}`)])
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'steps.json'), 'utf8')), r.steps, 'the list of steps is the one of the video')
    // What the platform will check on the declared files: type by first bytes, size, count.
    const checked = await checkCaptures(JSON.parse(readFileSync(join(out, 'captures.json'), 'utf8')), { dir: out, max: 3, maxBytes: 7 * 1024 * 1024, maxVideoBytes: MAX_VIDEO_BYTES })
    assert.deepEqual(checked.rejected, [])
    assert.deepEqual(checked.accepted.map((c) => c.kind), ['video', 'image', 'image', 'image'])
    assert.deepEqual(checked.accepted[0].mime, 'video/webm')
  })

  it('the phone profile records 390x844 and both profiles record two videos, each step labeled with its profile', async () => {
    const out = join(dir, 'both')
    const r = await recordWalkthrough({ url, steps: STEPS.slice(0, 2), profiles: ['desktop', 'phone'], outDir: out, place: 'Fichas > Paciente', as: 'Clínica Sur, recepción', playwright })
    assert.deepEqual(r.failed, [])
    assert.deepEqual(webmSize(readFileSync(join(out, 'walkthrough-phone.webm'))), { width: 390, height: 844 })
    assert.deepEqual(webmSize(readFileSync(join(out, 'walkthrough-desktop.webm'))), { width: 1280, height: 720 })
    assert.equal(r.steps.length, 4, 'two steps per profile')
    assert.ok(r.captures.some((c) => c.alt.endsWith('Paso 2 · Apretar Tomar fotografía (teléfono)')))
    assert.ok(statSync(join(out, 'step-2-phone.png')).size > 0)
  })

  it('a step that cannot run says so in one line and the steps before it stay; a missing browser says so and writes nothing', async () => {
    const r = await recordWalkthrough({ url, steps: [STEPS[0], { label: 'Apretar lo que no existe', click: '#nada', timeout: 1 }], profiles: ['desktop'], outDir: join(dir, 'broken'), place: 'x', as: 'y', playwright })
    assert.equal(r.failed.length, 1)
    assert.match(r.failed[0].reason, /^step 2: /)
    assert.deepEqual(r.steps.map((s) => s.n), [1])
    const none = await recordWalkthrough({ url, steps: STEPS, outDir: join(dir, 'none'), place: 'x', as: 'y', launch: async () => { throw new Error('Executable doesn\'t exist') } })
    assert.deepEqual([none.failed.length, none.captures.length], [1, 0])
    assert.match(none.failed[0].reason, /^no browser: /)
  })

  it('a video is refused where the caller gives no video limit, and a second video does not pass', async () => {
    const out = join(dir, 'desktop')
    const list = JSON.parse(readFileSync(join(out, 'captures.json'), 'utf8'))
    const noLimit = await checkCaptures(list, { dir: out, max: 3, maxBytes: 7 * 1024 * 1024 })
    assert.deepEqual(noLimit.rejected.map((x) => x.reason), ['not_image'])
    const twice = await checkCaptures([list[0], list[0]], { dir: out, max: 3, maxBytes: 7 * 1024 * 1024, maxVideoBytes: MAX_VIDEO_BYTES })
    assert.deepEqual(twice.rejected.map((x) => x.reason), ['too_many'])
  })
})
