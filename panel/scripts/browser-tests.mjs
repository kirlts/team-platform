#!/usr/bin/env node
// Runs the browser tests of the panel (`*.browser.test.mjs`) as a pool of processes, with ONE build of the panel for the whole run.
//
//   node scripts/browser-tests.mjs                          every browser test
//   node scripts/browser-tests.mjs src/flows-vaciar.browser.test.mjs src/theme.browser.test.mjs
//   PANEL_BROWSER_JOBS=2 node scripts/browser-tests.mjs     another size for the pool
//
// Why a pool of processes and not `node --test --test-concurrency=1` (what test:flows did): the files do not depend on each other (each starts
// its own example server on a port the system picks and its own Chromium), so running them one after another only added their durations
// (measured 2026-10-25: 967 s of file time, 327 s with three at a time). The build is made here, once, into a folder of this run, and every
// file serves it (PANEL_DEV_DIST); a file run alone still builds its own. fits-one-screen is split by window size (FIT_SHARD), because
// alone it was 227 s of that total, run in series.
//
// Heaviest first: the pool ends when its last job ends, so what takes longest starts at the beginning. «Heaviest» is the size of the file
// (its number of checks), with the shards of fits-one-screen before everything.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHARDS } from '../src/fit-shards.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FIT = 'src/fits-one-screen.browser.test.mjs'
const given = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const all = readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.browser.test.mjs')).map((f) => `src/${f}`)
const files = given.length ? given.map((f) => path.relative(root, path.resolve(process.cwd(), f))) : all
const jobs = files.flatMap((file) => (file === FIT && !process.env.FIT_SHARD ? SHARDS.map((shard) => ({ file, shard, weight: Infinity })) : [{ file, shard: '', weight: statSync(path.join(root, file)).size }]))
jobs.sort((a, b) => b.weight - a.weight)

// One job takes about a core and a half (the server, Chromium and its renderer); the pool is as wide as the cores that were measured, never a guess about the machine.
const cores = availableParallelism()
const width = Math.max(1, Math.min(jobs.length, Number(process.env.PANEL_BROWSER_JOBS ?? Math.floor((cores * 2) / 3) + 1)))

const own = process.env.PANEL_DEV_DIST ? null : mkdtempSync(path.join(tmpdir(), 'panel-dist-run-'))
if (own) {
  execFileSync('npx', ['vite', 'build', '--outDir', own, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'inherit' })
  process.env.PANEL_DEV_DIST = own
  process.env.FIT_SIN_BUILD = '1'
}
const started = Date.now()
const failed = []
const rerun = []
let next = 0

function run(job) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const child = spawn(process.execPath, ['--test', job.file], { cwd: root, env: { ...process.env, ...(job.shard ? { FIT_SHARD: job.shard } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (out += c))
    child.on('close', (code) => {
      const label = `${job.file}${job.shard ? ` [${job.shard}]` : ''}`
      console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s  ${label}`)
      if (code !== 0) {
        rerun.push(job)
        failed.push(label)
        console.log(out.split('\n').filter((l) => /not ok|Error|expected|actual|\+ |\- /.test(l)).slice(0, 40).join('\n'))
      }
      resolve()
    })
  })
}

async function worker() {
  while (next < jobs.length) await run(jobs[next++])
}
try {
  await Promise.all(Array.from({ length: width }, worker))
  // A file that failed with the pool at full width is run again alone, once and only that file: the machine of the run is shared with image builds
  // and the pool saturates its cores (2026-10-26: on 4 cores a different file failed in each run and every one passed alone). A file that fails
  // alone too is a real failure and stays in the list. PANEL_BROWSER_RETRY=0 turns this off to tell a failure of the file from one of the load.
  if (rerun.length && process.env.PANEL_BROWSER_RETRY !== '0') {
    const again = rerun.splice(0)
    failed.length = 0
    console.log(`reintento a solas de ${again.length} archivo(s) que cayeron con el pool lleno`)
    for (const job of again) await run(job)
    for (const label of failed.splice(0)) failed.push(label)
  }
} finally {
  if (own) rmSync(own, { recursive: true, force: true })
}
console.log(`${jobs.length} job(s), ${width} at a time, ${((Date.now() - started) / 1000).toFixed(1)} s${failed.length ? `; failed:\n  ${failed.join('\n  ')}` : ''}`)
process.exit(failed.length ? 1 : 0)
