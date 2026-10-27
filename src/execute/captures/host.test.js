import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { loadHost, normalizeHost } from './host.js'

describe('normalizeHost', () => {
  it('fills every omission: an empty adapter is valid and looks at an origin as a visitor', () => {
    const host = normalizeHost({})
    assert.deepEqual([host.origin, host.flags, host.allowHosts, host.session, host.url, host.menuStart], [null, [], [], null, null, null])
    assert.deepEqual(host.guard, { browserPosts: [], blockedGets: [], sessionPosts: {} })
    assert.ok(host.loadingText instanceof RegExp && host.expiredText instanceof RegExp && host.loginPaths instanceof RegExp)
    assert.ok(host.mask.learnFrom.test('/anything'))
  })
  it('names what is wrong in the adapter', () => {
    assert.throws(() => normalizeHost({ origin: 3 }), /origin has to be a string/)
    assert.throws(() => normalizeHost({ flags: 'clinic' }), /flags has to be a list of strings/)
    assert.throws(() => normalizeHost({ guard: { blockedGets: ['/x'] } }), /guard.blockedGets has to be a list of RegExp/)
    assert.throws(() => normalizeHost({ guard: { sessionPosts: { login: '/x' } } }), /guard.sessionPosts.login has to be a RegExp/)
    assert.throws(() => normalizeHost({ session: 'yes' }), /session has to be a function/)
    assert.throws(() => normalizeHost({ loadingText: 'Loading' }), /loadingText has to be a RegExp/)
    assert.throws(() => normalizeHost(null), /has to export an object/)
  })
  it('the mask rules take the host\'s keys over the defaults', () => {
    const host = normalizeHost({ mask: { personKey: /^rut$/ } })
    assert.ok(host.mask.rules.personKey.test('rut'))
    assert.ok(!host.mask.rules.personKey.test('email'))
    assert.ok(host.mask.rules.genericKey.test('name'), 'what the host did not name keeps the default')
  })
})

describe('loadHost', () => {
  it('without a file, the adapter of omissions', async () => assert.equal((await loadHost(undefined)).origin, null))
  it('loads the default export of a file, relative to the working directory', async () => {
    const host = await loadHost('src/execute/captures/testing/host-example.mjs', new URL('../../../', import.meta.url).pathname)
    assert.deepEqual(host.flags, ['account'])
    assert.equal(typeof host.session, 'function')
  })
  it('says which file is missing and which one does not load', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'host-'))
    try {
      await assert.rejects(loadHost('nope.mjs', dir), /LOOK_HOST points at .*nope\.mjs and there is no such file/)
      writeFileSync(join(dir, 'broken.mjs'), 'export default {')
      await assert.rejects(loadHost('broken.mjs', dir), /the adapter .*broken\.mjs could not be loaded/)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
