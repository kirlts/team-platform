#!/usr/bin/env node
// Prints the anchors of the twelve indicators of the job evaluation, as Markdown: what -2, -1, 0, +1 and +2 look like in each one. A person who scores a job by hand (to validate the judge, or to
// score a routing) reads them here; they live in `src/execute/judge.js` and are not copied anywhere else, so they cannot drift.
//
//   node scripts/anchors.mjs [--indicator 2.3]
import { pathToFileURL } from 'node:url'
import { KPIS, LEVEL_SCORES } from '../src/execute/judge.js'

const NAMES = { 2: 'excepcional', 1: 'fuerte', 0: 'esperado', '-1': 'bajo', '-2': 'inaceptable' }

/** The anchors as Markdown: one table per indicator. `only` limits it to one indicator id. */
export function anchorsMarkdown (only = null) {
  return KPIS.filter((k) => !only || k.id === only).map((k) => [
    `**${k.id} ${k.name}.** ${k.asks}`, '', '| Nivel | Ancla |', '|---|---|',
    ...LEVEL_SCORES.map((score, i) => `| ${score > 0 ? '+' : ''}${score} ${NAMES[score]} | ${k.levels[i]} |`), ''
  ].join('\n')).join('\n')
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const at = process.argv.indexOf('--indicator')
  process.stdout.write(`${anchorsMarkdown(at >= 0 ? process.argv[at + 1] : null)}\n`)
}
