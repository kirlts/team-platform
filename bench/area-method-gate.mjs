#!/usr/bin/env node
// Reproduces the measurement behind the gate on the lower bound of the recall and the precision of the extraction (docs/METODO-DE-REPARTO.md, section 3): the probability that a
// true rate passes «lower Wilson bound >= 0.8» and «point value >= 0.8» with n requests, exactly (binomial sum, no simulation).
//
//   node bench/area-method-gate.mjs
import { wilson } from '../scripts/area-method.mjs'

const floor = 0.8 // DEFAULTS.targetRate
const choose = (n, k) => { let c = 1; for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i; return c }
const passes = (n, truth, rule) => {
  let p = 0
  for (let k = 0; k <= n; k++) if (rule(k, n)) p += choose(n, k) * truth ** k * (1 - truth) ** (n - k)
  return p
}
const lowerRule = (k, n) => wilson(k, n).lower >= floor
const pointRule = (k, n) => k / n >= floor
console.log('n = 104 requests (the sample of the document)')
console.log('true rate   point value >= 0.8   lower bound >= 0.8')
for (const truth of [0.75, 0.8, 0.85, 0.9, 0.95]) console.log(`${truth.toFixed(2)}`.padEnd(12), passes(104, truth, pointRule).toFixed(2).padEnd(21), passes(104, truth, lowerRule).toFixed(2))
