// The directed selection (UD-265): every pattern of src/testing/areas.json matches something, and the guards that always run exist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const config = JSON.parse(readFileSync(path.join(root, 'src/testing/areas.json'), 'utf8'))

test('every guard that always runs exists', () => {
  for (const g of config.always) assert.ok(globSync(g, { cwd: root }).length > 0, `${g} matches no file`)
})

test('every test pattern of an area matches at least one file', () => {
  for (const [area, globs] of Object.entries(config.areas)) for (const g of globs) assert.ok(globSync(g, { cwd: root }).length > 0, `${area}: ${g} matches no file`)
})

test('the tests on the image exist and the paths that select them exist', () => {
  for (const t of config.image.tests) assert.ok(globSync(t, { cwd: root }).length > 0, `${t} matches no file`)
  for (const p of config.image.paths) assert.ok(globSync(p.endsWith('/') ? `${p}**` : p, { cwd: root }).length > 0, `${p} matches no file`)
})
