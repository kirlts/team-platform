// The declaration of a capture (UD-268) is what the platform checks; the test passes the tool's own declarations through the platform's own check.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { checkCaptures } from '../../../scripts/team.mjs'
import { CAPTURE_MARKER, declaration, declarationLine, declaredPath, defaultAlt, placeOf } from './declare.js'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
let dir

before(() => { dir = mkdtempSync(join(tmpdir(), 'declare-')); mkdirSync(join(dir, 'sub')); writeFileSync(join(dir, 'a.png'), PNG); writeFileSync(join(dir, 'sub', 'b.png'), PNG) })
after(() => rmSync(dir, { recursive: true, force: true }))

describe('declaration', () => {
  it('carries path, alt, place, as and masked, with the path relative to the captures folder', () => {
    const d = declaration({ file: join(dir, 'sub', 'b.png'), capturesDir: dir, alt: 'Orders · 3 rows', place: '/orders', as: 'North, role admin', masked: true })
    assert.deepEqual(d, { path: 'sub/b.png', alt: 'Orders · 3 rows', place: '/orders', as: 'North, role admin', masked: true })
  })
  it('keeps an absolute path for a file outside the folder, and without a folder', () => {
    assert.equal(declaredPath('/elsewhere/x.png', dir), '/elsewhere/x.png')
    assert.equal(declaredPath('/elsewhere/x.png', null), '/elsewhere/x.png')
  })
  it('masked is true only when it is exactly true', () => {
    for (const value of ['yes', 1, undefined, null]) assert.equal(declaration({ file: 'x.png', alt: 'a', place: 'p', as: 'q', masked: value }).masked, false)
  })
  it('an alt is one line of at most 120 characters', () => {
    const d = declaration({ file: 'x.png', alt: `line one\nline two ${'x'.repeat(200)}`, place: 'p', as: 'q', masked: false })
    assert.ok(!/[\r\n]/.test(d.alt))
    assert.equal(d.alt.length, 120)
  })
  it('the line the session reads is the marker and the JSON', () => {
    const d = declaration({ file: join(dir, 'a.png'), capturesDir: dir, alt: 'x', place: 'p', as: 'q', masked: false })
    assert.equal(declarationLine(d), `${CAPTURE_MARKER} ${JSON.stringify(d)}`)
    assert.deepEqual(JSON.parse(declarationLine(d).slice(CAPTURE_MARKER.length + 1)), d)
  })
  it('passes the check of the platform: accepted with masked true, left out as unmasked_sensitive with masked false and no open zone', async () => {
    const masked = declaration({ file: join(dir, 'a.png'), capturesDir: dir, alt: 'A', place: '/a', as: 'visitor', masked: true })
    const shown = declaration({ file: join(dir, 'sub', 'b.png'), capturesDir: dir, alt: 'B', place: '/b', as: 'visitor', masked: false })
    const options = { dir, max: 3, maxBytes: 1024 * 1024 }
    const closed = await checkCaptures([masked, shown], options)
    assert.deepEqual(closed.accepted.map((c) => c.path), ['a.png'])
    assert.deepEqual(closed.rejected, [{ index: 1, reason: 'unmasked_sensitive' }])
    const open = await checkCaptures([masked, shown], { ...options, zone: 'open', openZone: 'open' })
    assert.deepEqual(open.accepted.map((c) => c.path), ['a.png', 'sub/b.png'])
    const allowed = await checkCaptures([shown], { ...options, unmasked: true })
    assert.equal(allowed.accepted.length, 1)
  })
})

describe('alt and place', () => {
  it('the alt is the title and the first heading when the title does not say it', () => {
    assert.equal(defaultAlt('Orders', 'Open orders'), 'Orders · Open orders')
    assert.equal(defaultAlt('Open orders - Shop', 'Open orders'), 'Open orders - Shop')
    assert.equal(defaultAlt('  Orders  ', ''), 'Orders')
    assert.equal(defaultAlt('T', 'First line\nsecond'), 'T · First line')
  })
  it('the place of a route is the path and query where the page ended; of a menu, the menu as it was given', () => {
    assert.equal(placeOf('/orders', new URL('https://x.example/orders?page=2')), '/orders?page=2')
    assert.equal(placeOf('?tab=models', new URL('https://x.example/?tab=models')), '/?tab=models')
    assert.equal(placeOf('Settings > Team', new URL('https://x.example/settings/team')), 'Settings > Team')
    assert.equal(placeOf('Orders', new URL('https://x.example/orders')), 'Orders')
  })
})
