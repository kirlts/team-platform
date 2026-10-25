#!/usr/bin/env node
// Measures what the start of an `execute` session weighs in real tokens (UD-295): the same message, once with the full prompt and once as a direct fix
// on a light model (minimal prompt, map of the repository, hooks). It calls `claude -p --output-format json --max-turns 1` and reads `usage` of the result,
// so the figure is the API's own count of the first request, not an estimate. It spends real money (cents with Haiku 5.5).
//
//   node scripts/medir-arranque.mjs --repo <git repository> [--model claude-haiku-5-5] [--host <rules.md>] [--host-min <minimal rules.md>] [--template templates/bug.md]
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { buildExecuteParts } from '../src/execute/prompt.js'
import { sessionSettings } from '../src/execute/handler.js'
import { loadConfig } from '../src/config.js'
import { buildRepoMap } from './repo-map.mjs'

const run = promisify(execFile)
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []))
const root = fileURLToPath(new URL('..', import.meta.url))
const model = args.model ?? 'claude-haiku-5-5'
const repo = resolve(args.repo ?? '.')
const text = async (p) => (p ? readFile(resolve(p), 'utf8') : '')
const host = await text(args.host)
const hostMin = args['host-min'] ? await text(args['host-min']) : host
const template = { body_markdown: await text(args.template ?? join(root, 'templates/bug.md')) }
const work = join(process.env.TMPDIR ?? '/tmp', `medir-arranque-${process.pid}`)
await mkdir(join(work, 'bin'), { recursive: true })
await writeFile(join(work, 'bin/team'), `#!/bin/sh\nexec node ${join(root, 'scripts/team.mjs')} "$@"\n`, { mode: 0o755 })

const input = (extra) => ({
  message: { id: 1, title: 'Cambiar el rótulo del botón Guardar por Aceptar', body: 'En la ficha del paciente el botón dice Guardar y debe decir Aceptar.', fields: {}, area: 'Interfaz', status: 'open', tier: 'direct' },
  template, author: { name: 'Autora', profile: 'Jefa de proyecto, no programa.', language: 'es-419' }, agent: { name: 'Claude', profile: 'Corrijo pantallas y textos.' },
  project: { name: 'Proyecto', description: 'Sistema de gestión de una clínica.' }, jobId: 1, maxSubagents: 3, branch: 'tp/1', deliver: true, autoClose: true, ...extra
})
const PROBE = '\n\nMedición del arranque: responde solo «ok» y no uses ninguna herramienta.'

async function measure (label, { stable, variable, settings, tools = '' }) {
  const dir = join(work, label)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'system.md')
  await writeFile(file, stable)
  const cmd = ['-p', '--model', model, '--output-format', 'json', '--max-turns', '1', '--permission-mode', 'bypassPermissions', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', 'project,local', ...(tools ? ['--tools', tools] : []), ...(settings ? ['--settings', JSON.stringify(settings)] : []), ...(stable ? ['--append-system-prompt-file', file] : [])]
  const child = execFile('claude', cmd, { cwd: repo, env: { ...process.env, PATH: `${join(work, 'bin')}:${process.env.PATH}` }, maxBuffer: 64 * 1024 * 1024 })
  child.stdin.end(variable + PROBE)
  let out = ''
  child.stdout.on('data', (c) => { out += c })
  await new Promise((done) => child.on('close', done))
  const r = JSON.parse(out)
  const u = r.usage ?? {}
  return { label, tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: u.output_tokens ?? 0, usd: r.total_cost_usd, models: Object.keys(r.modelUsage ?? {}) }
}

const full = buildExecuteParts(input({ hostInstructions: host }))
const light = buildExecuteParts(input({ hostInstructions: hostMin, compact: true }))
const map = await buildRepoMap({ cwd: repo })
const rows = [
  await measure('0-sin-instrucciones', { stable: '', variable: '' }),
  await measure('1-antes', { stable: full.stable, variable: full.variable }),
  await measure('2-despues', { stable: light.stable, variable: light.variable, settings: sessionSettings({ light: true }), tools: loadConfig({ DATA_DIR: work }).execute.directTools })
]
const base = rows[0].tokens
console.log(JSON.stringify({ model, repo, claudeCodeBase: base, mapTokensEstimated: map.estimatedTokens, rows: rows.map((r) => ({ ...r, harnessTokens: r.tokens - base })) }, null, 2))
