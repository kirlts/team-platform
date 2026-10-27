// The browser tests read an element's count only after the element is drawn: `locator.count()` does not wait, so a count read in the frame the page opened
// is 0 when the machine is loaded (gallery.browser.test.mjs and flows-borrar.browser.test.mjs failed that way on the harness, 2026-10-26, three browsers at a time).
// Prohibits: an `assert.equal(await <locator>.count(), N)` with N >= 1 (or `count() > 0`) whose previous line does not wait for that same locator.
import assert from 'node:assert'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = path.dirname(fileURLToPath(import.meta.url))

test('every count of 1 or more in a browser test follows a wait for the same element', () => {
  const offenders = []
  for (const name of readdirSync(src).filter((f) => f.endsWith('.browser.test.mjs'))) {
    const lines = readFileSync(path.join(src, name), 'utf8').split('\n')
    lines.forEach((line, i) => {
      const m = line.match(/^\s*assert\.(?:equal|ok)\(\(?await (.+?)\.count\(\)\)?(?:, [1-9]\d*| > 0(?=[,)]))/)
      if (!m || m[1].includes('await')) return
      const wait = `${m[1]}.first().waitFor(`
      if (!lines.slice(Math.max(0, i - 6), i).some((l) => l.includes(wait) || l.includes(`${m[1]}.waitFor(`))) offenders.push(`${name}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [], `count() reads without waiting for the element: ${offenders.join(', ')}`)
})
