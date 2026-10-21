#!/usr/bin/env node
// Burst bench for UD-025: N inputs sent at once through the real pipeline (queue, worker, extractors, analyzer and the
// real providers) with the worker running C jobs at a time. It measures what the concurrency knob
// `QUEUE_CONCURRENCY` has to be chosen from: wall time until the last proposal, p50/p95 of the time each input
// takes from the send to its proposal, and the 429s and retries of Anthropic and Groq.
//
//   set -a; . ~/.config/team-platform/env; set +a
//   node bench/burst.mjs                              N = 1,3,5,8 and C = 1,2,4,8 with the real keys
//   node bench/burst.mjs --n 8 --c 4,8 --budget 0.3   a subset, with its own cost cap in USD
//   node bench/burst.mjs --fake --latency-ms 50       no network and no keys: checks the harness only
//
// The set of inputs is five public cases of bench/cases/ (already extracted text, as the panel sends it after the
// extractors) and one audio fixture synthesized with espeak-ng, which goes through the real extractor and Groq
// speech-to-text. The audio budget gate (7,200 s/hour, MASTER-SPEC §7.4) stays on: speech jobs defer when it is full.
//
// A cell where C >= N behaves exactly like C = N, so it is run once and the table says which C values it stands for.
// Every cell runs `--repeat` times, interleaved with the others, and the table shows the median of the times and the sum of the
// counts. Between runs the bench waits `--cooldown-s`.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.js';
import { get, initializeDatabase, openInitialized, run } from '../src/db/index.js';
import { seedDefaults } from '../src/db/seed.js';
import { createMember } from '../src/domain/members.js';
import { submitInput } from '../src/domain/inputs.js';
import { loadModules } from '../src/domain/modules.js';
import { createPipeline } from '../src/domain/pipeline.js';
import { blobPath } from '../src/domain/storage.js';
import { createEvents } from '../src/events/index.js';
import { createQueue } from '../src/queue/index.js';
import { createWorker } from '../src/worker.js';
import { loadCases } from './lib.js';
import { costOf } from './pricing.js';

const here = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);

// ---- Pure helpers (tested in burst.test.js)

/** Nearest-rank percentile: the smallest value with at least `p` percent of the sample at or below it. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1];
}

/** The runs of the grid: one per (N, effective C). `stands` lists the requested C values that behave the same. */
export function planRuns(ns, cs) {
  const plan = [];
  for (const n of ns) {
    const byEffective = new Map();
    for (const c of cs) {
      const effective = Math.min(c, n);
      byEffective.set(effective, [...(byEffective.get(effective) ?? []), c]);
    }
    for (const [concurrency, stands] of byEffective) plan.push({ n, concurrency, stands });
  }
  return plan;
}

/**
 * The knob value the measurement supports: among the runs of the largest N with no 429 from any provider and every
 * input done, the one with the lowest p95; a tie goes to the larger C. Returns null when none qualifies.
 */
export function chooseConcurrency(rows) {
  const largest = Math.max(...rows.map((r) => r.n));
  const clean = rows.filter((r) => r.n === largest && r.failed === 0 && r.providers.anthropic.s429 === 0 && r.providers.groq.s429 === 0);
  clean.sort((a, b) => a.p95_ms - b.p95_ms || b.concurrency - a.concurrency);
  return clean[0] ?? null;
}

const median = (xs) => percentile(xs, 50);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/**
 * One row for a cell of the grid from its repetitions: the median of the times, the sum of the counts (429s, requests,
 * retries, cost) and the peak of the simultaneous requests. The repetitions stay in `runs`.
 */
export function aggregateRuns(runs) {
  const first = runs[0];
  const provider = (name) => ({
    s429: sum(runs.map((r) => r.providers[name].s429)),
    requests: sum(runs.map((r) => r.providers[name].requests)),
    peak_in_flight: Math.max(...runs.map((r) => r.providers[name].peak_in_flight))
  });
  return {
    n: first.n, concurrency: first.concurrency, stands: first.stands, reps: runs.length,
    wall_ms: median(runs.map((r) => r.wall_ms)), p50_ms: median(runs.map((r) => r.p50_ms)), p95_ms: median(runs.map((r) => r.p95_ms)),
    done: sum(runs.map((r) => r.done)), failed: sum(runs.map((r) => r.failed)),
    queue_retries: sum(runs.map((r) => r.queue_retries)),
    providers: { anthropic: provider('anthropic'), groq: provider('groq') },
    cost_usd: sum(runs.map((r) => r.cost_usd)), runs
  };
}

const PROVIDER_HOSTS = { 'api.anthropic.com': 'anthropic', 'api.groq.com': 'groq' };
const emptyTally = () => ({ requests: 0, s429: 0, s5xx: 0, network_errors: 0, peak_in_flight: 0, statuses: {}, retry_after_ms: [], cost_usd: 0, limits: {}, min_remaining: {} });
const RATE_HEADERS = {
  anthropic: { requests: 'anthropic-ratelimit-requests', input_tokens: 'anthropic-ratelimit-input-tokens', output_tokens: 'anthropic-ratelimit-output-tokens' },
  groq: { requests: 'x-ratelimit-%-requests', tokens: 'x-ratelimit-%-tokens' }
};

/**
 * Wraps `fetch` so every call to Anthropic or Groq is counted: requests, status codes, 429s with their Retry-After,
 * the peak of simultaneous requests, the cost of Anthropic from the `usage` of each response and the lowest
 * remaining quota the provider reported. `snapshot()` returns the numbers and starts a new window.
 */
export function createFetchTally(baseFetch) {
  let tally = { anthropic: emptyTally(), groq: emptyTally() };
  const inFlight = { anthropic: 0, groq: 0 };
  const lowest = (slot, key, value) => {
    const n = Number(value);
    if (Number.isFinite(n)) slot.min_remaining[key] = Math.min(slot.min_remaining[key] ?? Infinity, n);
  };
  const wrapped = async (input, init) => {
    const host = new URL(typeof input === 'string' || input instanceof URL ? input : input.url).host;
    const provider = PROVIDER_HOSTS[host];
    if (!provider) return baseFetch(input, init);
    const slot = tally[provider];
    slot.requests += 1;
    inFlight[provider] += 1;
    slot.peak_in_flight = Math.max(slot.peak_in_flight, inFlight[provider]);
    try {
      const response = await baseFetch(input, init);
      slot.statuses[response.status] = (slot.statuses[response.status] ?? 0) + 1;
      if (response.status === 429) {
        slot.s429 += 1;
        const after = Number(response.headers.get('retry-after'));
        if (Number.isFinite(after)) slot.retry_after_ms.push(Math.round(after * 1000));
      } else if (response.status >= 500) {
        slot.s5xx += 1;
      }
      const names = RATE_HEADERS[provider];
      for (const [key, base] of Object.entries(names)) {
        const [limitName, remainingName] = base.includes('%') ? [base.replace('%', 'limit'), base.replace('%', 'remaining')] : [`${base}-limit`, `${base}-remaining`];
        const limit = response.headers.get(limitName);
        if (limit !== null) slot.limits[key] = Number(limit);
        const remaining = response.headers.get(remainingName);
        if (remaining !== null) lowest(slot, key, remaining);
      }
      if (provider === 'anthropic' && response.ok) {
        const body = await response.clone().json().catch(() => null);
        const u = body?.usage;
        if (u) {
          slot.cost_usd += costOf({ model: body.model, usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cached_tokens: u.cache_read_input_tokens ?? 0, cache_creation_tokens: u.cache_creation_input_tokens ?? 0 } }) ?? 0;
        }
      }
      return response;
    } catch (error) {
      slot.network_errors += 1;
      throw error;
    } finally {
      inFlight[provider] -= 1;
    }
  };
  wrapped.snapshot = () => {
    const out = tally;
    tally = { anthropic: emptyTally(), groq: emptyTally() };
    return out;
  };
  return wrapped;
}

// ---- The set of inputs

const MIME = { image: 'image/png', document: 'application/pdf', audio: 'audio/mp4' };
const CASES = ['01-chat-grupo', '03-monologo-prueba', '04-reporte-de-error', '05-idea-suelta', '06-mensaje-mezclado'];

/** Synthesizes the audio fixture (Spanish speech, about 40 s) from the text of case 06. */
async function makeAudioFixture(dir, text) {
  const wav = join(dir, 'voz.wav');
  const m4a = join(dir, 'voz.m4a');
  await exec('espeak-ng', ['-v', 'es', '-w', wav, text]);
  await exec('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', '48k', m4a]);
  return m4a;
}

/** The inputs of a burst of `n`: the cases in a fixed order, repeating from the first when n is larger. */
export function burstPlan(n, cases, audio) {
  const order = [cases[0], 'audio', cases[2], cases[3], cases[4], cases[1]];
  return Array.from({ length: n }, (_, k) => order[k % order.length]).map((spec, k) => (spec === 'audio' ? { id: 'audio', audio } : { id: spec.id, case: spec, k }));
}

// ---- One burst

export async function runBurst({ n, concurrency, cases, audio, fake, latencyMs, tally, runTimeoutS }) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'team-burst-'));
  const config = loadConfig({ DATA_DIR: dir, LOG_LEVEL: 'silent' }, { worker: { concurrency } });
  await initializeDatabase(config, { seed: seedDefaults });
  const db = openInitialized(config);
  const events = createEvents({ db });
  const queue = createQueue({ db, config, events });
  const jobs = new Map(); // job id -> { input, claimedAt, doneAt, status }
  const started = { t0: 0 };
  const pending = { open: 0, resolve: null };
  const closeOne = () => { pending.open -= 1; if (pending.open === 0) pending.resolve?.(); };
  const realClaim = queue.claim;
  const realComplete = queue.complete;
  const realFail = queue.fail;
  queue.claim = (...args) => {
    const job = realClaim(...args);
    if (job) {
      const entry = jobs.get(job.id) ?? {};
      entry.claimedAt ??= performance.now() - started.t0; // the first claim: the time the input waited in the queue
      entry.attempts = job.attempts;
      jobs.set(job.id, entry);
    }
    return job;
  };
  queue.complete = (job) => {
    const ok = realComplete(job);
    if (ok) { Object.assign(jobs.get(job.id), { doneAt: performance.now() - started.t0, status: 'done' }); closeOne(); }
    return ok;
  };
  queue.fail = (job, error, options) => {
    const result = realFail(job, error, options);
    if (result.state === 'failed') { Object.assign(jobs.get(job.id), { doneAt: performance.now() - started.t0, status: 'failed', error: String(error?.message ?? error).slice(0, 300) }); closeOne(); }
    return result;
  };

  const modules = await loadModules(config, { db, env: process.env });
  if (fake) {
    modules.analyze = async (bundle, { onProgress }) => {
      onProgress?.({ percent: 50, phrase: 'Analizando' });
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
      const area = bundle.areas[0];
      const tpl = bundle.templates.find((t) => t.area_id === area.id);
      return { status: 'ok', proposal: { messages: [{ area_id: area.id, template_id: tpl.id, title: 'Mensaje', body: bundle.text, fields: {}, assignee_ids: [], attachment_ids: [], unit_ids: [] }], discarded: [] }, units: [], calls: [], stats: {} };
    };
    modules.extract = async () => { await new Promise((resolve) => setTimeout(resolve, latencyMs)); return { text: 'voz sintética', meta: { kind: 'audio', calls: [] } }; };
    modules.estimateAudioSeconds = async () => 0;
  }
  const handlers = createPipeline({ db, config, queue, events, modules });
  const worker = createWorker({ db, queue, events, config, handlers });

  const memberId = createMember(db, { email: 'burst@example.org', name: 'Burst', profile: 'Quien envía en ráfaga.' });
  const plan = burstPlan(n, cases, audio);
  // Files go to the volume before the clock starts: the bench measures the burst, not the copy.
  const prepared = plan.map((spec, k) => {
    if (spec.audio) {
      const bytes = readFileSync(spec.audio);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      mkdirSync(config.attachmentsDir, { recursive: true });
      copyFileSync(spec.audio, blobPath(config, sha256));
      return { spec, text: `Nota de voz ${k + 1} de ${n}.`, files: [{ kind: 'audio', name: 'voz.m4a', mime: MIME.audio, size: statSync(spec.audio).size, sha256 }], extracted: [] };
    }
    const attachments = spec.case.input.attachments;
    return {
      spec,
      text: `${spec.case.input.text}\n\n(Envío ${k + 1} de ${n})`.trim(),
      files: attachments.map((a) => ({ kind: a.kind, name: a.id, mime: MIME[a.kind] ?? 'application/octet-stream', size: a.extracted.length, sha256: createHash('sha256').update(`${k}:${a.id}`).digest('hex') })),
      extracted: attachments.map((a) => a.extracted)
    };
  });

  pending.open = n;
  const finished = new Promise((resolve, reject) => {
    pending.resolve = resolve;
    setTimeout(() => reject(new Error(`the burst did not finish in ${runTimeoutS} s`)), runTimeoutS * 1000).unref();
  });
  tally.snapshot();
  started.t0 = performance.now();
  worker.start();
  const submitted = prepared.map((p) => {
    const { input, jobId } = submitInput({ db, queue, events }, { authorId: memberId, text: p.text, files: p.files, links: [] });
    p.extracted.forEach((text, i) => run(db, 'UPDATE attachments SET extracted_text = ?, extracted_at = ? WHERE input_id = ? AND name = ?', text, Date.now(), input.id, p.files[i].name));
    jobs.set(jobId, { claimedAt: null });
    return { inputId: input.id, jobId, spec: p.spec };
  });

  let timedOut = null;
  try { await finished; } catch (error) { timedOut = error.message; }
  const wallMs = performance.now() - started.t0;
  const providers = tally.snapshot();
  await worker.stop();
  const perInput = submitted.map((s) => {
    const j = jobs.get(s.jobId);
    const row = get(db, 'SELECT status, error FROM inputs WHERE id = ?', s.inputId);
    return { case: s.spec.id, status: row.status, attempts: j.attempts ?? 0, wait_ms: j.claimedAt, done_ms: j.doneAt ?? null, error: row.error };
  });
  db.close();
  rmSync(dir, { recursive: true, force: true });

  const times = perInput.filter((p) => p.done_ms !== null && p.status === 'proposed').map((p) => p.done_ms);
  return {
    n, concurrency, wall_ms: Math.round(wallMs), timed_out: timedOut,
    p50_ms: Math.round(percentile(times, 50) ?? NaN), p95_ms: Math.round(percentile(times, 95) ?? NaN),
    done: times.length, failed: n - times.length,
    queue_retries: perInput.reduce((sum, p) => sum + Math.max(0, p.attempts - 1), 0),
    providers, cost_usd: providers.anthropic.cost_usd, inputs: perInput
  };
}

// ---- Report

const secs = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(1) : 'n/a');

export function formatMarkdown(rows, { stands = new Map() } = {}) {
  const head = '| N | C | Runs | Wall (s) | p50 (s) | p95 (s) | Done | Anthropic 429 / requests | Groq 429 / requests | Queue retries | Peak requests in flight (Anthropic) | Cost (USD) |\n|---|---|---|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map((r) => {
    const label = stands.get(`${r.n}:${r.concurrency}`) ?? String(r.concurrency);
    return `| ${r.n} | ${label} | ${r.reps ?? 1} | ${secs(r.wall_ms)} | ${secs(r.p50_ms)} | ${secs(r.p95_ms)} | ${r.done}/${r.n * (r.reps ?? 1)} | ${r.providers.anthropic.s429} / ${r.providers.anthropic.requests} | ${r.providers.groq.s429} / ${r.providers.groq.requests} | ${r.queue_retries} | ${r.providers.anthropic.peak_in_flight} | ${r.cost_usd.toFixed(4)} |`;
  });
  return [head, ...lines].join('\n');
}

// ---- Main

async function main() {
  const { values } = parseArgs({
    options: {
      n: { type: 'string', default: '1,3,5,8' },
      c: { type: 'string', default: '1,2,4,8' },
      budget: { type: 'string', default: '1' },
      repeat: { type: 'string', default: '3' },
      'cooldown-s': { type: 'string', default: '10' },
      'run-timeout-s': { type: 'string', default: '900' },
      fake: { type: 'boolean', default: false },
      'latency-ms': { type: 'string', default: '50' },
      out: { type: 'string' }
    }
  });
  const ns = values.n.split(',').map(Number);
  const cs = values.c.split(',').map(Number);
  const budget = Number(values.budget);
  if (!values.fake && (!process.env.ANTHROPIC_API_KEY || !process.env.GROQ_API_KEY)) {
    throw new Error('Missing ANTHROPIC_API_KEY or GROQ_API_KEY: load them with `set -a; . ~/.config/team-platform/env; set +a`.');
  }
  const tally = createFetchTally(globalThis.fetch);
  globalThis.fetch = tally;

  const all = loadCases();
  const cases = CASES.map((id) => {
    const found = all.find((c) => c.id === id);
    if (!found) throw new Error(`Case ${id} not found in bench/cases`);
    return found;
  });
  const workDir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'team-burst-audio-'));
  const audio = values.fake ? join(workDir, 'voz.m4a') : await makeAudioFixture(workDir, cases[4].input.text);
  if (values.fake) writeFileSync(audio, 'fake audio bytes');
  const seconds = values.fake ? 0 : Number((await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio])).stdout);
  console.error(`audio fixture: ${seconds.toFixed(1)} s`);

  const plan = planRuns(ns, cs);
  const repeat = Number(values.repeat);
  const byCell = plan.map(() => []);
  let spent = 0;
  const perInputCost = [];
  let first = true;
  // Repetitions are the outer loop: a slow hour at a provider spreads over every cell instead of landing on one.
  for (let rep = 1; rep <= repeat; rep++) {
    for (const [index, step] of plan.entries()) {
      const projected = (perInputCost.length ? Math.max(...perInputCost) : 0) * step.n;
      if (spent + projected > budget) {
        console.error(`skipped N=${step.n} C=${step.concurrency} rep ${rep}: ${spent.toFixed(3)} spent + ${projected.toFixed(3)} projected would pass the ${budget} USD cap`);
        continue;
      }
      if (!first && !values.fake) await new Promise((resolve) => setTimeout(resolve, Number(values['cooldown-s']) * 1000));
      first = false;
      console.error(`rep ${rep}: N=${step.n} C=${step.concurrency} (stands for C=${step.stands.join(',')}) ...`);
      const row = await runBurst({ n: step.n, concurrency: step.concurrency, cases, audio, fake: values.fake, latencyMs: Number(values['latency-ms']), tally, runTimeoutS: Number(values['run-timeout-s']) });
      row.stands = step.stands;
      byCell[index].push(row);
      spent += row.cost_usd;
      perInputCost.push(row.cost_usd / step.n);
      console.error(`  wall ${secs(row.wall_ms)} s, p95 ${secs(row.p95_ms)} s, done ${row.done}/${row.n}, 429 anthropic ${row.providers.anthropic.s429} groq ${row.providers.groq.s429}, retries ${row.queue_retries}, cost ${row.cost_usd.toFixed(4)} (total ${spent.toFixed(4)})`);
    }
  }
  const rows = byCell.filter((runs) => runs.length > 0).map(aggregateRuns);
  rmSync(workDir, { recursive: true, force: true });

  const stands = new Map(rows.map((r) => [`${r.n}:${r.concurrency}`, r.stands.length > 1 || r.stands[0] !== r.concurrency ? `${r.concurrency} (stands for ${r.stands.join(', ')})` : String(r.concurrency)]));
  const chosen = rows.length ? chooseConcurrency(rows) : null;
  console.log(formatMarkdown(rows, { stands }));
  console.log(`\nTotal cost: ${spent.toFixed(4)} USD (cap ${budget})`);
  console.log(chosen ? `Chosen: C=${chosen.concurrency} (N=${chosen.n}: p95 ${secs(chosen.p95_ms)} s, no 429)` : 'No run qualifies: every run of the largest N had a 429 or a failed input.');
  const out = values.out ?? join(here, 'results', `burst-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), budget, spent, audio_seconds: seconds, rows, chosen: chosen ? { n: chosen.n, concurrency: chosen.concurrency } : null }, null, 2));
  console.error(`raw result: ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
