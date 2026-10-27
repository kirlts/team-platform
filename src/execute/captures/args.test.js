import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { maskDefault, parseArgs, UsageError } from './args.js'

const op = (argv, options = {}) => parseArgs(argv, options).op

describe('parseArgs', () => {
  it('defaults to the root place, 1280x720, text tree and no capture', () => {
    const o = op([], { env: {} })
    assert.deepEqual([o.places, o.width, o.height, o.text, o.shot, o.full], [['/'], 1280, 720, false, null, false])
  })
  it('--shot takes a path only when the next word is an image file', () => {
    assert.equal(op(['/a', '--shot', 'one.png', '/b']).shot, 'one.png')
    assert.equal(op(['--shot', '/a']).shot, true)
    assert.deepEqual(op(['--shot', '/a']).places, ['/a'])
  })
  it('--clip implies a capture and asks for four numbers', () => {
    assert.deepEqual([op(['--clip', '0,0,100,50']).shot, op(['--clip', '0,0,100,50']).clip], [true, [0, 0, 100, 50]])
    assert.throws(() => op(['--clip', '1,2']), UsageError)
  })
  it('sizes: --phone, --desktop, --width and --height, and nothing under 200', () => {
    assert.deepEqual([op(['--phone']).width, op(['--phone']).height], [390, 844])
    assert.deepEqual([op(['--desktop']).width, op(['--desktop']).height], [1440, 900])
    assert.equal(op(['--width', '800', '--height', '600']).width, 800)
    assert.throws(() => op(['--width', '100']), /200 or more/)
  })
  it('flags of the host are accepted with a value and reach options.host; an unknown flag is refused', () => {
    assert.deepEqual(op(['/a', '--clinic', 'North', '--role', 'admin'], { hostFlags: ['clinic', 'role'] }).host, { clinic: 'North', role: 'admin' })
    assert.throws(() => op(['--clinic', 'North']), /unknown option: --clinic/)
    assert.throws(() => op(['--alt']), /needs a value/)
  })
  it('--help is answered before anything else', () => assert.deepEqual(parseArgs(['--help']), { help: true }))
  it('--last-only, --json and --alt', () => {
    const o = op(['--last-only', '--json', '--alt', 'The order list'])
    assert.deepEqual([o.lastOnly, o.json, o.alt], [true, true, 'The order list'])
  })
})

describe('masking default', () => {
  it('masks unless the platform lets captures show people, and LOOK_MASK decides over that', () => {
    assert.equal(maskDefault({}), true)
    assert.equal(maskDefault({ TEAM_CAPTURES_UNMASKED: 'denied' }), true)
    assert.equal(maskDefault({ TEAM_CAPTURES_UNMASKED: 'allowed' }), false)
    assert.equal(maskDefault({ TEAM_CAPTURES_UNMASKED: '1' }), false)
    assert.equal(maskDefault({ TEAM_CAPTURES_UNMASKED: 'allowed', LOOK_MASK: 'on' }), true)
    assert.equal(maskDefault({ LOOK_MASK: 'off' }), false)
  })
  it('--mask and --no-mask decide over the default', () => {
    assert.equal(op(['--no-mask'], { env: {} }).mask, false)
    assert.equal(op(['--mask'], { env: { TEAM_CAPTURES_UNMASKED: 'allowed' } }).mask, true)
  })
})
