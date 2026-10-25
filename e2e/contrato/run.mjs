// The contract suite in ONE process: `npm run e2e:contrato`. The harness (server, panel build, Chromium) starts on first use and every
// `*.e2e.test.mjs` file shares it; a root `after` closes it once. A file also runs alone: `node --test e2e/contrato/V3-adjuntos-se-ven.e2e.test.mjs`.
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { after } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

process.env.E2E_SHARED = '1'
const dir = path.dirname(fileURLToPath(import.meta.url))
const only = process.argv.slice(2) // optional name fragments: `npm run e2e:contrato -- V3 V4`
const files = readdirSync(dir).filter((f) => f.endsWith('.e2e.test.mjs') && (only.length === 0 || only.some((o) => f.includes(o)))).sort()
const { stopHarness } = await import('./harness.mjs')
after(() => stopHarness())
for (const file of files) await import(pathToFileURL(path.join(dir, file)).href)
