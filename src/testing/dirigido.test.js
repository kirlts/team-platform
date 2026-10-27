// The directed selection (UD-265): every pattern of src/testing/areas.json matches something, and the guards that always run exist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, globSync, readdirSync, readFileSync } from 'node:fs'
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

// The class of 2026-10-26: the server changed a role and eight tests of the client turned red because no change of the client had been made and the
// selection looked only there. Every file that registers a route or applies a role must be under a path that runs the client suite.
test('every source file that registers routes or requires a role runs the suite of the client', () => {
  const walk = (dir) => readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) return e.name === 'testing' ? [] : walk(rel)
    return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [rel] : []
  })
  const covered = (file) => config.client.paths.some((p) => file === p || file.startsWith(p))
  const uncovered = walk('src').filter((f) => /\brequireRole\(|\bapp\.(get|post|put|patch|delete)\(/.test(readFileSync(path.join(root, f), 'utf8'))).filter((f) => !covered(f))
  assert.deepEqual(uncovered, [], 'these files shape the API and no path of `client` in src/testing/areas.json covers them')
})

test('the paths that run the client suite exist, and so does the package', () => {
  assert.ok(existsSync(path.join(root, config.client.run, 'package.json')))
  for (const p of config.client.paths) assert.ok(existsSync(path.join(root, p)), `${p} does not exist`)
})
