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
//   node bench/burst.mjs --n 16 --c 3,6 --inflight 0   --inflight sets PROVIDER_MAX_INFLIGHT_ANTHROPIC (0 = limiter off)
//   node bench/burst.mjs --probe --repeat 3             ramps simultaneous minimal Anthropic requests to find the 429 cap
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
import { limiterStats, resetLimiters } from '../src/providers/limiter.js';
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
export function chooseConcurrency(rows, { allow429 = false, providerFailuresOnly = false } = {}) {
  const largest = Math.max(...rows.map((r) => r.n));
  // With the limiter on, a 429 the cap absorbed (retried by the limiter or the queue) is not a failure: `allow429` keeps only the failed inputs as the disqualifier.
  const clean = rows.filter((r) => r.n === largest && (providerFailuresOnly ? (r.failed_provider ?? r.failed) : r.failed) === 0 && (allow429 || (r.providers.anthropic.s429 === 0 && r.providers.groq.s429 === 0)));
  clean.sort((a, b) => a.p95_ms - b.p95_ms || b.concurrency - a.concurrency);
  return clean[0] ?? null;
}

/**
 * The Anthropic cap the probe supports. `reps` is one list per repetition of `{level, s429}` in ascending order. A level is
 * clean when no repetition had a 429 at it; the cap is the highest clean level below the lowest level that had a 429,
 * minus one (the key is shared, so the margin is one request). Returns null when even the first level had a 429.
 */
export function chooseInflightCap(reps) {
  const levels = [...new Set(reps.flat().map((r) => r.level))].sort((a, b) => a - b);
  const firstBad = levels.find((level) => reps.some((rep) => rep.some((r) => r.level === level && r.s429 > 0)));
  const clean = levels.filter((level) => (firstBad === undefined || level < firstBad) && reps.every((rep) => rep.some((r) => r.level === level)));
  if (clean.length === 0) return null;
  return { highest_clean: clean.at(-1), first_429_level: firstBad ?? null, cap: Math.max(1, clean.at(-1) - 1) };
}

/**
 * True when an input failed because of a provider (HTTP error, 429, timeout) and not because the analysis itself did not
 * produce a valid proposal. Old result files only keep the message, which starts with the provider name.
 */
export function isProviderFailure(input) {
  if (input.status === 'proposed') return false;
  if (input.error_code) return ['http', 'timeout'].includes(input.error_code);
  return /^(anthropic|groq|groq-speech|deepseek|openrouter|gemini|openai-compatible):/.test(input.error ?? '');
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
    peak_in_flight: Math.max(...runs.map((r) => r.providers[name].peak_in_flight)),
    call_p95_ms: percentile(runs.flatMap((r) => r.providers[name].durations_ms ?? []), 95)
  });
  return {
    n: first.n, concurrency: first.concurrency, stands: first.stands, reps: runs.length,
    wall_ms: median(runs.map((r) => r.wall_ms)), p50_ms: median(runs.map((r) => r.p50_ms)), p95_ms: median(runs.map((r) => r.p95_ms)),
    done: sum(runs.map((r) => r.done)), failed: sum(runs.map((r) => r.failed)),
    failed_provider: sum(runs.map((r) => r.failed_provider ?? r.inputs?.filter(isProviderFailure).length ?? 0)),
    queue_retries: sum(runs.map((r) => r.queue_retries)),
    inflight: first.inflight ?? null,
    cut_backs: sum(runs.map((r) => r.limiter?.cut_backs ?? 0)),
    queue_ms_max: Math.max(0, ...runs.map((r) => r.limiter?.queue_ms_max ?? 0)),
    providers: { anthropic: provider('anthropic'), groq: provider('groq') },
    cost_usd: sum(runs.map((r) => r.cost_usd)), runs
  };
}

const PROVIDER_HOSTS = { 'api.anthropic.com': 'anthropic', 'api.groq.com': 'groq' };
const emptyTally = () => ({ requests: 0, s429: 0, s5xx: 0, network_errors: 0, peak_in_flight: 0, statuses: {}, retry_after_ms: [], durations_ms: [], cost_usd: 0, limits: {}, min_remaining: {} });
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
    const startedAt = performance.now();
    try {
      const response = await baseFetch(input, init);
      if (response.ok) slot.durations_ms.push(Math.round(performance.now() - startedAt)); // until the headers: the body of these calls arrives with them
      slot.statuses[response.status] = (slot.statuses[response.status] ?? 0) + 1;
      if (response.status === 429) {
        slot.s429 += 1;
        const header = response.headers.get('retry-after');
        if (header !== null && Number.isFinite(Number(header))) slot.retry_after_ms.push(Math.round(Number(header) * 1000));
        slot.last_429_body ??= (await response.clone().text().catch(() => '')).slice(0, 200);
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

export async function runBurst({ n, concurrency, cases, audio, fake, latencyMs, tally, runTimeoutS, inflight = null }) {
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
    if (result.state === 'failed') { Object.assign(jobs.get(job.id), { doneAt: performance.now() - started.t0, status: 'failed', error: String(error?.message ?? error).slice(0, 300), error_code: error?.code ?? null }); closeOne(); }
    return result;
  };

  // `inflight` overrides the Anthropic cap of the run (0 = limiter off); the limiter state starts clean in every run.
  const env = inflight === null ? process.env : { ...process.env, PROVIDER_MAX_INFLIGHT_ANTHROPIC: String(inflight) };
  const modules = await loadModules(config, { db, env });
  if (!fake) modules.getProviders();
  resetLimiters();
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
  const limiter = limiterStats().find((l) => l.name === 'anthropic') ?? null;
  await worker.stop();
  const perInput = submitted.map((s) => {
    const j = jobs.get(s.jobId);
    const row = get(db, 'SELECT status, error FROM inputs WHERE id = ?', s.inputId);
    return { case: s.spec.id, status: row.status, attempts: j.attempts ?? 0, wait_ms: j.claimedAt, done_ms: j.doneAt ?? null, error: row.error, error_code: j.error_code ?? null };
  });
  db.close();
  rmSync(dir, { recursive: true, force: true });

  const times = perInput.filter((p) => p.done_ms !== null && p.status === 'proposed').map((p) => p.done_ms);
  return {
    n, concurrency, inflight, limiter, wall_ms: Math.round(wallMs), timed_out: timedOut,
    p50_ms: Math.round(percentile(times, 50) ?? NaN), p95_ms: Math.round(percentile(times, 95) ?? NaN),
    done: times.length, failed: n - times.length, failed_provider: perInput.filter(isProviderFailure).length,
    queue_retries: perInput.reduce((sum, p) => sum + Math.max(0, p.attempts - 1), 0),
    providers, cost_usd: providers.anthropic.cost_usd, inputs: perInput
  };
}

// ---- Report

const secs = (ms) => (Number.isFinite(ms) ? (ms / 1000).toFixed(1) : 'n/a');

export function formatMarkdown(rows, { stands = new Map() } = {}) {
  const head = '| N | C | Cap | Runs | Wall (s) | p50 (s) | p95 (s) | Done | Failed by provider | Anthropic 429 / requests | Groq 429 / requests | Queue retries | Peak requests in flight (Anthropic) | Cap cut-backs | Longest wait for a slot (s) | Anthropic call p95 (s) | Cost (USD) |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map((r) => {
    const label = stands.get(`${r.n}:${r.concurrency}`) ?? String(r.concurrency);
    const cap = r.inflight === null || r.inflight === undefined ? 'default' : (r.inflight === 0 ? 'off' : r.inflight);
    return `| ${r.n} | ${label} | ${cap} | ${r.reps ?? 1} | ${secs(r.wall_ms)} | ${secs(r.p50_ms)} | ${secs(r.p95_ms)} | ${r.done}/${r.n * (r.reps ?? 1)} | ${r.failed_provider ?? 0} | ${r.providers.anthropic.s429} / ${r.providers.anthropic.requests} | ${r.providers.groq.s429} / ${r.providers.groq.requests} | ${r.queue_retries} | ${r.providers.anthropic.peak_in_flight} | ${r.cut_backs ?? 0} | ${secs(r.queue_ms_max ?? 0)} | ${secs(r.providers.anthropic.call_p95_ms ?? NaN)} | ${r.cost_usd.toFixed(4)} |`;
  });
  return [head, ...lines].join('\n');
}


// ---- Probe of the Anthropic cap of simultaneous requests

/** Smallest valid Haiku call whose answer takes about a second, so the requests of a level overlap in time. */
const PROBE_BODY = JSON.stringify({
  model: 'claude-haiku-5-5',
  max_tokens: 48,
  messages: [{ role: 'user', content: 'Write the numbers from 1 to 20 separated by commas.' }]
});

/**
 * One ramp: for every level, `level` identical minimal requests are fired at the same instant and awaited; the ramp
 * stops at the first level with a 429 (no point in hammering a key shared with other sessions).
 * @returns {Promise<{level: number, s429: number, ok: number, other: number, peak_in_flight: number, duration_ms: number[], body_429: string|null}[]>}
 */
export async function probeRamp({ levels, tally, pauseMs, fetchImpl = globalThis.fetch, apiKey = process.env.ANTHROPIC_API_KEY }) {
  const out = [];
  for (const level of levels) {
    tally.snapshot();
    const results = await Promise.all(Array.from({ length: level }, async () => {
      const started = performance.now();
      try {
        const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: PROBE_BODY
        });
        await response.text();
        return { status: response.status, ms: performance.now() - started };
      } catch (error) {
        return { status: 0, ms: performance.now() - started, error: String(error?.message ?? error) };
      }
    }));
    const counted = tally.snapshot().anthropic;
    const row = {
      level,
      s429: results.filter((r) => r.status === 429).length,
      ok: results.filter((r) => r.status === 200).length,
      other: results.filter((r) => r.status !== 200 && r.status !== 429).length,
      peak_in_flight: counted.peak_in_flight,
      duration_ms: results.filter((r) => r.status === 200).map((r) => Math.round(r.ms)),
      body_429: counted.last_429_body ?? null,
      cost_usd: counted.cost_usd
    };
    out.push(row);
    if (row.s429 > 0) break;
    if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return out;
}

/** Prints the table and the choice of C for every cap setting of `rows`; returns the choices. */
export function printReport(rows, { inflights, budget, spent }) {
  const stands = new Map(rows.map((r) => [`${r.n}:${r.concurrency}`, r.stands.length > 1 || r.stands[0] !== r.concurrency ? `${r.concurrency} (stands for ${r.stands.join(', ')})` : String(r.concurrency)]));
  console.log(formatMarkdown(rows, { stands }));
  if (budget !== undefined) console.log(`\nTotal cost: ${spent.toFixed(4)} USD (cap ${budget})`);
  // One choice per cap setting: the rows of different caps are different experiments.
  const chosenBy = [];
  for (const inflight of inflights) {
    const group = rows.filter((r) => (r.inflight ?? null) === inflight);
    if (group.length === 0) continue;
    const strict = chooseConcurrency(group);
    const failedOnly = chooseConcurrency(group, { allow429: true });
    const byProvider = chooseConcurrency(group, { allow429: true, providerFailuresOnly: true });
    chosenBy.push({ inflight, strict: strict && { n: strict.n, concurrency: strict.concurrency }, failed_only: failedOnly && { n: failedOnly.n, concurrency: failedOnly.concurrency }, no_provider_failure: byProvider && { n: byProvider.n, concurrency: byProvider.concurrency } });
    const label = inflight === null ? 'default cap' : `cap ${inflight}`;
    const line = (what, pick) => console.log(pick ? `Chosen (${label}, ${what}): C=${pick.concurrency} (N=${pick.n}: p95 ${secs(pick.p95_ms)} s)` : `No run qualifies (${label}, ${what}).`);
    line('no 429 and no failed input', strict);
    line('no failed input', failedOnly);
    line('no input failed by a provider', byProvider);
  }
  return chosenBy;
}

/** Re-aggregates the runs saved by one or more result files (same cell = same N, C and cap) and prints the report. */
function mainReport(files) {
  const cells = new Map();
  for (const file of files) {
    for (const row of JSON.parse(readFileSync(file, 'utf8')).rows) {
      for (const run of row.runs) {
        const key = `${run.n}:${run.concurrency}:${run.inflight ?? 'default'}`;
        cells.set(key, [...(cells.get(key) ?? []), { ...run, stands: row.stands }]);
      }
    }
  }
  const rows = [...cells.values()].map(aggregateRuns).sort((x, y) => (x.inflight ?? -1) - (y.inflight ?? -1) || x.n - y.n || x.concurrency - y.concurrency);
  const inflights = [...new Set(rows.map((r) => r.inflight ?? null))];
  const spent = rows.reduce((a, r) => a + r.cost_usd, 0);
  printReport(rows, { inflights, spent });
  console.log(`\nCost of the pooled files: ${spent.toFixed(4)} USD`);
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
      out: { type: 'string' },
      inflight: { type: 'string' },
      probe: { type: 'boolean', default: false },
      report: { type: 'string' },
      levels: { type: 'string', default: '4,8,12,16,24,32' }
    }
  });
  if (values.report) return mainReport(values.report.split(','));
  const ns = values.n.split(',').map(Number);
  const cs = values.c.split(',').map(Number);
  const budget = Number(values.budget);
  if (!values.fake && (!process.env.ANTHROPIC_API_KEY || !process.env.GROQ_API_KEY)) {
    throw new Error('Missing ANTHROPIC_API_KEY or GROQ_API_KEY: load them with `set -a; . ~/.config/team-platform/env; set +a`.');
  }
  const tally = createFetchTally(globalThis.fetch);
  globalThis.fetch = tally;
  if (values.probe) return mainProbe(values, tally, budget);
  const inflights = values.inflight === undefined ? [null] : values.inflight.split(',').map(Number);

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

  const plan = inflights.flatMap((inflight) => planRuns(ns, cs).map((step) => ({ ...step, inflight })));
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
      console.error(`rep ${rep}: N=${step.n} C=${step.concurrency} cap=${step.inflight ?? 'default'} (stands for C=${step.stands.join(',')}) ...`);
      const row = await runBurst({ n: step.n, concurrency: step.concurrency, cases, audio, fake: values.fake, latencyMs: Number(values['latency-ms']), tally, runTimeoutS: Number(values['run-timeout-s']), inflight: step.inflight });
      row.stands = step.stands;
      byCell[index].push(row);
      spent += row.cost_usd;
      perInputCost.push(row.cost_usd / step.n);
      console.error(`  wall ${secs(row.wall_ms)} s, p95 ${secs(row.p95_ms)} s, done ${row.done}/${row.n}, 429 anthropic ${row.providers.anthropic.s429} groq ${row.providers.groq.s429}, retries ${row.queue_retries}, cost ${row.cost_usd.toFixed(4)} (total ${spent.toFixed(4)})`);
    }
  }
  const rows = byCell.filter((runs) => runs.length > 0).map(aggregateRuns);
  rmSync(workDir, { recursive: true, force: true });

  const chosen = printReport(rows, { inflights, budget, spent });
  const out = values.out ?? join(here, 'results', `burst-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), budget, spent, audio_seconds: seconds, rows, chosen }, null, 2));
  console.error(`raw result: ${out}`);
}


async function mainProbe(values, tally, budget) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY: load it with `set -a; . ~/.config/team-platform/env; set +a`.');
  const levels = values.levels.split(',').map(Number);
  const repeat = Number(values.repeat);
  const pauseMs = Number(values['cooldown-s']) * 1000;
  const reps = [];
  let spent = 0;
  for (let rep = 1; rep <= repeat; rep++) {
    if (spent > budget) { console.error(`probe stopped: ${spent.toFixed(4)} USD spent passes the ${budget} USD cap`); break; }
    const ramp = await probeRamp({ levels, tally, pauseMs });
    spent += ramp.reduce((a, r) => a + r.cost_usd, 0);
    reps.push(ramp);
    console.error(`rep ${rep}: ${ramp.map((r) => `${r.level}:${r.s429}x429/${r.ok}ok/${r.other}other`).join('  ')}`);
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  const choice = chooseInflightCap(reps);
  const durations = reps.flat().flatMap((r) => r.duration_ms);
  console.log('| Rep | Level | 429 | 200 | Other | Peak in flight | Median duration (ms) |\n|---|---|---|---|---|---|---|');
  reps.forEach((ramp, i) => ramp.forEach((r) => console.log(`| ${i + 1} | ${r.level} | ${r.s429} | ${r.ok} | ${r.other} | ${r.peak_in_flight} | ${percentile(r.duration_ms, 50) ?? 'n/a'} |`)));
  console.log(`\nCost: ${spent.toFixed(4)} USD (cap ${budget}). Duration of a minimal call: median ${percentile(durations, 50)} ms, p95 ${percentile(durations, 95)} ms.`);
  console.log(choice ? `Highest level with no 429 in any repetition: ${choice.highest_clean}; first level with a 429: ${choice.first_429_level ?? 'none reached'}; cap = ${choice.cap}.` : 'The first level already had a 429.');
  const out = values.out ?? join(here, 'results', `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), budget, spent, levels, reps, choice, duration_p50_ms: percentile(durations, 50), duration_p95_ms: percentile(durations, 95) }, null, 2));
  console.error(`raw result: ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
