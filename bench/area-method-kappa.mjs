#!/usr/bin/env node
// Reproduces the measurement behind the gate of the validation (docs/METODO-DE-REPARTO.md, section 3): how often labels with a known kappa pass a gate on the point value of kappa
// and a gate on the lower bound of its interval.
//
//   node bench/area-method-kappa.mjs [--trials 300] [--n 78]
//
// Pairs of labels of three equally likely categories, independent requests, agreement chosen so that the true kappa is the one of the row. The gate is 0.6 in both forms.
import { kappaWithInterval } from '../scripts/row-validation.mjs'
import { seededRandom } from '../scripts/area-method.mjs'

const option = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback }
const trials = option('--trials', 300)
const n = option('--n', 78)
const floor = 0.6
const rand = seededRandom(5)
console.log(`n = ${n} labeled requests, ${trials} trials per row, floor ${floor}`)
console.log('true kappa   point value >= floor   lower bound >= floor   mean half width of the interval')
for (const truth of [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
  const agree = 1 / 3 + (2 * truth) / 3 // with three equally likely categories, kappa = (po - 1/3) / (2/3)
  let point = 0
  let lower = 0
  let half = 0
  for (let t = 0; t < trials; t++) {
    const items = Array.from({ length: n }, (_, i) => {
      const a = Math.floor(rand() * 3)
      const b = rand() < agree ? a : (a + 1 + Math.floor(rand() * 2)) % 3
      return { unit: `u${i}`, stratum: 'all', w: 1, a, b }
    })
    const k = kappaWithInterval(items, { resamples: 300, seed: t + 1 })
    if (k.kappa >= floor) point++
    if (k.lower >= floor) lower++
    half += (k.upper - k.lower) / 2
  }
  console.log(`${truth.toFixed(2)}`.padEnd(13), `${(point / trials).toFixed(2)}`.padEnd(21), `${(lower / trials).toFixed(2)}`.padEnd(23), (half / trials).toFixed(3))
}
