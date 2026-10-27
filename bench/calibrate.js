// Calibration of two analyzer knobs from the result files of the bench (TASK-015). No provider is called: it reads what a run already recorded.
//   - `charsPerToken` (src/analyze/config.js): the real input tokens of the classification call against the tokens the analyzer estimated for the
//     same units, by least squares. The call also carries the instructions, the team and the areas, which do not depend on the units, so they
//     land in the intercept. The estimate is units chars / charsPerToken, hence real tokens ≈ intercept + slope × estimate and the characters per
//     token that the model counts are `charsPerToken / slope`.
//   - `maxTokens` (src/analyze/config.js): the distribution of the output tokens per call, by step and effort, with the calls that
//     reached the cap of their own request. A value measured under another effort or thinking setting does not describe the current one: the groups say which one it was.
// Percentiles by nearest rank (the smallest value with at least p of the sample at or below it).

/** @param {number[]} values @param {number} p between 0 and 1 */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

/** Every run of every case of a result file written by `bench/run-private.mjs`. */
export function* runsOf(result) {
  for (const testCase of result?.cases ?? []) {
    for (const run of testCase.runs ?? []) yield { caseId: testCase.case_id ?? testCase.summary?.case_id ?? '?', run };
  }
}

/** Least squares of y on x. Returns null with fewer than two distinct x. */
export function linearFit(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((a, [x]) => a + x, 0) / n;
  const my = points.reduce((a, [, y]) => a + y, 0) / n;
  const sxx = points.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = points.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / sxx;
  const intercept = my - slope * mx;
  const ssTotal = points.reduce((a, [, y]) => a + (y - my) ** 2, 0);
  const ssResidual = points.reduce((a, [x, y]) => a + (y - (intercept + slope * x)) ** 2, 0);
  return { n, slope, intercept, r2: ssTotal === 0 ? 1 : 1 - ssResidual / ssTotal };
}

/**
 * Real input tokens of the first classification call against the estimate of the run, per model, for the runs that classified in one chunk.
 * @param {object[]} results parsed result files
 * @param {{ charsPerToken: number }} used the value of `charsPerToken` the runs were made with
 */
export function charsPerTokenFit(results, { charsPerToken }) {
  const byModel = new Map();
  for (const result of results) {
    for (const { run } of runsOf(result)) {
      const stats = run.stats ?? {};
      if (stats.classification_chunks !== 1 || stats.partitioned || !Number.isFinite(stats.estimated_input_tokens)) continue;
      const call = (run.calls ?? []).find((c) => c.step === 'classify' && c.usage);
      if (!call) continue;
      const u = call.usage;
      const real = (u.input_tokens ?? 0) + (u.cached_tokens ?? 0) + (u.cache_creation_tokens ?? 0);
      if (!byModel.has(call.model)) byModel.set(call.model, []);
      byModel.get(call.model).push([stats.estimated_input_tokens, real]);
    }
  }
  return [...byModel].map(([model, points]) => {
    const fit = linearFit(points);
    return {
      model,
      n: points.length,
      estimateRange: [Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0]))],
      ...(fit ?? {}),
      measuredCharsPerToken: fit && fit.slope > 0 ? charsPerToken / fit.slope : null,
    };
  });
}

/** Output tokens per text call, grouped by step (without the `[chunk]` suffix), model and effort. */
export function outputByStep(results) {
  const groups = new Map();
  for (const result of results) {
    for (const { run } of runsOf(result)) {
      for (const call of run.calls ?? []) {
        if (call.modality !== 'text' || !call.usage || !Number.isFinite(call.usage.output_tokens)) continue;
        const key = `${String(call.step).replace(/\[.*$/, '')}|${call.model}|${call.effort ?? '-'}`;
        if (!groups.has(key)) groups.set(key, { step: key.split('|')[0], model: call.model, effort: call.effort ?? '-', values: [], caps: [], atCap: 0 });
        const group = groups.get(key);
        group.values.push(call.usage.output_tokens);
        if (Number.isFinite(call.max_tokens)) {
          group.caps.push(call.max_tokens);
          // A call that was cut at the cap of its own request (a retry doubles the cap, so each call is compared with its own).
          if (call.usage.output_tokens >= call.max_tokens) group.atCap += 1;
        }
      }
    }
  }
  return [...groups.values()].map((g) => {
    const cap = g.caps.length ? Math.max(...g.caps) : null;
    return {
      step: g.step, model: g.model, effort: g.effort, n: g.values.length,
      p50: percentile(g.values, 0.5), p95: percentile(g.values, 0.95), p99: percentile(g.values, 0.99), max: Math.max(...g.values),
      cap, atCap: cap === null ? null : g.atCap,
    };
  }).sort((a, b) => b.n - a.n);
}
