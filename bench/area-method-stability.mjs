#!/usr/bin/env node
// Reproduces the measurement behind the minimum of rows per area (docs/METODO-DE-REPARTO.md, section 4): with three invented areas that really differ, how often does a corpus of n
// rows per area lose one of them.
//
//   node bench/area-method-stability.mjs [--draws 40]
//
// The areas differ in the vocabulary of the summary, in the modules and in the mean of `severity`. «Large» puts the means at 0.2, 0.5 and 0.8 of the scale with a spread of 0.115
// (a difference of 2.6 standard deviations between neighbours); «median» puts them at 0.35, 0.5 and 0.65 with the spread of a uniform value (0.5 standard deviations). The criteria
// run with `holdout: 0`, that is, with the interval count (26) as the minimum and not the one needed to measure on a held-out set, so that the sizes below it can be seen.
import { analyze, readJson } from '../scripts/area-method.mjs'
import { syntheticCorpus } from './fixtures/area-method/synthetic.mjs'

const option = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback }
const draws = option('--draws', 40)
const team = readJson(new URL('./fixtures/area-method/team.json', import.meta.url).pathname)
const effects = {
  large: { mean: { A: 0.2, B: 0.5, C: 0.8 }, spread: 0.4 },
  median: { mean: { A: 0.35, B: 0.5, C: 0.65 }, spread: 1 }
}

function corpus (n, seed, { mean, spread }) {
  return syntheticCorpus({ sizes: { A: n, B: n, C: n }, noise: 0.3, seed, leak: true }).map((r) => ({ ...r, severity: Math.min(1, Math.max(0, mean[r.object] + (r.severity - 0.5) * spread)) }))
}

console.log(`${draws} corpora per cell; a corpus «loses» when fewer than the three areas are kept`)
console.log('rows per area   large difference   median difference')
for (const n of [26, 30, 40, 60, 104, 120]) {
  const lost = (effect) => {
    let count = 0
    for (let d = 1; d <= draws; d++) {
      const kept = analyze(corpus(n, 900 + d, effect), team, { holdout: 0, permutations: 199, repeats: 1 }).areas.filter((a) => a.keep).length
      if (kept < 3) count++
    }
    return count
  }
  console.log(`${n}`.padEnd(15), `${lost(effects.large)}/${draws}`.padEnd(18), `${lost(effects.median)}/${draws}`)
}
