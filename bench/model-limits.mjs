#!/usr/bin/env node
// What the light model can close and what it cannot (UD-292): real tasks of this repository, of rising difficulty, run with the same harness prompt and the same tools on two models,
// each judged by a check that runs on the result, never by reading what the model says. It spends the quota of the account that runs it (`claude -p` without ANTHROPIC_API_KEY).
// The result is the table of the measurement of the light model's limits and the first values of EXECUTE_LIGHT_LIMITS.
//
//   node bench/model-limits.mjs --model claude-haiku-5-5 [--tasks T1,T2] [--out <dir>]
// One run per task and model: a task that fails once may pass another time; the table says n = 1 and the script is meant to be repeated.
import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExecuteParts, finalSchema } from '../src/execute/prompt.js'
import { claudeArgs } from '../src/execute/handler.js'
import { loadConfig } from '../src/config.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1] }
const model = arg('model', 'claude-haiku-5-5')
const only = (arg('tasks', '') || '').split(',').filter(Boolean)
const out = resolve(arg('out', join(process.env.TMPDIR ?? '/tmp', 'limites')))
const sh = (cwd, cmd) => { try { return { ok: true, out: execFileSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 600_000 }) } } catch (e) { return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` } } }
const replaceIn = (dir, file, from, to) => { const p = join(dir, file); const s = readFileSync(p, 'utf8'); if (!s.includes(from)) throw new Error(`${file}: no encuentra «${from}»`); writeFileSync(p, s.replace(from, to)) }

// Each task: a message as a person would write it, what the analyzer would say is expected, how the repository is prepared (a seeded defect, for the two that need it) and the check.
const TASKS = [
  { id: 'T1', level: 'texto', title: 'Cambiar el rótulo Cerrar por Finalizar en la tarjeta de mensaje', body: 'En la lista de mensajes, el botón de cada tarjeta dice «Cerrar» y debe decir «Finalizar» (español).', expectation: 'Cambiar el texto del rótulo.',
    check: `grep -q "'card.close': 'Finalizar'" panel/src/i18n/es-419.ts && cd panel && npx vitest run src/i18n.test.ts src/ui-voice.test.ts 2>&1 | tail -4` },
  { id: 'T2', level: 'pantalla chica', title: 'El botón de cerrar de la ficha debe decir Finalizar mensaje', body: 'En la ficha de un mensaje el botón que lo cierra dice «Cerrar mensaje». Debe decir «Finalizar mensaje» en español y «Finish message» en inglés, en la ficha y en cualquier otro lugar donde aparezca el mismo texto.', expectation: 'Cambiar el texto en los dos idiomas y donde se repita.',
    check: `grep -rq "Finalizar mensaje" panel/src/i18n/es-419.ts && grep -rq "Finish message" panel/src/i18n/en.ts && ! grep -rq "'Cerrar mensaje'" panel/src/i18n/es-419.ts && cd panel && npx tsc --noEmit && npx vitest run src/i18n.test.ts src/ui-voice.test.ts 2>&1 | tail -4` },
  { id: 'T3', level: 'defecto con causa clara', title: 'percentile devuelve un valor menor al que corresponde', body: 'En src/telemetry/execute-runs.js la función percentile devuelve un dato menor al que corresponde: el p95 de 20 datos debe ser el decimonoveno y devuelve el anterior.', expectation: 'Corregir la función y dejar las pruebas en verde.',
    seed: (dir) => replaceIn(dir, 'src/telemetry/execute-runs.js', 'Math.ceil(p * sorted.length)', 'Math.floor(p * sorted.length)'),
    check: 'node --test src/telemetry/execute-runs.test.js 2>&1 | grep -E "^ℹ (pass|fail)"' , passes: (o) => /ℹ fail 0/.test(o) },
  { id: 'T4', level: 'defecto sin causa clara', title: 'El tope de gasto del día no se libera cuando empieza otro día', body: 'Después de la medianoche el tope de gasto diario de las sesiones sigue contando lo gastado ayer y las sesiones nuevas esperan sin motivo. No sé en qué parte falla.', expectation: 'Encontrar la causa y corregirla.',
    seed: (dir) => replaceIn(dir, 'src/execute/budget.js', 'next.setDate(next.getDate() + 1)', 'next.setDate(next.getDate() + 3)'),
    check: 'node --test --test-name-pattern="a new day frees the cap" src/execute/execute.test.js 2>&1 | grep -E "^ℹ (pass|fail)"', passes: (o) => /ℹ fail 0/.test(o) && /ℹ pass [1-9]/.test(o) },
  { id: 'T5', level: 'unificación de dos piezas', title: 'La lectura de las Guardias de un área está escrita dos veces', body: 'En src/domain/areas.js y en src/domain/assessment.js hay dos funciones que leen y validan guards_json de un área (parseGuards y guardsOf). Deja una sola lectura, en assessment.js, y que areas.js la use. Las pruebas de area-model y de assessment siguen en verde.', expectation: 'Unificar las dos lecturas sin cambiar el comportamiento.',
    check: `! grep -q "const parseGuards" src/domain/areas.js && node --test src/execute/area-model.test.js src/analyze/assessment.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`, passes: (o) => /ℹ fail 0/.test(o) && /ℹ pass [1-9]/.test(o) },
  { id: 'T6', level: 'migración + API + pantalla', title: 'Agregar una nota a cada área', body: 'Cada área necesita un campo de texto «nota» que el Editor escribe y todos leen. Debe guardarse, salir en GET /areas y aceptarse en PATCH /areas/:id; en la pantalla de un área se edita en el lugar bajo el título.', expectation: 'Una migración, la API, el cliente y la pantalla del área.',
    check: `cd panel && npx tsc --noEmit && cd .. && node bench/model-limits-check-note.mjs 2>&1 | tail -3`, passes: (o) => /NOTA-OK/.test(o) },
]

const x = { ...loadConfig({ DATA_DIR: out }).execute, model, budgetUsd: 4, maxTurns: 0 }
const env0 = { ...process.env }
mkdirSync(out, { recursive: true })
const rows = []
for (const task of TASKS.filter((t) => only.length === 0 || only.includes(t.id))) {
  const dir = join(out, `${task.id}-${model}`)
  execFileSync('rm', ['-rf', dir]); execFileSync('git', ['clone', '-q', '--local', root, dir])
  for (const [rel, target] of [['node_modules', join(root, 'node_modules')], ['panel/node_modules', join(root, 'panel/node_modules')], ['packages/client/node_modules', join(root, 'packages/client/node_modules')]]) if (existsSync(target)) symlinkSync(target, join(dir, rel))
  task.seed?.(dir)
  const before = sh(dir, task.check)
  const passes = task.passes ?? ((o) => /pass|Tests .*passed/.test(o) && !/fail [1-9]|failed/.test(o))
  if (before.ok && passes(before.out) && task.seed) { rows.push({ task: task.id, level: task.level, error: 'la comprobación pasa antes de la tarea' }); continue }
  const parts = buildExecuteParts({
    message: { id: 1, title: task.title, body: task.body, fields: {}, area: 'Interfaz', status: 'open' }, template: { body_markdown: '# Plantilla\nCambio mínimo y comprobado.' },
    author: { name: 'Autora', profile: 'Jefa de proyecto, no programa.', language: 'es-419' }, agent: { name: 'Claude', profile: 'Corrijo pantallas, textos y defectos del producto.' },
    project: { name: 'Team Platform', description: 'Bandeja de entrada de un equipo pequeño.' }, jobId: 1, maxSubagents: 3, branch: 'tp/1', deliver: false, autoClose: false, compact: true, assessment: task.expectation
  })
  const NOTE = '\n\nNota de la medición: no hay servidor de Team en esta prueba; no uses `team reply` ni `team progress`, no crees rama ni empujes. Haz el cambio, corre las pruebas que lo cubren y termina con la salida estructurada.'
  mkdirSync(join(dir, '.bench'), { recursive: true })
  writeFileSync(join(dir, '.bench/system.md'), parts.stable)
  const args = claudeArgs(x, finalSchema(null, { autoClose: false, light: true }), { light: true }).filter((a) => a !== '--verbose' && a !== '--include-partial-messages').map((a) => (a === 'stream-json' ? 'json' : a))
  args.push('--append-system-prompt-file', join(dir, '.bench/system.md'), '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', 'project,local')
  const started = Date.now()
  const result = await new Promise((done) => {
    const child = execFile('claude', args, { cwd: dir, env: env0, maxBuffer: 256 * 1024 * 1024, timeout: 1_500_000 }, (error, stdout) => done({ error, stdout }))
    child.stdin.end(parts.variable + NOTE)
  })
  let r = {}
  try { r = JSON.parse(result.stdout) } catch { /* no result: the run failed */ }
  const after = sh(dir, task.check)
  const u = r.usage ?? {}
  rows.push({
    task: task.id, level: task.level, model, success: after.ok && passes(after.out), turns: r.num_turns ?? null, minutes: Math.round((Date.now() - started) / 6000) / 10,
    input_tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output_tokens: u.output_tokens ?? null,
    cache_write: u.cache_creation_input_tokens ?? null, cost_usd: r.total_cost_usd ?? null, error: r.is_error ? String(r.result).slice(0, 200) : (result.error ? String(result.error.message).slice(0, 120) : null),
    cannot_close: r.structured_output?.cannot_close ?? null, files_changed: sh(dir, 'git status --short | grep -v "^??" | wc -l').out.trim()
  })
  writeFileSync(join(out, `resultado-${model}.json`), JSON.stringify(rows, null, 2))
  console.log(JSON.stringify(rows.at(-1)))
}
