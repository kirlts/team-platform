// The contract suite: `npm run e2e:contrato`. The harness (server, panel build, Chromium) starts on first use and every `*.e2e.test.mjs` file of a
// process shares it; a root `after` closes it once. A file also runs alone: `node --test e2e/contrato/V3-adjuntos-se-ven.e2e.test.mjs`.
//
// Without arguments the files are split among as many processes as the machine has cores (`E2E_SHARDS` to choose another number, `--serial` for
// one process): the files do not share state (each test makes its own data with `h.unique`), so the suite takes as long as its slowest shard.
// Each process builds the panel once, which takes about a second. With name fragments (`npm run e2e:contrato -- V3 V4`) it is one process.
import { spawn } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

process.env.E2E_SHARED = '1'
const dir = path.dirname(fileURLToPath(import.meta.url))
const serial = process.argv.includes('--serial')
const only = process.argv.slice(2).filter((a) => a !== '--serial') // optional name fragments: `npm run e2e:contrato -- V3 V4`
const files = readdirSync(dir).filter((f) => f.endsWith('.e2e.test.mjs') && (only.length === 0 || only.some((o) => f.includes(o)))).sort()
const shardCount = Math.min(files.length, Number(process.env.E2E_SHARDS ?? availableParallelism()))
if (!serial && only.length === 0 && !process.env.E2E_CHILD && shardCount > 1) {
  // Largest file to the lightest shard so far: the sizes of the files are the weights, as they are the number of checks.
  const shards = Array.from({ length: shardCount }, () => ({ files: [], weight: 0 }))
  for (const f of [...files].sort((a, b) => statSync(path.join(dir, b)).size - statSync(path.join(dir, a)).size)) {
    const lightest = shards.reduce((m, x) => (x.weight < m.weight ? x : m))
    lightest.files.push(f)
    lightest.weight += statSync(path.join(dir, f)).size
  }
  const started = Date.now()
  const results = await Promise.all(shards.map((shard, i) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test-reporter=spec', fileURLToPath(import.meta.url), ...shard.files], { env: { ...process.env, E2E_CHILD: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (out += c))
    child.on('close', (code) => resolve({ i, code, out, files: shard.files, seconds: (Date.now() - started) / 1000 }))
  })))
  for (const r of results) console.log(`=== shard ${r.i + 1} of ${results.length} (${r.files.length} files, ${r.seconds.toFixed(1)} s)\n${r.out}`)
  console.log(`${results.length} shards, ${((Date.now() - started) / 1000).toFixed(1)} s, ${results.filter((r) => r.code !== 0).length} failed`)
  process.exit(results.some((r) => r.code !== 0) ? 1 : 0)
}
const { stopHarness } = await import('./harness.mjs')
after(() => stopHarness())
for (const file of files) await import(pathToFileURL(path.join(dir, file)).href)
