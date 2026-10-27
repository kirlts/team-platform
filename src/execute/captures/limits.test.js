import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { imageTokens, MARGIN, MEASURED_SCREEN_MS, MEASURED_START_MS, runTimeoutMs, textTokens } from './limits.js'

describe('runTimeoutMs', () => {
  it('is the margin times the measured start and screens, and grows with the number of places', () => {
    assert.equal(runTimeoutMs(1, {}), MARGIN * (MEASURED_START_MS + MEASURED_SCREEN_MS))
    assert.equal(runTimeoutMs(3, {}) - runTimeoutMs(1, {}), MARGIN * 2 * MEASURED_SCREEN_MS)
  })
  it('LOOK_TIMEOUT_S replaces it, and a value that is not a number greater than zero is refused', () => {
    assert.equal(runTimeoutMs(5, { LOOK_TIMEOUT_S: '90' }), 90_000)
    for (const bad of ['0', '-1', 'abc']) assert.equal(runTimeoutMs(1, { LOOK_TIMEOUT_S: bad }), null, bad)
  })
})

describe('token estimates', () => {
  it('four characters a token for text, width × height / 750 for an image', () => {
    assert.equal(textTokens(14_000), 3500)
    assert.equal(imageTokens(1280, 720), 1229)
  })
})
