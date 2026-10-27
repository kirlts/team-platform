#!/usr/bin/env node
// Reproduces the measurement behind the criterion «se reconoce por el texto» (docs/METODO-DE-REPARTO.md, section 3): how often an invented corpus passes it.
//
//   node bench/area-method-recognition.mjs [--corpora 30] [--folds-seeds 30]
//
// Three questions, each on invented corpora (bench/fixtures/area-method/synthetic.mjs) and without any model:
//   1. specificity: text with no signal about the area (noise 1) must never pass, whatever the shares of the areas;
//   2. sensitivity: as the noise grows, in which band does an area of 12 to 60 rows stop passing;
//   3. stability: with one corpus fixed, how many area verdicts change with the seed of the folds alone, with 1 and with 10 repetitions.
import { recognition } from '../scripts/area-method.mjs'
import { syntheticCorpus } from './fixtures/area-method/synthetic.mjs'

const option = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback }
const corpora = option('--corpora', 30)
const foldSeeds = option('--folds-seeds', 30)
const passes = (c) => c.recall_lower > c.baseline && c.precision_lower > c.baseline

function passRate (sizes, noise, extra = {}) {
  const count = {}
  for (let seed = 1; seed <= corpora; seed++) {
    const r = recognition(syntheticCorpus({ sizes, noise, seed: 100 + seed, ...extra }), (x) => x.object, { seed })
    for (const [area, c] of Object.entries(r.per_class)) count[area] = (count[area] ?? 0) + (passes(c) ? 1 : 0)
  }
  return Object.entries(count).map(([area, k]) => `${area} ${k}/${corpora}`).join('  ')
}

console.log('1. no signal (noise 1)')
console.log('   shares 70/20/10:   ', passRate({ big: 140, middle: 40, small: 20 }, 1))
console.log('   shares 92/5/3/2:   ', passRate({ big: 230, a: 10, b: 6, c: 4 }, 1))
console.log('2. areas of 60, 40, 20 and 12 rows')
for (const noise of [0, 0.5, 0.7, 0.75, 0.8, 0.85, 0.9, 1]) console.log(`   noise ${noise}:`.padEnd(15), passRate({ a: 60, b: 40, c: 20, d: 12 }, noise))
console.log('3. verdicts that change with the seed of the folds alone (8 corpora x 4 areas = 32 verdicts)')
for (const repeats of [1, 10]) {
  for (const noise of [0.75, 0.8, 0.85, 0.9]) {
    let changed = 0
    for (let c = 1; c <= 8; c++) {
      const rows = syntheticCorpus({ sizes: { a: 60, b: 40, c: 20, d: 12 }, noise, seed: 500 + c })
      const hits = {}
      for (let seed = 1; seed <= foldSeeds; seed++) for (const [area, k] of Object.entries(recognition(rows, (x) => x.object, { seed, repeats }).per_class)) hits[area] = (hits[area] ?? 0) + (passes(k) ? 1 : 0)
      changed += Object.values(hits).filter((h) => h > 0 && h < foldSeeds).length
    }
    console.log(`   repeats ${repeats}, noise ${noise}: ${changed}/32`)
  }
}
