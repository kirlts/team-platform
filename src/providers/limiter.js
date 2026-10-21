// Process-wide semaphore of in-flight requests per provider (H-83, UD-025).
//
// Why it exists: one analysis fires up to 16 provider requests at once (`partitionConcurrency`) and Anthropic caps the
// simultaneous requests of the whole organization (429 "Number of concurrent requests across all models has exceeded your
// organization's limit", no Retry-After, the value is in no header). Measured in
// docs/investigaciones/mediciones/2026-10-21-concurrencia-de-la-cola.md: above 3 queue jobs the 429s start. The queue
// concurrency counts jobs, the cap counts requests, so the cap is enforced where the requests leave: here.
//
// Rules of the semaphore:
//  - One limiter per provider (`limiterFor`), shared by every slot and every job of the process.
//  - Fair: FIFO inside one job, round-robin across jobs (`team.job_id`), so a job with 16 waiting requests cannot starve
//    a job with one. The job comes from the AsyncLocalStorage scope the worker opens (`runInJobScope`).
//  - Cancellable: a waiter leaves the queue when the job's AbortSignal fires.
//  - Adaptive (AIMD): a 429 without Retry-After lowers the effective cap by one, at most once per cooldown window, and the
//    cap climbs back one request per restore step. Computed from the clock when asked: no timer, no polling.
//  - `max` 0 means no limit and no AIMD: the way back to the old behavior.
import { AsyncLocalStorage } from 'node:async_hooks';
import { metrics, trace } from '@opentelemetry/api';
import { annotate } from '../telemetry/api.js';

/**
 * Defaults of the knobs (src/config.js reads the same constants).
 * anthropic: highest level with zero 429s minus one, probed three times (see the measurement file, section "Probe of the
 * Anthropic cap"). groq and openaiCompatible: Groq returned 0 429s in 45 requests at 17 in flight and the compatible
 * providers have no measurement, so they start at the Anthropic value, the only one measured (medición 2026-10-21).
 * cooldownMs and restoreStepMs: one request duration of Anthropic, measured in the same file (medición 2026-10-21).
 */
export const PROVIDER_LIMIT_DEFAULTS = Object.freeze({
  anthropic: 7, // medición 2026-10-21, docs/investigaciones/mediciones/2026-10-21-concurrencia-de-la-cola.md
  groq: 7, // medición 2026-10-21, same file: Groq had 0 429s, no cap measured
  openaiCompatible: 7, // medición 2026-10-21, same file: not measured, inherits the Anthropic value
  cooldownMs: 3300, // medición 2026-10-21, same file: p95 of the duration of an Anthropic call (3.3 s at the highest cell)
  restoreStepMs: 3300, // medición 2026-10-21, same file: one call p95 per restored request
});

const jobScope = new AsyncLocalStorage();

/** Runs `fn` with the job (id and AbortSignal) the provider calls inside it belong to. */
export function runInJobScope({ jobId, signal }, fn) {
  return jobScope.run({ jobId: jobId === undefined || jobId === null ? null : String(jobId), signal: signal ?? null }, fn);
}

/** The job scope of the running code, or null outside a job. */
export function currentJobScope() {
  return jobScope.getStore() ?? null;
}

/** A 429 that is the simultaneous-requests cap: Anthropic sends it without Retry-After. */
export function isConcurrencyCapError(error) {
  return error?.code === 'http' && error.status === 429 && (error.retryAfterMs === null || error.retryAfterMs === undefined);
}

function abortError(signal) {
  if (signal.reason instanceof Error) return signal.reason;
  return Object.assign(new Error(`provider limiter: aborted (${String(signal.reason ?? 'abort')})`), { name: 'AbortError', code: 'aborted' });
}

const NO_JOB = '';

/**
 * @param {object} cfg
 * @param {string} cfg.name
 * @param {number} [cfg.max] simultaneous requests; 0 = no limit
 * @param {number} [cfg.cooldownMs]
 * @param {number} [cfg.restoreStepMs]
 * @param {() => number} [cfg.now] clock in ms (tests inject theirs)
 * @param {{warn?: Function, info?: Function}} [cfg.logger]
 */
export function createLimiter({ name, max = 0, cooldownMs = PROVIDER_LIMIT_DEFAULTS.cooldownMs, restoreStepMs = PROVIDER_LIMIT_DEFAULTS.restoreStepMs, now = () => performance.now(), logger = null }) {
  let configuredMax = max;
  let inflight = 0;
  let waiting = 0;
  let reducedTo = null; // effective cap after the last decrease; null = not reduced
  let restoreFrom = 0; // the cap starts climbing at this time
  let granted = 0;
  let cutBacks = 0;
  let peakWaiting = 0;
  let queueMsMax = 0;
  let queueMsTotal = 0;
  const queues = new Map(); // job key -> waiters, FIFO
  const rotation = []; // job keys with waiters, in round-robin order

  function effectiveCap() {
    if (configuredMax === 0) return Infinity;
    if (reducedTo === null) return configuredMax;
    const t = now();
    const climbed = t >= restoreFrom ? Math.floor((t - restoreFrom) / restoreStepMs) : 0;
    const cap = Math.min(configuredMax, reducedTo + climbed);
    if (cap >= configuredMax) reducedTo = null;
    return cap;
  }

  function nextWaiter() {
    const key = rotation[0];
    const queue = queues.get(key);
    const waiter = queue.shift();
    if (queue.length === 0) {
      queues.delete(key);
      rotation.shift();
    } else {
      rotation.push(rotation.shift());
    }
    return waiter;
  }

  function drain() {
    while (waiting > 0 && inflight < effectiveCap()) {
      const waiter = nextWaiter();
      waiting -= 1;
      waiter.grant();
    }
  }

  function makeSlot(queuedAt) {
    inflight += 1;
    granted += 1;
    const queueMs = Math.max(0, now() - queuedAt);
    queueMsMax = Math.max(queueMsMax, queueMs);
    queueMsTotal += queueMs;
    let released = false;
    return {
      queue_ms: queueMs,
      release() {
        if (released) return;
        released = true;
        inflight -= 1;
        drain();
      },
    };
  }

  function annotateGrant(slot) {
    annotate({
      'team.provider.queue_ms': Math.round(slot.queue_ms * 10) / 10,
      'team.provider.inflight': inflight,
      'team.provider.waiting': waiting,
      'team.provider.effective_cap': Number.isFinite(effectiveCap()) ? effectiveCap() : 0,
    });
  }

  const limiter = {
    name,
    /**
     * Waits for a free slot. Resolves to `{release, queue_ms}`; the caller releases in `finally`.
     * @param {{jobId?: string|number|null, signal?: AbortSignal|null}} [who] defaults to the job scope of the caller
     */
    acquire(who = {}) {
      const scope = currentJobScope();
      const jobId = who.jobId ?? scope?.jobId ?? null;
      const signal = who.signal ?? scope?.signal ?? null;
      if (signal?.aborted) return Promise.reject(abortError(signal));
      const queuedAt = now();
      if (waiting === 0 && inflight < effectiveCap()) {
        const slot = makeSlot(queuedAt);
        annotateGrant(slot);
        return Promise.resolve(slot);
      }
      const key = jobId === null ? NO_JOB : String(jobId);
      return new Promise((resolve, reject) => {
        const waiter = {
          grant() {
            signal?.removeEventListener('abort', onAbort);
            const slot = makeSlot(queuedAt);
            annotateGrant(slot);
            resolve(slot);
          },
        };
        function onAbort() {
          const queue = queues.get(key);
          const at = queue ? queue.indexOf(waiter) : -1;
          if (at === -1) return; // already granted
          queue.splice(at, 1);
          waiting -= 1;
          if (queue.length === 0) {
            queues.delete(key);
            rotation.splice(rotation.indexOf(key), 1);
          }
          reject(abortError(signal));
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        if (!queues.has(key)) {
          queues.set(key, []);
          rotation.push(key);
        }
        queues.get(key).push(waiter);
        waiting += 1;
        peakWaiting = Math.max(peakWaiting, waiting);
      });
    },

    /** Acquire, run `fn`, release; a concurrency-cap 429 from `fn` lowers the cap. */
    async run(fn, who) {
      const slot = await limiter.acquire(who);
      try {
        return await fn();
      } catch (error) {
        if (isConcurrencyCapError(error)) limiter.congested(error);
        throw error;
      } finally {
        slot.release();
      }
    },

    /**
     * Multiplicative step of AIMD, here a decrease of one request: at most once per cooldown window, because the
     * requests in flight when the cap is hit all fail together and must count as one signal.
     * @returns {boolean} true when the cap went down
     */
    congested(error) {
      if (configuredMax === 0) return false;
      const t = now();
      const before = effectiveCap();
      if (reducedTo !== null && t < restoreFrom) return false;
      const after = Math.max(1, before - 1);
      reducedTo = after;
      restoreFrom = t + cooldownMs;
      cutBacks += 1;
      const detail = { provider: name, from: before, to: after, max: configuredMax, inflight, waiting, cooldown_ms: cooldownMs, status: error?.status ?? null };
      logger?.warn?.(detail, `provider ${name}: 429 on the concurrent requests cap, effective cap ${before} -> ${after}`);
      trace.getActiveSpan()?.addEvent('team.provider.cap_reduced', { 'team.provider': name, 'team.provider.cap_from': before, 'team.provider.cap_to': after, 'team.provider.cooldown_ms': cooldownMs });
      return after < before;
    },

    /** Changes the configured cap (0 = no limit). A lower or higher value takes effect for the next grant. */
    configure({ max: newMax, cooldownMs: newCooldown, restoreStepMs: newStep } = {}) {
      if (newMax !== undefined && newMax !== configuredMax) {
        configuredMax = newMax;
        reducedTo = null;
      }
      if (newCooldown !== undefined) cooldownMs = newCooldown;
      if (newStep !== undefined) restoreStepMs = newStep;
      drain();
    },

    setLogger(l) {
      logger = l;
    },

    /** Forgets the AIMD state and zeroes the counters (the bench resets between runs). */
    reset() {
      reducedTo = null;
      granted = 0;
      cutBacks = 0;
      peakWaiting = 0;
      queueMsMax = 0;
      queueMsTotal = 0;
    },

    stats() {
      const cap = effectiveCap();
      return { name, max: configuredMax, effective: Number.isFinite(cap) ? cap : 0, inflight, waiting, granted, cut_backs: cutBacks, peak_waiting: peakWaiting, queue_ms_max: Math.round(queueMsMax), queue_ms_total: Math.round(queueMsTotal) };
    },
  };
  return limiter;
}

// ---------------------------------------------------------------------------------------------
// Registry: one limiter per provider for the whole process

const registry = new Map();
let registryLogger = null;

/** Limiter key of a provider name: Groq (text and speech) share the Groq organization, the rest have their own. */
export function limiterKeyFor(providerName) {
  if (providerName === 'anthropic') return 'anthropic';
  if (providerName === 'groq' || providerName === 'groq-speech') return 'groq';
  return providerName;
}

/** The limit a provider name gets from a set of limits (`{anthropic, groq, openaiCompatible}`). */
export function maxFor(providerName, limits = PROVIDER_LIMIT_DEFAULTS) {
  const key = limiterKeyFor(providerName);
  if (key === 'anthropic') return limits.anthropic;
  if (key === 'groq') return limits.groq;
  return limits.openaiCompatible;
}

/**
 * The shared limiter of a provider. The first call creates it; later calls with `limits` update its cap, so a change of
 * knob reaches the limiter that the running jobs already share.
 */
export function limiterFor(providerName, limits) {
  const key = limiterKeyFor(providerName);
  let limiter = registry.get(key);
  const settings = { max: maxFor(providerName, limits), cooldownMs: limits?.cooldownMs, restoreStepMs: limits?.restoreStepMs };
  if (!limiter) {
    limiter = createLimiter({ name: key, max: settings.max, cooldownMs: settings.cooldownMs, restoreStepMs: settings.restoreStepMs, logger: registryLogger });
    registry.set(key, limiter);
  } else if (limits) {
    limiter.configure(settings);
  }
  return limiter;
}

/** Where the cap reductions are logged (the worker passes its logger). */
export function setLimiterLogger(logger) {
  registryLogger = logger;
  for (const limiter of registry.values()) limiter.setLogger(logger);
}

/** Stats of every limiter of the process. */
export function limiterStats() {
  return [...registry.values()].map((l) => l.stats());
}

/** Drops the AIMD state of every limiter (the bench resets between runs). */
export function resetLimiters() {
  for (const limiter of registry.values()) limiter.reset();
}

// Gauges of in-flight and waiting requests per provider. Without a MeterProvider registered the meter is a no-op.
const meter = metrics.getMeter('team-platform');
const inflightGauge = meter.createObservableGauge('team.provider.inflight', { description: 'Provider requests in flight' });
const waitingGauge = meter.createObservableGauge('team.provider.waiting', { description: 'Provider requests waiting for a slot' });
inflightGauge.addCallback((result) => {
  for (const s of limiterStats()) result.observe(s.inflight, { 'team.provider': s.name });
});
waitingGauge.addCallback((result) => {
  for (const s of limiterStats()) result.observe(s.waiting, { 'team.provider': s.name });
});
