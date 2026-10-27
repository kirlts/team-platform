#!/usr/bin/env node
// Reproduces the measurement behind the criterion «tratamiento distinto» (docs/METODO-DE-REPARTO.md, section 4): how often two groups drawn from the same
// distribution are called distinct by the rule of a fixed effect size (0.5 in any of five dimensions) and by the permutation test with Holm's adjustment.
//
//   node bench/area-method-treatment.mjs [--trials 200]
import { DIMENSIONS, cohenD, compareGroups, seededRandom } from '../scripts/area-method.mjs'

const trials = process.argv.includes('--trials') ? Number(process.argv[process.argv.indexOf('--trials') + 1]) : 400 // the number the document cites
const rand = seededRandom(11)
const group = (n) => Array.from({ length: n }, () => Object.fromEntries(DIMENSIONS.map((d) => [d, rand()])))
console.log('groups of the same distribution, 5 independent dimensions uniform on [0, 1]; share of trials called distinct')
console.log('sizes     fixed 0.5 rule   permutation + Holm (alpha 0.05)')
for (const [a, b] of [[3, 40], [5, 40], [20, 20], [20, 40], [40, 40]]) {
  let fixed = 0
  let tested = 0
  for (let t = 0; t < trials; t++) {
    const x = group(a)
    const y = group(b)
    if (DIMENSIONS.some((d) => Math.abs(cohenD(x.map((r) => r[d]), y.map((r) => r[d]))) >= 0.5)) fixed++
    if (compareGroups(x, y, { rand }).any_differs) tested++
  }
  console.log(`${a} v ${b}`.padEnd(10), `${(fixed / trials).toFixed(3)}`.padEnd(16), (tested / trials).toFixed(3))
}

// Power: the same groups, but one dimension of the second group is shifted by half of its standard deviation (a median effect, Cohen 1988). Uniform [0, 1] has a standard
// deviation of 0.289, so the shift is 0.144. The share is how often the rule finds the difference.
console.log('\none dimension shifted by 0.5 standard deviations; share of trials called distinct')
console.log('sizes     fixed 0.5 rule   permutation + Holm (alpha 0.05)')
for (const [a, b] of [[20, 20], [26, 26], [40, 40], [104, 104]]) {
  let fixed = 0
  let tested = 0
  for (let t = 0; t < trials; t++) {
    const x = group(a)
    const y = group(b).map((r, i) => (i >= 0 ? { ...r, [DIMENSIONS[0]]: r[DIMENSIONS[0]] + 0.144 } : r))
    if (DIMENSIONS.some((d) => Math.abs(cohenD(x.map((r) => r[d]), y.map((r) => r[d]))) >= 0.5)) fixed++
    if (compareGroups(x, y, { rand }).any_differs) tested++
  }
  console.log(`${a} v ${b}`.padEnd(10), `${(fixed / trials).toFixed(3)}`.padEnd(16), (tested / trials).toFixed(3))
}
