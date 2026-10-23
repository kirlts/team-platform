// The checks on the screenshots a session declares (UD-268): type by first bytes, size, count, a path inside the directory and `masked`.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { captureName, checkCaptures } from '../../scripts/team.mjs'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png-body')])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-body')])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 ')])
const GIF = Buffer.from('GIF89a-not-accepted')

describe('checkCaptures', () => {
  let base, dir
  const limits = () => ({ dir, max: 3, maxBytes: 1000, zone: 'ninguna', openZone: 'ninguna' })
  const shot = (path, extra = {}) => ({ path, alt: 'Vista de pacientes', masked: true, place: 'Pacientes', as: 'Clínica Sur, doctor', ...extra })
  const reasons = (r) => r.rejected.map((x) => x.reason)

  before(() => {
    base = mkdtempSync(join(tmpdir(), 'captures-'))
    dir = join(base, 'captures')
    mkdirSync(dir)
    for (const [name, bytes] of Object.entries({ 'a.png': PNG, 'b.jpg': JPEG, 'c.webp': WEBP, 'd.gif': GIF, 'big.png': Buffer.concat([PNG, Buffer.alloc(2000)]), 'png-named.txt': PNG, 'jpeg-named.png': JPEG })) writeFileSync(join(dir, name), bytes)
    writeFileSync(join(base, 'secret.png'), PNG)
    symlinkSync(join(base, 'secret.png'), join(dir, 'link.png'))
    mkdirSync(join(dir, 'sub'))
    writeFileSync(join(dir, 'sub', 'e.png'), PNG)
  })
  after(() => rmSync(base, { recursive: true, force: true }))

  it('accepts PNG, JPEG and WebP by their first bytes, not by their name', async () => {
    const r = await checkCaptures([shot('a.png'), shot('b.jpg'), shot('c.webp')], limits())
    assert.deepEqual(r.accepted.map((c) => [c.mime, c.ext]), [['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp']])
    assert.deepEqual(reasons(r), [])
    const named = await checkCaptures([shot('png-named.txt'), shot('jpeg-named.png')], limits())
    assert.deepEqual(named.accepted.map((c) => c.mime), ['image/png', 'image/jpeg'])
  })

  it('leaves out what is not an image, is too large, is missing or is outside the directory', async () => {
    const r = await checkCaptures([shot('d.gif'), shot('big.png'), shot('nope.png'), shot('/etc/passwd'), shot('link.png'), shot('sub')], { ...limits(), max: 10 })
    assert.deepEqual(reasons(r), ['not_image', 'too_large', 'missing', 'outside', 'outside', 'missing'])
    assert.equal(r.accepted.length, 0)
  })

  it('takes a file in a subdirectory and stops at the maximum', async () => {
    const r = await checkCaptures([shot('sub/e.png'), shot('a.png'), shot('b.jpg'), shot('c.webp')], limits())
    assert.equal(r.accepted.length, 3)
    assert.deepEqual(r.rejected, [{ index: 3, reason: 'too_many' }])
  })

  it('needs path, a one-line alt, place, as and a boolean masked', async () => {
    const bad = [shot('a.png', { alt: '' }), shot('a.png', { alt: 'dos\nlíneas' }), shot('a.png', { place: ' ' }), shot('a.png', { as: undefined }), shot('a.png', { masked: 'true' }), { alt: 'x' }, null, 'a.png']
    const r = await checkCaptures(bad, { ...limits(), max: 20 })
    assert.deepEqual(reasons(r), Array(8).fill('invalid'))
  })

  it('attaches an unmasked capture only when the declared zone is the open one', async () => {
    const unmasked = [shot('a.png', { masked: false })]
    assert.equal((await checkCaptures(unmasked, limits())).accepted.length, 1)
    for (const zone of ['datos de personas', 'pagos', '', null, undefined]) assert.deepEqual(reasons(await checkCaptures(unmasked, { ...limits(), zone })), ['unmasked_sensitive'], String(zone))
    assert.equal((await checkCaptures([shot('a.png')], { ...limits(), zone: 'datos de personas' })).accepted.length, 1, 'masked true goes with any zone')
  })

  it('names the attachment with its label and the alt without path characters', () => {
    assert.equal(captureName('Antes', 'Ficha de pacientes', '.png'), 'Antes - Ficha de pacientes.png')
    assert.equal(captureName('Después', ' a/b\\c\td ', '.jpg'), 'Después - a b c d.jpg')
  })

  it('a directory that does not exist, or none declared, rejects everything', async () => {
    assert.deepEqual(reasons(await checkCaptures([shot('a.png')], { ...limits(), dir: join(base, 'ninguno') })), ['missing'])
    assert.deepEqual(reasons(await checkCaptures([shot('a.png')], { ...limits(), dir: '' })), ['missing'])
  })
})
