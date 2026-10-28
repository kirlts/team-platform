#!/usr/bin/env node
// Counts what prediction-powered inference (Angelopoulos et al., Science 382:669, 2023) would give the routing experiment, to decide whether the method adopts it.
//
//   node bench/area-method-ppi.mjs [--trials 2000] [--labeled 78]
//
// The quantity is the rate at which the router agrees with the truth (`t`, known only for the labeled requests). The prediction is the rate at which it agrees with the extraction (`f`, known
// for every routed request). The estimator is mean(f over the N routed requests) + mean(t - f over the n labeled ones); the classical one is mean(t over the n labeled ones). Both are
// compared by the half width of their 95 % interval and by coverage, in a simulation where the extraction is right with probability `a` (then f = t) and otherwise f is independent of t.
import { seededRandom } from '../scripts/area-method.mjs'

const option = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? Number(process.argv[i + 1]) : fallback }
const trials = option('--trials', 2000)
const n = option('--labeled', 78)
const theta = 0.8 // the rate the method expects of a router that works (--target-rate)
const rand = seededRandom(9)
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
const variance = (xs) => { const m = mean(xs); return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) }
console.log(`labeled n = ${n}, true rate ${theta}, ${trials} trials`)
console.log('extraction right   routed N   half width classical   half width PPI   coverage classical   coverage PPI')
for (const a of [0.85, 0.95]) {
  for (const N of [90, 360, 3600]) {
    let hc = 0; let hp = 0; let cc = 0; let cp = 0
    for (let t = 0; t < trials; t++) {
      const y = Array.from({ length: N }, () => (rand() < theta ? 1 : 0))
      const f = y.map((v) => (rand() < a ? v : (rand() < theta ? 1 : 0)))
      const labeled = Array.from({ length: n }, (_, i) => i) // the first n are the labeled ones; the requests are exchangeable
      const yl = labeled.map((i) => y[i])
      const classical = mean(yl)
      const se = Math.sqrt(variance(yl) / n)
      const rect = labeled.map((i) => y[i] - f[i])
      const ppi = mean(f) + mean(rect)
      const sp = Math.sqrt(variance(f) / N + variance(rect) / n)
      hc += 1.96 * se; hp += 1.96 * sp
      if (Math.abs(classical - theta) <= 1.96 * se) cc++
      if (Math.abs(ppi - theta) <= 1.96 * sp) cp++
    }
    console.log(`${a}`.padEnd(18), `${N}`.padEnd(10), (hc / trials).toFixed(3).padEnd(22), (hp / trials).toFixed(3).padEnd(16), (cc / trials).toFixed(3).padEnd(20), (cp / trials).toFixed(3))
  }
}
