// Two browser test files that default to the same port collide when the runner starts them together (`--test-concurrency=3`):
// the second dev server leaves with «¿está ocupado?» and its file fails (measured 2026-10-26 on the deployment machine: eight
// files shared 8806, 8807, 8742 and 8797). The default port of each file is its own.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))

test('every browser test file defaults to a port no other file defaults to', () => {
  const byPort = new Map()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.browser.test.mjs'))) {
    const text = readFileSync(join(dir, file), 'utf8')
    // The port after the last `??` of each `PANEL_…PORT` expression is the one used when no variable is set.
    for (const m of text.matchAll(/PANEL_[A-Z0-9_]*PORT(?:\s*\?\?\s*process\.env\.PANEL_[A-Z0-9_]*PORT)*\s*\?\?\s*(\d{4})/g)) {
      const owners = byPort.get(m[1]) ?? new Set()
      owners.add(file)
      byPort.set(m[1], owners)
    }
  }
  const shared = [...byPort].filter(([, owners]) => owners.size > 1).map(([port, owners]) => `${port}: ${[...owners].join(', ')}`)
  assert.deepEqual(shared, [])
})
