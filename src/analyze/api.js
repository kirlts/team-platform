// `api` analyzer (MASTER-SPEC §7.5, variant A): own loop with structured output.
//
//   1. number the units of the extracted input
//   2. call 1: classify into groups {area_id, template_id, unit_ids} plus `discarded` (effort `low`, no thinking)
//   2b. second reading (UD-021): if no group came out, read again with a deeper prompt, section by section; for an input
//       that is only images, the images are described again in more detail first. «Zero messages» is accepted after it
//   3. call 2, one per group and in parallel: decompose with the body of the group's template (effort `low`, no
//      thinking); one message per group unless it holds two independent points. Nothing is discarded in this call
//   4. overlaps and gaps by sets (per group, and at the end over the union of all); a single rescue pass
//      per group with a conflict
//   5. if the input or a group exceeds the threshold: split only at structural boundaries, process the
//      chunks in parallel and reduce deterministically by `unit_ids`
//   6. validation with our own Ajv; one retry with the error as context
//
// A refusal or a retryable HTTP failure of the text provider is repeated once on `providers.textFallback`, when one is
// configured (H-18); the fallback call is in `calls` with `fallback: true` and under the span `analyze.fallback`.
//
// Domain results are not thrown: a `refusal`, a cut by `max_tokens` and an invalid output are job
// states and come back as `status` (see index.js). What is thrown is an operation failure (network, key,
// timeout), with the calls already made in `error.calls`.
import {
  ProviderHttpError, ProviderMaxTokensError, ProviderOutputError, ProviderRefusalError,
} from '../providers/errors.js';
import { withSpan } from '../telemetry/api.js';
import { consensus } from './consensus.js';
import { AnalyzeInputError } from './errors.js';
import {
  chunkNote, classifySystem, classifyUser, decomposeSystem, decomposeUser, membersBlock, rescueUser, resolveLanguage, retryUser,
} from './prompts.js';
import { buildClassificationSchema, buildDecompositionSchema } from './schema.js';
import { parseTemplate } from './templates.js';
import { estimateTokens, isEmptyUnit, numberUnits, partitionUnits, renderUnits } from './units.js';
import {
  closeEmptyGaps, closeStretches, contextFromBundle, foldEmptyGroups, foldEmptyMessages, coverage, describeConflicts, normalizeDecomposition, repairClassification, repairCoverage, validateClassification, validateDecomposition, validateProposal,
} from './validate.js';

const TYPED = new Map([
  [ProviderRefusalError, 'refusal'],
  [ProviderMaxTokensError, 'max_tokens'],
  [ProviderOutputError, 'invalid_output'],
]);

function typedKind(err) {
  for (const [cls, kind] of TYPED) if (err instanceof cls) return kind;
  return null;
}

/** Execution context shared by the steps of an analysis. */
function createContext({ providers, config, onProgress, unitCount, language }) {
  const ctx = {
    providers,
    config,
    calls: [],
    stats: { chunks: 1, groups: 0, classification_chunks: 1, rescues: 0, invalid_retries: 0, max_tokens_retries: 0, partitioned: false, units: unitCount },
    language,
    stopped: false,
    progress: { done: 0, total: 3, last: 0 },
    onProgress,
  };
  ctx.report = (phrase, { advance = false, total } = {}) => {
    if (total !== undefined) ctx.progress.total = total;
    if (advance) ctx.progress.done += 1;
    // The percentage comes from completed steps over total steps, never from a clock (§7.10); it does not go back.
    const pct = Math.min(100, Math.round((100 * ctx.progress.done) / ctx.progress.total));
    ctx.progress.last = Math.max(ctx.progress.last, pct);
    ctx.onProgress?.({ percent: ctx.progress.last, phrase });
  };
  return ctx;
}

/** A configured fallback provider, not the placeholder of an unavailable slot (H-18). */
function usableFallback(providers) {
  const fallback = providers.textFallback;
  return fallback && typeof fallback.complete === 'function' && !fallback.unavailable ? fallback : null;
}

/** What the fallback covers: a refusal, or a retryable HTTP failure that the provider's own retries did not fix. */
function fallbackApplies(err) {
  return err instanceof ProviderRefusalError || (err instanceof ProviderHttpError && err.retryable === true);
}

/** One call to the text provider, recorded for llm_calls. After a refusal or a retryable HTTP failure it is repeated once on the fallback. */
async function callText(ctx, step, { system, messages, schema, effort, maxTokens, thinking }) {
  const request = { system, messages, schema, effort, maxTokens, cacheTtl: ctx.config.cacheTtl, ...(thinking ? { thinking } : {}) };
  const systemTokens = estimateTokens([].concat(system ?? []).join('\n'), ctx.config.charsPerToken);
  const newEntry = (provider, fallback) => {
    const entry = {
      step,
      modality: 'text',
      provider: provider.name,
      model: provider.model,
      effort,
      thinking: thinking ?? null,
      max_tokens: maxTokens,
      // If the system prompt does not reach the cacheable minimum it is not cached and the cache read will be zero (report 02 §7).
      cacheable: systemTokens >= ctx.config.minCacheableSystemTokens,
      usage: null,
      duration_ms: null,
      outcome: 'ok',
      ...(fallback ? { fallback: true } : {}),
    };
    ctx.calls.push(entry);
    return entry;
  };
  const attempt = async (provider, entry) => {
    try {
      const out = await provider.complete(request);
      Object.assign(entry, { provider: out.provider ?? entry.provider, model: out.model ?? entry.model, usage: out.usage ?? null, duration_ms: out.duration_ms ?? null });
      return { ok: true, out };
    } catch (err) {
      Object.assign(entry, {
        provider: err.provider ?? entry.provider,
        model: err.model ?? entry.model,
        usage: err.usage ?? null,
        duration_ms: err.duration_ms ?? null,
        outcome: err.code ?? 'error',
      });
      return { ok: false, err };
    }
  };

  let result = await attempt(ctx.providers.text, newEntry(ctx.providers.text, false));
  // A retryable HTTP failure (429, 5xx, network) is repeated on the same provider after the wait it asks for.
  for (let retry = 0; !result.ok && result.err instanceof ProviderHttpError && result.err.retryable && retry < ctx.config.httpRetries; retry += 1) {
    const wait = result.err.retryAfterMs ?? ctx.config.httpRetryBaseMs * 2 ** retry; // declared courtesy: doubling wait when the provider sends no retry-after
    await new Promise((resolve) => { setTimeout(resolve, wait); });
    ctx.stats.http_retries = (ctx.stats.http_retries ?? 0) + 1;
    result = await attempt(ctx.providers.text, newEntry(ctx.providers.text, false));
  }
  const fallback = usableFallback(ctx.providers);
  if (!result.ok && fallback && fallbackApplies(result.err)) {
    ctx.stats.fallbacks = (ctx.stats.fallbacks ?? 0) + 1;
    result = await withSpan('analyze.fallback', { 'team.step': step, 'team.fallback': true, 'team.fallback_reason': result.err.code }, () => attempt(fallback, newEntry(fallback, true)));
  }
  if (result.ok) return result;
  const kind = typedKind(result.err);
  if (kind) return { ok: false, kind, error: result.err };
  result.err.calls = ctx.calls;
  throw result.err;
}

function withErrorContext(messages, raw, errors, language) {
  const feedback = retryUser(errors, language);
  if (raw) return [...messages, { role: 'assistant', content: raw }, { role: 'user', content: feedback }];
  const last = messages.at(-1);
  const lastText = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
  return [...messages.slice(0, -1), { role: 'user', content: `${lastText}\n\n${feedback}` }];
}

/** A `validate` span around a validation: how many errors and which ones (up to ten). */
function validateSpan(step, fn) {
  return withSpan('validate', { 'team.step': 'validate', 'team.validated_step': step }, (span) => {
    const v = fn();
    const conflicts = (v.conflicts?.overlaps?.length ?? 0) + (v.conflicts?.gaps?.length ?? 0);
    span.setAttributes({ 'team.valid': v.errors.length === 0 && conflicts === 0, 'team.error_count': v.errors.length, 'team.conflicts': conflicts });
    if (v.errors.length > 0) span.setAttribute('team.errors', v.errors.slice(0, 10).map((e) => String(e).slice(0, 300)));
    return v;
  });
}

/**
 * A structured call with its recovery:
 *  - `refusal`: not retried the same way (report 02 [F4]); comes back as a state.
 *  - `max_tokens`: one retry with double (MASTER-SPEC §7.5); a second cut comes back as a state.
 *  - invalid output: one retry with the error as context; then, state `invalid`.
 * `validate(json)` returns `{ errors: string[], ...rest }`.
 */
async function structuredStep(ctx, { step, system, messages, schema, effort, thinking, validate }) {
  const { config } = ctx;
  let maxTokens = config.maxTokens;
  let cutRetried = false;
  let invalidRetries = 0;
  let current = messages;
  for (;;) {
    const r = await callText(ctx, step, { system, messages: current, schema, effort, maxTokens, thinking });
    let errors;
    let raw;
    let rest = {};
    if (!r.ok) {
      if (r.kind === 'refusal') {
        return { status: 'refusal', step, category: r.error.category ?? null, explanation: r.error.explanation ?? null, errors: [] };
      }
      if (r.kind === 'max_tokens') {
        if (!cutRetried) {
          cutRetried = true;
          ctx.stats.max_tokens_retries += 1;
          maxTokens = config.maxTokensRetry;
          continue;
        }
        return { status: 'max_tokens', step, max_tokens: maxTokens, errors: [] };
      }
      errors = [r.error.message, ...(r.error.errors ?? [])];
      raw = r.error.raw;
    } else {
      const v = validateSpan(step, () => validate(r.out.json));
      if (v.errors.length === 0) return { status: 'ok', json: r.out.json, ...v };
      ({ errors, ...rest } = v);
      raw = JSON.stringify(r.out.json);
    }
    if (invalidRetries >= config.invalidOutputRetries) return { status: 'invalid', step, errors, ...rest };
    invalidRetries += 1;
    ctx.stats.invalid_retries += 1;
    current = withErrorContext(messages, raw, errors, ctx.language);
  }
}

/** Decomposes a set of units (the whole input or a chunk) with recovery and a single rescue. */
async function decomposeUnits(ctx, { bundle, template, system, schema, units, scopeNote, label }) {
  const { config } = ctx;
  const scope = new Set(units.map((u) => u.id));
  const vctx = { ...contextFromBundle(bundle, { fields: template.fields, scope }), requireMessage: true, withDiscarded: false };
  const base = {
    system,
    schema,
    effort: config.decomposeEffort,
    thinking: config.decomposeThinking ?? undefined,
  };
  const first = await structuredStep(ctx, {
    ...base,
    step: `decompose${label}`,
    messages: [{ role: 'user', content: decomposeUser({ members: bundle.members ?? [], attachments: bundle.attachments ?? [], units, scopeNote, language: ctx.language, recent: bundle.recent_inputs }) }],
    validate: (json) => validateDecomposition(json, vctx),
  });
  if (first.status !== 'ok') return first;

  let { messages } = first.json;
  let discarded = [];
  let { overlaps, gaps } = first.conflicts;
  if (overlaps.length === 0 && gaps.length === 0) return { status: 'ok', messages, discarded, rescued: false };
  // H-1902: gaps made only of speaker marks and list numbers are closed by set arithmetic; the rescue would write a message about them.
  const emptyOf = new Set(units.filter((u) => isEmptyUnit(u.text)).map((u) => u.id));
  if (overlaps.length === 0 && gaps.every((id) => emptyOf.has(id))) {
    ctx.stats.empty_gaps_closed = (ctx.stats.empty_gaps_closed ?? 0) + gaps.length;
    return { status: 'ok', messages: closeEmptyGaps(messages, gaps, scope), discarded, rescued: false };
  }

  // Mutual-exclusivity or exhaustiveness conflict: a single rescue pass over what failed.
  if (config.rescuePasses < 1) {
    return { status: 'invalid', step: `decompose${label}`, reason: 'mece_conflict', errors: describeConflicts(first.conflicts), draft: first.json };
  }
  ctx.stats.rescues += 1;
  const overlapUnits = new Set(overlaps.map((o) => o.unit_id));
  const involvedIdx = messages.map((m, i) => (m.unit_ids.some((id) => overlapUnits.has(id)) ? i : -1)).filter((i) => i >= 0);
  const involved = involvedIdx.map((i) => messages[i]);
  const coverageSet = new Set([...overlapUnits, ...gaps]);
  for (const m of involved) m.unit_ids.forEach((id) => coverageSet.add(id));
  const keptMessages = messages.filter((_, i) => !involvedIdx.includes(i));
  const keptDiscarded = discarded
    .map((d) => ({ ...d, unit_ids: d.unit_ids.filter((id) => !coverageSet.has(id)) }))
    .filter((d) => d.unit_ids.length > 0);
  const coverageIds = [...coverageSet].sort((a, b) => a - b);

  ctx.report(`Corrección: ${coverageIds.length} unidades en conflicto`);
  const rescueCtx = { ...contextFromBundle(bundle, { fields: template.fields, scope: coverageSet }), withDiscarded: false };
  const rescue = await withSpan('rescue', { 'team.step': 'rescue', 'team.units': coverageIds.length, 'team.overlaps': overlaps.length, 'team.gaps': gaps.length }, () => structuredStep(ctx, {
    ...base,
    step: `rescue${label}`,
    messages: [{
      role: 'user',
      content: rescueUser({
        language: ctx.language,
        members: bundle.members ?? [],
        attachments: bundle.attachments ?? [],
        units,
        coverageIds,
        involved: involved.map((m) => ({ title: m.title, unit_ids: m.unit_ids, fields: m.fields, body: m.body })),
        overlaps,
        gaps,
      }),
    }],
    validate: (json) => validateDecomposition(json, rescueCtx),
  }));
  if (rescue.status !== 'ok') return rescue;

  messages = [...keptMessages, ...rescue.json.messages];
  discarded = keptDiscarded;
  const remaining = rescue.conflicts.overlaps.length > 0 || rescue.conflicts.gaps.length > 0 ? rescue.conflicts : coverage(messages, discarded, scope);
  if (remaining.overlaps.length > 0 || remaining.gaps.length > 0) {
    // The rescue pass was the only model turn the conflict gets; what is left is bookkeeping and is repaired by set arithmetic.
    const repaired = repairCoverage(messages, discarded, scope);
    if (!repaired) return { status: 'invalid', step: `rescue${label}`, reason: 'mece_conflict', errors: describeConflicts(remaining), draft: { messages, discarded } };
    ctx.stats.repaired = (ctx.stats.repaired ?? 0) + 1;
    return { status: 'ok', messages: repaired.messages, discarded: repaired.discarded, rescued: true, repaired: true };
  }
  return { status: 'ok', messages, discarded, rescued: true };
}

/** Runs `tasks` with at most `limit` at a time; stops starting new ones if one returns a state other than `ok`. */
async function runPool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < tasks.length) {
      const i = next;
      next += 1;
      results[i] = await tasks[i]();
      if (results[i].status !== 'ok') failed = true;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function checkBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') throw new AnalyzeInputError('El bundle es obligatorio');
  if (!Array.isArray(bundle.areas) || bundle.areas.length === 0) throw new AnalyzeInputError('El bundle no trae áreas');
  if (!Array.isArray(bundle.templates) || bundle.templates.length === 0) throw new AnalyzeInputError('El bundle no trae plantillas');
}

/** Splits each chunk in `chunks` into contiguous windows of about `size` units or fewer, of equal size within the chunk. */
function windowsOf(chunks, size) {
  return chunks.flatMap((chunk) => {
    const count = Math.ceil(chunk.length / size);
    if (count <= 1) return [chunk];
    const each = Math.ceil(chunk.length / count);
    return Array.from({ length: count }, (_, i) => chunk.slice(i * each, (i + 1) * each));
  });
}

/** Sections of the units for the second reading: by heading, and no more than `size` units each. */
function sectionsOf(units, size) {
  const sections = [];
  for (const u of units) {
    const last = sections.at(-1);
    if (last && last[0].sourceIndex === u.sourceIndex && last[0].section === u.section && last.length < size) last.push(u);
    else sections.push([u]);
  }
  return sections;
}

/** An input whose only content is images: no text of the person and no attachment other than images with extracted text. */
function isImageOnly(bundle) {
  if (typeof bundle.text === 'string' && bundle.text.trim() !== '') return false;
  const withText = (bundle.attachments ?? []).filter((a) => typeof a.extracted === 'string' && a.extracted.trim() !== '');
  return withText.length > 0 && withText.every((a) => a.kind === 'image');
}

/**
 * Stage 1 of the analysis, reusable on its own by the bench (H-1900): numbers the units and classifies them into groups and
 * discards, with the second reading (UD-021), the closing of stretches and the coverage pass over what was discarded.
 * @param {object} bundle  see MASTER-SPEC §7.5
 * @param {{providers: object, onProgress?: Function, config: object, redescribe?: Function}} opts  `config` already resolved.
 * @returns {Promise<{ctx: object, language: string, units: object[], workBundle: object, attachments: object[], classifyChunks: object[][], groups: object[], discarded: object[]} | {ctx: object, units: object[], failed: object}>}
 */
export async function classifyInput(bundle, { providers, onProgress, config, redescribe }) {
  checkBundle(bundle);
  let workBundle = bundle; // the second pass may replace the text of the images
  let units = numberUnits(workBundle);
  if (units.length === 0) throw new AnalyzeInputError('El input no tiene texto ni adjuntos con texto extraído');
  const language = resolveLanguage(bundle.language);
  const ctx = createContext({ providers, config, onProgress, unitCount: units.length, language });
  let attachments = workBundle.attachments ?? [];
  const { areas, templates, project } = bundle;

  // -- Call 1: classify into groups by area and template -------------------------------------
  // An input can bring a bug, an idea and a question: each group carries its area and its template
  // (idea.md: «one or several messages that group the work into categories»). If the input does not fit
  // in one call it is classified in disjoint structural chunks and the groups are joined.
  ctx.report('Clasificación');
  const cSystem = classifySystem({ areas, templates, project, language });
  const fixedClassify = estimateTokens([...cSystem, membersBlock([], language)].join('\n'), config.charsPerToken);
  const cSchema = buildClassificationSchema({ areas, templates });

  /** Classifies `list` in structural chunks (or, in the second reading, the given sections) and joins the groups. */
  const classifyUnits = async (list, { secondPass = false, coverage = false, chunks } = {}) => {
    const classifyChunks = chunks ?? windowsOf(partitionUnits(list, { budgetTokens: config.partitionThresholdTokens - fixedClassify, charsPerToken: config.charsPerToken }), config.classifyWindowUnits);
    if (!secondPass && !coverage) {
      ctx.stats.classification_chunks = classifyChunks.length;
      ctx.progress.total = classifyChunks.length + 2;
    }
    const tasks = classifyChunks.map((chunkUnits, index) => async () => {
      const scope = new Set(chunkUnits.map((u) => u.id));
      const windowed = classifyChunks.length > 1 && !secondPass && !coverage;
      // H-1900: the units that come right before a window, read-only, so a point that crosses the boundary keeps its area.
      const before = windowed && config.classifyContextUnits > 0 ? units.filter((u) => u.id < chunkUnits[0].id).slice(-config.classifyContextUnits) : [];
      const r = await structuredStep(ctx, {
        step: `${coverage ? 'coverage' : secondPass ? 'classify2' : 'classify'}${classifyChunks.length > 1 ? `#${index + 1}` : ''}`,
        system: cSystem,
        messages: [{ role: 'user', content: classifyUser({ units: chunkUnits, attachments, language, secondPass, coverage, context: before, recent: bundle.recent_inputs, window: windowed ? { index, total: classifyChunks.length, first: chunkUnits[0].id, last: chunkUnits.at(-1).id } : undefined }) }],
        schema: cSchema,
        effort: config.classifyEffort,
        thinking: config.classifyThinking ?? undefined,
        validate: (json) => validateClassification(json, { areas, templates, scope }),
      });
      if (r.status === 'ok' && !secondPass && !coverage) ctx.report('Clasificado', { advance: true });
      return r;
    });
    // What the single retry did not fix (overlaps and gaps only) is closed by set arithmetic instead of failing the whole input.
    const repairable = (r, scope) => {
      if (r.status !== 'invalid' || !r.repairable) return r;
      ctx.stats.classification_repaired = (ctx.stats.classification_repaired ?? 0) + 1;
      return { status: 'ok', json: repairClassification(r.repairable, scope), errors: [], repaired: true };
    };
    const results = await withSpan(coverage ? 'classify.coverage' : secondPass ? 'classify.second_pass' : 'classify', { 'team.step': coverage ? 'coverage' : secondPass ? 'classify2' : 'classify', 'team.units': list.length, 'team.chunks': classifyChunks.length }, async (span) => {
      const out = (await runPool(tasks, config.partitionConcurrency)).map((r, i) => (r ? repairable(r, classifyChunks[i].map((u) => u.id)) : r));
      span.setAttribute('team.groups', out.reduce((n, r) => n + (r?.json?.groups?.length ?? 0), 0));
      return out;
    });
    return { classifyChunks, results };
  };

  // H-1003: with `classifyDraws` above 1 the first reading is drawn several times, in parallel, and the system keeps the draw
  // that agrees most with the others, with each group's area decided by the majority of the draws (set arithmetic only).
  const draws = await Promise.all(Array.from({ length: config.classifyDraws }, () => classifyUnits(units)));
  const badClass = draws.flatMap((d) => d.results).find((r) => r && r.status !== 'ok');
  if (badClass) return { ctx, units, failed: badClass };
  const classifyChunks = draws[0].classifyChunks;
  const agreed = consensus(draws.map((d) => ({ groups: d.results.flatMap((r) => r.json.groups), discarded: d.results.flatMap((r) => r.json.discarded) })), templates);
  let groups = agreed.groups;
  let classDiscarded = agreed.discarded;
  if (config.classifyDraws > 1) ctx.stats.classification_draws = config.classifyDraws;

  // -- Second reading (UD-021): a person does not send something for nothing --------------------
  // «Zero messages» is accepted only after a deeper pass: for images with no text, the images are described again in more
  // detail; for anything else, the input is read again section by section with the instruction that it was sent for a reason.
  if (groups.length === 0) {
    ctx.stats.second_pass = true;
    ctx.report('Segunda lectura');
    const outcome = await withSpan('analyze.second_pass', { 'team.step': 'second_pass', 'team.units': units.length, 'team.image_only': isImageOnly(workBundle) }, async (span) => {
      let described = 0;
      if (isImageOnly(workBundle) && typeof redescribe === 'function') {
        const redone = await Promise.all((workBundle.attachments ?? []).map(async (a) => {
          if (a.kind !== 'image' || typeof a.extracted !== 'string' || a.extracted.trim() === '') return a;
          const text = await redescribe(a);
          if (typeof text !== 'string' || text.trim() === '') return a;
          described += 1;
          return { ...a, extracted: text };
        }));
        workBundle = { ...workBundle, attachments: redone };
        attachments = redone;
        units = numberUnits(workBundle);
      }
      const sections = sectionsOf(units, config.secondPassSectionUnits);
      const second = await classifyUnits(units, { secondPass: true, chunks: sections });
      span.setAttributes({ 'team.redescribed': described, 'team.sections': sections.length, 'team.groups': second.results.reduce((n, r) => n + (r?.json?.groups?.length ?? 0), 0) });
      return second;
    });
    const badSecond = outcome.results.find((r) => r && r.status !== 'ok');
    if (badSecond) return { ctx, units, failed: badSecond };
    groups = outcome.results.flatMap((r) => r.json.groups);
    classDiscarded = outcome.results.flatMap((r) => r.json.discarded);
  }
  // A point is a continuous stretch: what the model discarded between the first and the last unit of a group belongs to it.
  ({ groups, discarded: classDiscarded } = closeStretches(groups, classDiscarded));

  // -- Coverage pass (H-1900): what was discarded is read again, apart from the surrounding talk ---------------------------
  // In a long meeting the first reading discards whole stretches as chatter and takes real points with them. The model decides
  // whether any of those units is a point; the system only validates the form (scope, overlaps, gaps) and closes stretches again.
  for (let pass = 0; pass < config.coveragePasses && classDiscarded.length > 0; pass += 1) {
    const discardedIds = new Set(classDiscarded.flatMap((d) => d.unit_ids));
    const apart = units.filter((u) => discardedIds.has(u.id));
    ctx.report('Revisión de lo apartado');
    const sections = windowsOf([apart], config.classifyWindowUnits);
    const reread = await classifyUnits(apart, { coverage: true, chunks: sections });
    // The pass is an extra look, never a reason to fail the input: a section that did not come back valid keeps its first-reading discards.
    const failedIds = new Set(reread.results.flatMap((r, i) => (r && r.status === 'ok' ? [] : sections[i].map((u) => u.id))));
    const rereadDiscarded = reread.results.flatMap((r) => (r && r.status === 'ok' ? r.json.discarded : []));
    const rereadGroups = reread.results.flatMap((r) => (r && r.status === 'ok' ? r.json.groups : []));
    ctx.stats.coverage_pass = { units: apart.length, regrouped: rereadGroups.reduce((n, g) => n + g.unit_ids.length, 0), failed_sections: reread.results.filter((r) => !r || r.status !== 'ok').length };
    const kept = classDiscarded.map((d) => ({ ...d, unit_ids: d.unit_ids.filter((id) => failedIds.has(id)) })).filter((d) => d.unit_ids.length > 0);
    ({ groups, discarded: classDiscarded } = closeStretches([...groups, ...rereadGroups], [...rereadDiscarded, ...kept]));
  }
  // H-1902: a group of speaker marks alone joins the intervention it introduces; the decomposition never receives it.
  const folding = foldEmptyGroups(groups, classDiscarded, new Set(units.filter((u) => isEmptyUnit(u.text)).map((u) => u.id)), language === 'en' ? 'Mark with no content' : 'Marca sin contenido');
  if (folding.folded > 0) ctx.stats.empty_groups_folded = folding.folded;
  return { ctx, language, units, workBundle, attachments, classifyChunks, groups: folding.groups, discarded: folding.discarded };
}

/**
 * @param {object} bundle  see MASTER-SPEC §7.5; the templates also carry `body_markdown`
 * @param {{providers: object, onProgress?: Function, config: object, redescribe?: Function}} opts  `config` already resolved.
 *   `redescribe(attachment)` returns a more detailed text for an image; the second pass uses it (UD-021).
 */
export async function analyzeWithApi(bundle, { providers, onProgress, config, redescribe }) {
  const stage = await classifyInput(bundle, { providers, onProgress, config, redescribe });
  const { ctx, units } = stage;
  const fail = (r) => ({ status: r.status, step: r.step, category: r.category, explanation: r.explanation, reason: r.reason, errors: r.errors ?? [], max_tokens: r.max_tokens, draft: r.draft, units, calls: ctx.calls, stats: ctx.stats });
  if (stage.failed) return fail(stage.failed);
  const { language, workBundle, attachments, classifyChunks, groups } = stage;
  const classDiscarded = stage.discarded;
  const profile = providers.text.schemaProfile ?? 'anthropic';
  const members = bundle.members ?? [];
  const { areas, templates, project } = bundle;
  const allIds = units.map((u) => u.id);
  ctx.stats.groups = groups.length;

  // -- Call 2: decompose each group with the group's template --------------------------------
  const prepared = new Map(); // template_id -> parsed template, system prompt and schema
  const prepare = (templateId) => {
    if (prepared.has(templateId)) return prepared.get(templateId);
    const row = templates.find((t) => t.id === templateId);
    if (typeof row.body_markdown !== 'string') {
      throw new AnalyzeInputError(`La plantilla ${templateId} no trae «body_markdown»`, { calls: ctx.calls });
    }
    const template = parseTemplate(row.body_markdown, { source: `template ${templateId}` });
    const system = decomposeSystem(template, project, language);
    const entry = {
      template,
      system,
      schema: buildDecompositionSchema(template.fields, { profile, withDiscarded: false, requireAssignee: members.length > 0 && profile === 'anthropic' }),
      fixed: estimateTokens([...system, membersBlock(members, language)].join('\n'), config.charsPerToken),
    };
    prepared.set(templateId, entry);
    return entry;
  };

  const work = []; // one task per group, or per chunk of a group that does not fit
  for (const [gi, group] of groups.entries()) {
    const entry = prepare(group.template_id);
    const ids = new Set(group.unit_ids);
    const groupUnits = units.filter((u) => ids.has(u.id));
    const parts = partitionUnits(groupUnits, { budgetTokens: config.partitionThresholdTokens - entry.fixed, charsPerToken: config.charsPerToken });
    parts.forEach((partUnits, pi) => work.push({ group, entry, gi, pi, parts: parts.length, units: partUnits }));
  }
  ctx.stats.chunks = work.length;
  ctx.stats.partitioned = work.length > groups.length || classifyChunks.length > 1;
  ctx.stats.estimated_input_tokens = estimateTokens(renderUnits(units, language), config.charsPerToken);
  ctx.progress.total = classifyChunks.length + work.length + 1;
  ctx.report(work.length > 1 ? `Descomposición: ${work.length} grupos` : 'Descomposición');

  const tasks = work.map((w) => () => withSpan('decompose', {
    'team.step': 'decompose',
    'team.group_index': w.gi,
    'team.area_id': w.group.area_id,
    'team.template_id': w.group.template_id,
    'team.units': w.units.length,
  }, async (span) => {
    const scopeNote = w.parts > 1 ? chunkNote({ index: w.pi, total: w.parts, first: w.units[0].id, last: w.units.at(-1).id, language }) : undefined;
    const label = `[t${w.group.template_id}]${w.parts > 1 ? `#${w.pi + 1}` : ''}`;
    const r = await decomposeUnits(ctx, { bundle: workBundle, template: w.entry.template, system: w.entry.system, schema: w.entry.schema, units: w.units, scopeNote, label });
    span.setAttributes({ 'team.status': r.status, 'team.rescued': r.rescued === true });
    if (r.status === 'ok') ctx.report('Grupo descompuesto', { advance: true });
    return r.status === 'ok' ? { ...r, group: w.group } : r;
  }));
  const results = await runPool(tasks, config.partitionConcurrency);
  const bad = results.find((r) => r && r.status !== 'ok');
  if (bad) return fail(bad);

  // -- Deterministic reduction by unit_ids ---------------------------------------------------
  // Groups are disjoint by unit: the reduction is a concatenation, with no call (report 02 §3.3).
  ctx.report('Validación de la propuesta');
  const merged = {
    messages: results.flatMap((r) => r.messages.map((m) => ({ ...m, area_id: r.group.area_id, template_id: r.group.template_id }))),
    discarded: [...classDiscarded, ...results.flatMap((r) => r.discarded)],
  };
  // H-1902: a message the rescue wrote about speaker marks alone joins the message of the intervention that follows.
  const folded = foldEmptyMessages(merged.messages, new Set(units.filter((u) => isEmptyUnit(u.text)).map((u) => u.id)));
  if (folded.folded > 0) {
    merged.messages = folded.messages;
    ctx.stats.empty_messages_folded = folded.folded;
  }
  const fieldsByTemplate = new Map([...prepared].map(([id, e]) => [id, e.template.fields]));
  const finalCheck = validateSpan('reduce', () => validateProposal(merged, {
    templates,
    fieldsByTemplate,
    scope: new Set(allIds),
    memberIds: new Set(members.map((m) => m.id)),
    attachmentIds: new Set(attachments.map((a) => a.id)),
  }));
  if (finalCheck.errors.length === 0 && (finalCheck.conflicts.overlaps.length > 0 || finalCheck.conflicts.gaps.length > 0)) {
    // Only bookkeeping is left (a unit cited twice or by nobody across the groups): closed by set arithmetic, as in the rescue.
    const repaired = repairCoverage(merged.messages, merged.discarded, allIds);
    if (repaired) {
      ctx.stats.repaired = (ctx.stats.repaired ?? 0) + 1;
      merged.messages = repaired.messages;
      merged.discarded = repaired.discarded;
      finalCheck.conflicts = coverage(merged.messages, merged.discarded, allIds);
    }
  }
  if (finalCheck.errors.length > 0 || finalCheck.conflicts.overlaps.length > 0 || finalCheck.conflicts.gaps.length > 0) {
    return fail({ status: 'invalid', step: 'reduce', reason: 'mece_conflict', errors: [...finalCheck.errors, ...describeConflicts(finalCheck.conflicts)], draft: merged });
  }
  const { messages, discarded } = normalizeDecomposition(merged);
  // A message born only from images, with no text from the person, is marked as inferred from the image (UD-021): the
  // sender sees it in the preview and can discard it. It is decided by the source of the units, never by the prose.
  if (isImageOnly(workBundle)) {
    const imageUnits = new Set(units.filter((u) => u.source.type === 'attachment' && u.source.kind === 'image').map((u) => u.id));
    for (const m of messages) if (m.unit_ids.every((id) => imageUnits.has(id))) m.source = 'frame';
  }
  ctx.report('Propuesta lista', { advance: true });
  return { status: 'ok', proposal: { messages, discarded }, units, calls: ctx.calls, stats: ctx.stats };
}

/**
 * Warms up, by event, the schema and the prompt of a template (report 02 §7 and §10.2: the grammar is
 * cached for 24 hours since the last use; it is called when saving or editing a template, no clock).
 * @returns {Promise<object>} the llm_calls entry of the warm-up call
 */
export async function warmTemplate({ providers, config, templateMarkdown, project, language }) {
  const template = parseTemplate(templateMarkdown, { source: 'warm-up' });
  const ctx = createContext({ providers, config, unitCount: 0, language: resolveLanguage(language) });
  const profile = providers.text.schemaProfile ?? 'anthropic';
  const r = await callText(ctx, 'warmup', {
    system: decomposeSystem(template, project, language),
    messages: [{ role: 'user', content: 'Template warm-up. Return an empty messages array.' }],
    schema: buildDecompositionSchema(template.fields, { profile, withDiscarded: false }),
    effort: config.classifyEffort,
    maxTokens: config.maxTokens,
  });
  return { ...ctx.calls[0], ok: r.ok };
}

/**
 * Warms up, by event, the schema and the prompt of the classification: they change when the Editor edits
 * areas or templates (the id `enum`s are part of the structure). Same criterion as `warmTemplate`.
 * @returns {Promise<object>} the llm_calls entry of the warm-up call
 */
export async function warmCatalog({ providers, config, areas, templates, project, language }) {
  const ctx = createContext({ providers, config, unitCount: 0, language: resolveLanguage(language) });
  const r = await callText(ctx, 'warmup-classify', {
    system: classifySystem({ areas, templates, project, language }),
    messages: [{ role: 'user', content: 'Catalog warm-up. Return empty groups and discarded arrays.' }],
    schema: buildClassificationSchema({ areas, templates }),
    effort: config.classifyEffort,
    maxTokens: config.maxTokens,
  });
  return { ...ctx.calls[0], ok: r.ok };
}
