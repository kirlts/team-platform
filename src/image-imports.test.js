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

// team.mjs travels alone to the work machine with its companions (TEAM_COMPANIONS): each one, and each module team.mjs
// imports, must survive .dockerignore. walkthrough.mjs did not, and every execute job failed with ENOENT on copyFile
// (job 150, 2026-10-25).
test('every companion of team.mjs is in the build context', async () => {
  const { TEAM_COMPANIONS } = await import('./execute/handler.js')
  const ignore = readFileSync(path.join(root, '.dockerignore'), 'utf8').split('\n')
  const team = readFileSync(path.join(root, 'scripts', 'team.mjs'), 'utf8')
  const imported = [...team.matchAll(/(?:from |import\()\s*['"]\.\/([^'"]+)['"]/g)].map((m) => m[1])
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8')
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '))
  assert.deepEqual(imported.filter((f) => !TEAM_COMPANIONS.includes(f)), [], 'team.mjs imports a module that does not travel with it to the session\'s bin/')
  const missing = [...new Set([...TEAM_COMPANIONS, ...imported])]
    .filter((f) => !ignore.includes(`!scripts/${f}`) || !runtime.includes(`COPY scripts/${f} `))
  assert.deepEqual(missing, [])
})

// A COPY of a script that .dockerignore still excludes fails the build at the registry, not in tests:
// remove-member.mjs did on 2026-10-25 and the night deploy stopped there.
test('every COPY scripts/<file> in the Dockerfile is allowed by .dockerignore', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const ignore = readFileSync(path.join(root, '.dockerignore'), 'utf8').split('\n')
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8')
  const copied = [...dockerfile.matchAll(/^COPY scripts\/([^\s]+)/gm)].map((m) => m[1])
  const missing = [...new Set(copied)].filter((f) => !ignore.includes(`!scripts/${f}`))
  assert.deepEqual(missing, [], `.dockerignore must allow: ${missing.join(', ')}`)
})

// The canary is what a host runs inside the worker after a deploy to know that an unattended session still answers; an image without it leaves the host
// with a command that fails with «Cannot find module» exactly when it is needed.
test('the canary is in the image, outside .dockerignore, and imports nothing that is not a Node module', () => {
  const ignore = readFileSync(path.join(root, '.dockerignore'), 'utf8').split('\n')
  const dockerfile = readFileSync(path.join(root, 'Dockerfile'), 'utf8')
  const runtime = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '))
  assert.ok(ignore.includes('!scripts/canary.mjs'), '.dockerignore excludes the canary')
  assert.ok(runtime.includes('COPY scripts/canary.mjs ./scripts/canary.mjs'), 'the runtime stage does not copy the canary')
  const source = readFileSync(path.join(root, 'scripts', 'canary.mjs'), 'utf8')
  const imported = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
  assert.deepEqual(imported.filter((m) => !m.startsWith('node:')), [], 'the canary imports something the image may not carry')
})

