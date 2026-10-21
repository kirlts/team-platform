import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Every environment variable that src/config.js reads appears by name in .env.example: no hidden
// variable that only whoever reads the code knows about.
test('.env.example names every variable in src/config.js, with no values', () => {
  const config = readFileSync(new URL('./config.js', import.meta.url), 'utf8')
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  const readVars = [...config.matchAll(/\b(?:textValue|intVar|decimal|boolVar|listValue|choiceVar|json)\(env, '([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1])
  assert.ok(readVars.length > 80)
  const absent = readVars.filter((n) => !new RegExp(`^#?\\s?${n}=`, 'm').test(example))
  assert.deepEqual(absent, [])
  // No values: every active line ends in «=».
  const withValue = example.split('\n').filter((l) => /^[A-Z][A-Z0-9_]*=./.test(l))
  assert.deepEqual(withValue, [])
})
