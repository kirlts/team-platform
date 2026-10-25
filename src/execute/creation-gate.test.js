// UD-303: while the host has just said it has no capacity, a job does not run its scripts again; a session that ends opens the gate.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createCreationGate } from './runners.js'

describe('gate of the creation of machines', () => {
  it('lets the first call through, answers the next ones without a process after a 75, and passes the quota along', async () => {
    let t = 1000
    const gate = createCreationGate({ waitMs: 30_000, now: () => t })
    const first = await gate.enter()
    assert.equal(first.blocked, false)
    first.leave({ code: 75, stderr: 'ruido\n##team quota machines=2\n' })
    for (let i = 0; i < 5; i++) {
      const other = await gate.enter()
      assert.deepEqual({ blocked: other.blocked, stderr: other.stderr }, { blocked: true, stderr: '##team quota machines=2' }, 'five jobs that wait cost no process')
    }
    t += 30_001
    assert.equal((await gate.enter()).blocked, false, 'once per cycle one call asks the host again')
  })

  it('a success or a session that ends opens it at once', async () => {
    let t = 0
    const gate = createCreationGate({ waitMs: 30_000, now: () => t })
    ;(await gate.enter()).leave({ code: 75, stderr: '' })
    assert.equal((await gate.enter()).blocked, true)
    gate.open()
    const again = await gate.enter()
    assert.equal(again.blocked, false)
    again.leave({ code: 0, stderr: '' })
    assert.equal((await gate.enter()).blocked, false, 'a creation that worked blocks nobody')
  })
})
