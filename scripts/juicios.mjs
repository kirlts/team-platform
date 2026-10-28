// Narrow judges in parallel (UD-092, docs/JUICIOS.md). This script prepares the work and reads it back; the judges
// themselves are subagents that the coordinating session launches, one per brief, all at once.
//
//   node scripts/juicios.mjs preparar --out DIR [--items home,settings] [--detectors FILE] [--telemetry FILE]
//   node scripts/juicios.mjs consolidar --out DIR
//   node scripts/juicios.mjs calibrar
//
// preparar   Takes the captures and the detector pass at the same time (they do not depend on each other), reads the
//            telemetry summary, and writes one brief per screen or flow in DIR/encargos plus DIR/manifest.json with the
//            line to hand each subagent. The brief holds the detector output, the telemetry, the owner's decisions and the
//            findings already refuted. It never holds what was changed since the last round.
// consolidar Reads DIR/resultados/*.json, marks every finding as new, refuted before, repeated from a resolved one or
//            repeated by another judge of the same round, and writes DIR/consolidado.json and DIR/consolidado.md.
// calibrar   Measures, over the book itself, how well title similarity tells a repeated finding from a different one.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calibrate, decisionsFor, parseDecisions, parseFindings, similarity, tokens } from './juicios/library.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PANEL = path.join(ROOT, 'panel')

// Title similarity at which a reported finding is taken for one already in the book. Measured over the book itself
// (`calibrar`): the threshold with the best F1 for telling the rows the book marks as repeats from every other pair of
// the same screen. At this value 67 % of the pairs it flags are real repeats and it finds 35 % of them
// (measurement of 2026-10-21 in docs/investigaciones/mediciones, one file named after the threshold). It is a candidate generator, not a
// verdict: a flagged finding keeps its place in the report with the row it resembles.
export const MATCH_THRESHOLD = 0.35

const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } }
const THEMES = ['light', 'dark']

/** What gets judged. `detector` lists screen ids of the detector pass; `telemetry` the screen of the usage summary. */
export const ITEMS = [
  { id: 'home', label: 'Inicio', route: '/', detector: ['home'], telemetry: 'home', tasks: ['send_publish'], book: 'home' },
  { id: 'messages', label: 'Mensajes', route: '/messages', detector: ['messages'], telemetry: 'messages', tasks: [], book: 'messages' },
  { id: 'message-detail', label: 'Ficha de un mensaje', route: 'message', detector: ['message-detail'], telemetry: 'message-detail', tasks: ['reply', 'close'], book: 'message-detail' },
  { id: 'areas', label: 'Áreas y plantillas', route: '/areas', extraRoute: 'area', detector: ['areas', 'area-detail'], telemetry: 'areas', tasks: [], book: 'areas' },
  { id: 'team', label: 'Equipo', route: '/team', detector: ['team'], telemetry: 'team', tasks: [], book: 'team' },
  { id: 'settings', label: 'Configuración', route: '/settings', detector: ['settings'], telemetry: 'settings', tasks: [], book: 'settings' },
  { id: 'connections', label: 'Conexiones', route: '/connections', detector: ['connections'], telemetry: 'connections', tasks: [], book: 'connections' },
  { id: 'login', label: 'Entrada', route: 'anonymous', detector: ['login'], telemetry: null, tasks: [], book: 'login' },
  { id: 'flow-send', label: 'Flujo enviar y publicar', route: 'flow', detector: ['home'], telemetry: 'home', tasks: ['send_publish'], book: 'flow-send' },
  { id: 'flow-reply-close', label: 'Flujo responder y cerrar', route: 'flow', detector: ['message-detail'], telemetry: 'message-detail', tasks: ['reply', 'close'], book: 'message-detail' }
]

const arg = (name, args = process.argv) => { const i = args.indexOf(`--${name}`); return i === -1 ? undefined : args[i + 1] }

// ---- Reading the book

function loadBook () {
  const findings = parseFindings(readFileSync(path.join(ROOT, 'docs/HALLAZGOS.md'), 'utf8'))
  const decisions = parseDecisions(readFileSync(path.join(ROOT, 'docs/USER-DECISIONS.md'), 'utf8'))
  return { findings, decisions }
}

const short = (text, max) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`)

// ---- Captures: one pass of a headless browser through the example server

/** What the sheet shows to see a state, once it is open: the part of Detalles that holds it, or the part of the sheet that is out of the first screen. */
const openDetails = async (page) => { await page.getByRole('button', { name: 'Detalles', exact: true }).click(); await page.getByTestId('details').waitFor(); await page.getByTestId('details').scrollIntoViewIfNeeded() }
const reveal = (testId) => async (page) => { await page.getByTestId(testId).first().waitFor({ timeout: 10000 }); await page.getByTestId(testId).first().scrollIntoViewIfNeeded() }
const revealExtracted = async (page) => { const text = page.locator('[data-gallery-extracted] [data-gallery-transcript]').first(); await text.waitFor({ timeout: 10000 }); await text.scrollIntoViewIfNeeded() }
const STATE_VIEWS = {
  extracted_document: revealExtracted,
  extracted_image: revealExtracted,
  extracted_link: revealExtracted,
  delivery_waiting_75: reveal('agent-work'),
  delivery_held_76: reveal('review-pending'),
  trace_tokens_cost: openDetails,
  work_machine: reveal('agent-work'),
  budget_spent: async (page) => { await page.getByText('Sigue mañana a las').first().scrollIntoViewIfNeeded() },
  idea_guard: reveal('review-pending'),
  handoff: reveal('handoff-waiting')
}

async function capture (outDir, items, { port }) {
  const { startPanel, login, settled } = await import(path.join(PANEL, 'src/browser-support.mjs'))
  const dir = path.join(outDir, 'capturas')
  mkdirSync(dir, { recursive: true })
  const panel = await startPanel(port, { build: !process.env.FIT_SIN_BUILD, stepMs: 60 })
  const taken = {} // item id -> file names
  const notes = [] // steps that could not be captured, with the reason
  const add = (id, name) => { (taken[id] ??= []).push(name) }
  try {
    const probe = await panel.browser.newContext()
    const pp = await probe.newPage()
    await login(pp, panel.origin)
    const msgs = await (await pp.request.get(`${panel.origin}/api/messages`)).json()
    const list = Array.isArray(msgs) ? msgs : msgs.items
    const message = list.find((m) => m.title.startsWith('Revisar la lectura')) ?? list[0]
    // The sheet is captured once per state that a judge has to see, each in its own message (`/_control/states` of the example server).
    const states = items.some((i) => i.id === 'message-detail') ? await panel.control.states() : {}
    const areasBody = await (await pp.request.get(`${panel.origin}/api/areas`)).json()
    const areas = Array.isArray(areasBody) ? areasBody : (areasBody.items ?? [])
    await probe.close()
    const wanted = new Set(items.map((i) => i.id))
    const screens = ITEMS.filter((i) => wanted.has(i.id) && i.route !== 'flow')

    for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
      for (const theme of THEMES) {
        const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: theme, reducedMotion: 'reduce' })
        await context.addInitScript((t) => { try { localStorage.setItem('team-theme', t) } catch { /* no storage */ } }, theme)
        const page = await context.newPage()
        let signedIn = false
        try {
          for (const item of screens) {
            const shot = async (suffix, url, prepare) => {
              await page.goto(url)
              await page.locator('main h1, main').first().waitFor({ timeout: 15000 }).catch(() => {})
              await page.waitForLoadState('networkidle').catch(() => {})
              await prepare?.(page)
              await settled(page)
              const name = `${item.id}${suffix}-${vpName}-${theme}.png`
              await page.screenshot({ path: path.join(dir, name) })
              add(item.id, name)
            }
            if (item.route === 'anonymous') {
              const anon = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: theme })
              await anon.addInitScript((t) => { try { localStorage.setItem('team-theme', t) } catch { /* no storage */ } }, theme)
              const lp = await anon.newPage()
              await lp.goto(panel.origin)
              await lp.getByLabel('Correo').waitFor()
              await settled(lp)
              const name = `${item.id}-${vpName}-${theme}.png`
              await lp.screenshot({ path: path.join(dir, name) })
              add(item.id, name)
              await anon.close()
              continue
            }
            if (!signedIn) { await login(page, panel.origin); signedIn = true }
            if (item.route === 'message') {
              await shot('', `${panel.origin}/messages/${message.id}`)
              for (const [state, stateId] of Object.entries(states)) await shot(`-${state.replaceAll('_', '-')}`, `${panel.origin}/messages/${stateId}`, STATE_VIEWS[state])
            }
            else {
              await shot('', `${panel.origin}${item.route}`)
              if (item.extraRoute === 'area' && areas[0]) await shot('-detalle', `${panel.origin}/areas/${(areas.find((a) => a.id === 'a-error') ?? areas[0]).id}`)
            }
          }
        } finally { await context.close() }
      }
    }

    // The flows: what the person does, step by step, on the two window sizes in the light theme.
    for (const flow of items.filter((i) => i.route === 'flow')) {
      for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
        const context = await panel.browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light', reducedMotion: 'reduce' })
        const page = await context.newPage()
        const step = async (n, label, fn) => {
          try {
            await fn()
            const name = `${flow.id}-${n}-${label}-${vpName}-light.png`
            await settled(page)
            await page.screenshot({ path: path.join(dir, name) })
            add(flow.id, name)
          } catch (error) {
            notes.push(`${flow.id} ${vpName} paso ${n} (${label}): ${String(error.message).split('\n')[0]}`)
          }
        }
        try {
          await panel.control.reset()
          await login(page, panel.origin, 'ana')
          if (flow.id === 'flow-send') {
            // The send as the interface works now: the analysis ends and the message is published by itself (UD-070). Test ids and `data-ui-stage`, not texts (H-1706).
            const bar = page.getByTestId('compose-text').last()
            await step(1, 'redactar', async () => { await page.goto(panel.origin); await bar.fill('Corregir el desalineado del sidebar en la vista dashboard.\n\nAgregar la sincronización con WhatsApp en el sidebar.\n\nPregunta: ¿el audio máximo sigue en 25 MB?') })
            // Each step is a state the example server is held in, never a wait: the upload is held at the network (`route`) and the analysis by the server's own order (H-901).
            let letUploadGo = () => {}
            const uploadHeld = new Promise((resolve) => { letUploadGo = resolve })
            await page.route('**/api/inputs', async (route) => {
              if (route.request().method() !== 'POST') return route.continue()
              await uploadHeld
              return route.continue()
            })
            await panel.control.hold()
            await step(2, 'enviando', async () => { await page.getByTestId('compose-send').first().click(); await page.getByTestId('send-drawer').waitFor() })
            await step(3, 'analizando', async () => {
              letUploadGo()
              await page.locator('[data-ui-stage="progress"]').first().waitFor()
              await panel.control.step()
              await page.getByRole('progressbar').first().waitFor()
            })
            await step(4, 'publicado', async () => { await panel.control.release(); await page.getByTestId('published-message').first().waitFor({ timeout: 30000 }) })
            await panel.control.release()
          } else {
            await step(1, 'ficha', async () => { await page.goto(`${panel.origin}/messages/${message.id}`); await page.locator('main h1').waitFor() })
            await step(2, 'respuesta', async () => { await page.getByLabel('Respuesta', { exact: true }).fill('Confirmado: queda para esta semana.') })
            await step(3, 'respondido', async () => { await page.getByRole('button', { name: 'Responder', exact: true }).click(); await page.getByText('Confirmado: queda para esta semana.').first().waitFor() })
            await step(4, 'cerrado', async () => { await page.getByRole('button', { name: 'Cerrar mensaje', exact: true }).click(); await page.getByRole('button', { name: 'Reabrir mensaje', exact: true }).waitFor() })
          }
          // Whatever the browser sent about this use of the panel is what the telemetry summary of the briefs holds.
          const hide = page.waitForResponse((r) => r.url().endsWith('/api/telemetry/ui'), { timeout: 5000 }).catch(() => null)
          await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
          await hide
        } finally { await context.close() }
      }
    }

    const reader = await panel.browser.newContext()
    const rp = await reader.newPage()
    await login(rp, panel.origin, 'ana')
    const summary = await (await rp.request.get(`${panel.origin}/api/telemetry/ui-summary`)).json()
    writeFileSync(path.join(outDir, 'telemetria-de-la-pasada.json'), JSON.stringify(summary, null, 2))
    await reader.close()
  } finally {
    await panel.stop()
  }
  return { taken, notes }
}

/** The detector pass, as its own process: it brings up its own example server on its own port. */
function runDetectors (outFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/ui-detectors.mjs', '--out', outFile, '--no-build', '--json'], {
      cwd: PANEL, env: { ...process.env, PANEL_DETECTORS_PORT: process.env.PANEL_DETECTORS_PORT ?? '8974' }, stdio: ['ignore', 'ignore', 'inherit']
    })
    child.once('exit', (code) => (code === 0 ? resolve(outFile) : reject(new Error(`ui-detectors salió con ${code}`))))
    child.once('error', reject)
  })
}

// ---- The briefs

const json = (value) => `\`\`\`json\n${JSON.stringify(value, null, 1)}\n\`\`\``

function detectorBlock (report, item) {
  if (!report) return 'No se corrió el detector en esta ronda.'
  const found = item.detector.flatMap((id) => (report.screens?.[id]?.findings ?? []).map((f) => ({ pantalla: id, regla: f.rule, elemento: f.selector, detalle: f.detail, combinaciones: f.measure?.combinations })))
  const heights = Object.fromEntries(item.detector.map((id) => [id, report.screens?.[id]?.page_height_ratio ?? {}]))
  return found.length === 0 ? `Ningún hallazgo en ${item.detector.join(' ni ')}. Alto de la página frente a la ventana: ${JSON.stringify(heights)}.` : json({ hallazgos: found, alto_de_la_pagina_sobre_la_ventana: heights })
}

function telemetryBlock (summary, item) {
  if (!summary || !item.telemetry) return 'Sin datos de uso para esta pantalla.'
  const screen = summary.screens?.[item.telemetry]
  const tasks = Object.fromEntries(item.tasks.filter((t) => summary.tasks?.[t]).map((t) => [t, summary.tasks[t]]))
  if (!screen && Object.keys(tasks).length === 0) return 'Sin datos de uso para esta pantalla.'
  return json({ ventana: summary.window, sesiones: summary.sessions, pantalla: screen, tareas: tasks, errores_por_ruta: summary.errors?.top_endpoints, recorridos_con_mas_clics: summary.worst_journeys?.filter((w) => item.tasks.includes(w.task)).slice(0, 3) })
}

function refutedFor (item, book) {
  return book.findings
    .filter((f) => f.state === 'refuted' && (f.screen === item.book || f.screen === 'global'))
    .map((f) => `- ${f.id}: ${f.title}. ${short(f.reason, 260)}`)
}

function decisionsBlock (item, book) {
  const lines = decisionsFor(item.book === 'flow-send' ? 'home' : item.book, book.decisions).map((d) => `- ${d.id}: ${d.title}. ${short(d.decision, 320)}`)
  return lines.length === 0 ? 'Ninguna específica.' : lines.join('\n')
}

function brief (item, { template, book, detectors, telemetry, captures, resultFile }) {
  const caps = captures.map((c) => `- ${c.path}`).join('\n') || '- Sin capturas: informa que no pudiste mirar nada.'
  const refuted = refutedFor(item, book)
  return template
    .replaceAll('{{LABEL}}', item.label)
    .replaceAll('{{ID}}', item.id)
    .replaceAll('{{RESULT}}', resultFile)
    .replace('{{CAPTURES}}', caps)
    .replace('{{DETECTORS}}', detectorBlock(detectors, item))
    .replace('{{TELEMETRY}}', telemetryBlock(telemetry, item))
    .replace('{{DECISIONS}}', decisionsBlock(item, book))
    .replace('{{REFUTED}}', refuted.length === 0 ? 'Nada refutado para esta pantalla.' : refuted.join('\n'))
}

async function prepare (args) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const outDir = path.resolve(arg('out', args) ?? path.join(homedir(), '.cache/claude-tmp/team-platform-juicios', stamp))
  const wantedIds = arg('items', args)?.split(',')
  const items = ITEMS.filter((i) => !wantedIds || wantedIds.includes(i.id))
  if (items.length === 0) throw new Error(`ningún elemento coincide con --items ${wantedIds}`)
  for (const sub of ['encargos', 'resultados', 'capturas']) mkdirSync(path.join(outDir, sub), { recursive: true })

  const started = Date.now()
  // One build of the panel for both: a second one would empty `dist` under the server that is serving it.
  if (!process.env.FIT_SIN_BUILD) {
    execFileSync('npx', ['vite', 'build'], { cwd: PANEL, stdio: 'ignore' })
    process.env.FIT_SIN_BUILD = '1'
  }
  const detectorsFile = arg('detectors', args)
  // Captures and detector pass are independent: both at once, each in its own browser and on its own port.
  const [shots, detectorsPath] = await Promise.all([
    capture(outDir, items, { port: Number(process.env.PANEL_JUICIOS_PORT ?? 8976) }),
    detectorsFile ? Promise.resolve(detectorsFile) : runDetectors(path.join(outDir, 'detectores.json'))
  ])
  const prepared = Date.now() - started

  const detectors = JSON.parse(readFileSync(detectorsPath, 'utf8'))
  const telemetryFile = arg('telemetry', args) ?? path.join(outDir, 'telemetria-de-la-pasada.json')
  const telemetry = existsSync(telemetryFile) ? JSON.parse(readFileSync(telemetryFile, 'utf8')) : null
  const template = readFileSync(path.join(ROOT, 'scripts/juicios/plantilla-encargo.md'), 'utf8')
  const book = loadBook()

  const manifest = { generated_at: new Date().toISOString(), out: outDir, prepared_ms: prepared, notes: shots.notes, library: { findings: book.findings.length, refuted: book.findings.filter((f) => f.state === 'refuted').length, decisions: book.decisions.length }, items: [] }
  for (const item of items) {
    const captures = (shots.taken[item.id] ?? []).map((name) => ({ name, path: path.join(outDir, 'capturas', name) }))
    const resultFile = path.join(outDir, 'resultados', `${item.id}.json`)
    const briefFile = path.join(outDir, 'encargos', `${item.id}.md`)
    writeFileSync(briefFile, brief(item, { template, book, detectors, telemetry, captures, resultFile }))
    manifest.items.push({
      id: item.id, label: item.label, brief: briefFile, result: resultFile, captures: captures.length,
      prompt: `Lee ${briefFile} y haz lo que pide. Escribe el resultado en ${resultFile}. No hagas nada más.`
    })
  }
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`Preparado en ${(prepared / 1000).toFixed(0)} s: ${manifest.items.length} encargos en ${outDir}`)
  for (const i of manifest.items) console.log(`  ${i.id.padEnd(18)} ${String(i.captures).padStart(2)} capturas  ${i.brief}`)
  for (const n of shots.notes) console.log(`  sin capturar: ${n}`)
  console.log(`Un subagente por encargo, todos a la vez. Lista para lanzar: ${path.join(outDir, 'manifest.json')} (campo prompt de cada elemento).`)
}

// ---- Reading the judges back

function readResult (file) {
  const raw = readFileSync(file, 'utf8').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(raw)
}

const SEVERITY = (n) => (Number.isInteger(n) && n >= 1 && n <= 5 ? n : 3)

/** Marks every reported finding against the book and against the other judges of the round. */
export function consolidateFindings (results, bookRows) {
  const out = []
  for (const result of results) {
    for (const [index, f] of (result.hallazgos ?? []).entries()) {
      const title = `${f.titulo ?? ''} ${f.elemento ?? ''}`
      const hasEvidence = Boolean(f.evidencia && (f.evidencia.captura || f.evidencia.medida))
      let best = null
      for (const row of bookRows) {
        if (row.screen !== null && !['global', result.book, result.id].includes(row.screen)) continue
        const score = similarity(title, row.title)
        if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { row, score }
      }
      let status = 'nuevo'
      if (!hasEvidence) status = 'sin-evidencia'
      else if (best?.row.state === 'refuted') status = 'refutado-antes'
      else if (best?.row.state === 'resolved') status = 'repetido-de-resuelto'
      else if (best?.row.state === 'decided') status = 'ya-decidido'
      out.push({
        judge: result.id, n: index + 1, titulo: f.titulo ?? '', elemento: f.elemento ?? '', tipo: f.tipo ?? 'otro', severidad: SEVERITY(f.severidad),
        evidencia: f.evidencia ?? null, reproduccion: f.reproduccion ?? '', status, parecido: best ? { id: best.row.id, estado: best.row.state, similitud: Number(best.score.toFixed(2)), titulo: best.row.title } : null
      })
    }
  }
  // Two judges of the same round reporting the same thing: the first stays, the rest point to it.
  const seen = []
  for (const f of out) {
    if (f.status !== 'nuevo') continue
    const twin = seen.find((g) => similarity(`${f.titulo} ${f.elemento}`, `${g.titulo} ${g.elemento}`) >= MATCH_THRESHOLD)
    if (twin) { f.status = 'repetido-en-la-ronda'; f.parecido = { id: `${twin.judge}#${twin.n}`, estado: 'nuevo', similitud: Number(similarity(`${f.titulo} ${f.elemento}`, `${twin.titulo} ${twin.elemento}`).toFixed(2)), titulo: twin.titulo } } else seen.push(f)
  }
  return out
}

function consolidate (args) {
  const outDir = path.resolve(arg('out', args) ?? '')
  const dir = path.join(outDir, 'resultados')
  if (!existsSync(dir)) throw new Error(`no existe ${dir}`)
  const manifest = existsSync(path.join(outDir, 'manifest.json')) ? JSON.parse(readFileSync(path.join(outDir, 'manifest.json'), 'utf8')) : { items: [] }
  const results = []
  const unreadable = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const r = readResult(path.join(dir, file))
      r.id ??= file.replace(/\.json$/, '')
      r.book = ITEMS.find((i) => i.id === r.id)?.book
      results.push(r)
    } catch (error) { unreadable.push(`${file}: ${error.message}`) }
  }
  const book = loadBook()
  const findings = consolidateFindings(results, book.findings)
  const missing = manifest.items.filter((i) => !results.some((r) => r.id === i.id)).map((i) => i.id)
  const count = (s) => findings.filter((f) => f.status === s).length
  const summary = {
    judges: results.length, missing, unreadable, findings: findings.length,
    nuevo: count('nuevo'), 'refutado-antes': count('refutado-antes'), 'repetido-de-resuelto': count('repetido-de-resuelto'), 'ya-decidido': count('ya-decidido'), 'repetido-en-la-ronda': count('repetido-en-la-ronda'), 'sin-evidencia': count('sin-evidencia'),
    notas: Object.fromEntries(results.map((r) => [r.id, r.nota ?? null]))
  }
  writeFileSync(path.join(outDir, 'consolidado.json'), JSON.stringify({ summary, findings }, null, 2))
  const rows = findings.map((f) => `| ${f.judge} | ${f.severidad} | ${f.status} | ${f.titulo.replaceAll('|', '/')} | ${f.parecido ? `${f.parecido.id} (${f.parecido.similitud})` : ''} |`)
  writeFileSync(path.join(outDir, 'consolidado.md'), [
    '# Consolidado de la ronda', '',
    `Jueces leídos: ${summary.judges}. Hallazgos: ${summary.findings}. Nuevos: ${summary.nuevo}. Refutados antes: ${summary['refutado-antes']}. Repetidos de resueltos: ${summary['repetido-de-resuelto']}. Ya decididos: ${summary['ya-decidido']}. Repetidos en la ronda: ${summary['repetido-en-la-ronda']}. Sin evidencia: ${summary['sin-evidencia']}.`,
    missing.length ? `Sin resultado: ${missing.join(', ')}.` : '', unreadable.length ? `Ilegibles: ${unreadable.join('; ')}.` : '', '',
    '| Juez | Sev. | Estado | Hallazgo | Se parece a |', '|---|---|---|---|---|', ...rows, ''
  ].filter((l) => l !== undefined).join('\n'))
  console.log(JSON.stringify(summary, null, 2))
  console.log(`Escrito ${path.join(outDir, 'consolidado.md')}`)
}

function calibration () {
  const rows = loadBook().findings
  const c = calibrate(rows)
  console.log(`Libro: ${rows.length} filas; ${c.pairs} pares de una misma pantalla; ${c.repeats} repeticiones que el propio libro declara.`)
  console.log('umbral  señalados  precisión  exhaustividad  F1')
  for (const t of c.table) console.log(`${t.threshold.toFixed(2)}    ${String(t.flagged).padStart(6)}      ${t.precision.toFixed(2)}        ${t.recall.toFixed(2)}        ${t.f1.toFixed(2)}`)
  const best = c.table.reduce((a, b) => (b.f1 > a.f1 ? b : a))
  console.log(`Mejor F1: umbral ${best.threshold} (precisión ${best.precision.toFixed(2)}, exhaustividad ${best.recall.toFixed(2)}). En el código: ${MATCH_THRESHOLD}.`)
  void tokens
}

const [command, ...rest] = process.argv.slice(2)
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (command === 'preparar') await prepare(rest)
    else if (command === 'consolidar') consolidate(rest)
    else if (command === 'calibrar') calibration()
    else { console.error('uso: node scripts/juicios.mjs preparar|consolidar|calibrar --out DIR (ver el encabezado del archivo)'); process.exit(2) }
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
