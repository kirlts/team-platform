// Every file outside src/ that the server imports must be in the image: c246534 shipped without scripts/team.mjs and
// the container did not start (ERR_MODULE_NOT_FOUND).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function sources (dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sources(full)
    return /\.(js|mjs)$/.test(name) && !/\.test\.(js|mjs)$/.test(name) ? [full] : []
  })
}

test('every module outside src/ that the server imports is copied into the runtime image', () => {
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8')
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '))
  const copied = [...runtime.matchAll(/^COPY (?!--from)(\S+) /gm)].map((m) => m[1])
  const ignore = readFileSync(path.join(root, '.dockerignore'), 'utf8').split('\n')
  const missing = []
  for (const file of sources(path.join(root, 'src'))) {
    const text = readFileSync(file, 'utf8')
    const specs = [...text.matchAll(/(?:from |import\(|new URL\()\s*'(\.{1,2}\/[^']+)'/g)].map((m) => m[1])
    for (const spec of specs) {
      const target = path.relative(root, path.resolve(path.dirname(file), spec))
      if (target.startsWith('src' + path.sep) || target.startsWith('..')) continue
      const inImage = copied.some((c) => target === c || target.startsWith(c.replace(/\/$/, '') + '/'))
      const allowed = ignore.includes('!' + target) || !ignore.some((line) => line && !line.startsWith('!') && !line.startsWith('#') && target.startsWith(line.replace(/^\//, '')))
      if (!inImage || !allowed) missing.push(`${path.relative(root, file)} -> ${target}`)
    }
  }
  assert.deepEqual(missing, [])
})
