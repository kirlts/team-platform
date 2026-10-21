// UD-025: the default of QUEUE_CONCURRENCY comes from a measurement, not from a convention. The line of the knob cites
// the file of the measurement, the file exists and it states the value chosen.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { loadConfig } from '../config.js'

const MEASUREMENT = 'docs/investigaciones/mediciones/2026-10-21-concurrencia-de-la-cola.md'
const root = new URL('../../', import.meta.url)

test('the default concurrency of the queue cites its measurement and the measurement states that value', () => {
  const knobLine = readFileSync(new URL('src/config.js', root), 'utf8').split('\n').find((l) => l.includes("'QUEUE_CONCURRENCY'"))
  assert.ok(knobLine.includes(MEASUREMENT), 'the QUEUE_CONCURRENCY line of src/config.js must cite the measurement file')
  assert.ok(existsSync(new URL(MEASUREMENT, root)), 'the measurement file must exist')
  const value = loadConfig({ DATA_DIR: '/tmp/x' }).worker.concurrency
  assert.ok(value > 1, 'UD-025: submissions are analyzed at the same time, not one after another')
  assert.match(readFileSync(new URL(MEASUREMENT, root), 'utf8'), new RegExp(`QUEUE_CONCURRENCY\\W+${value}\\b`))
})
