// `api` analyzer (MASTER-SPEC §7.5, variant A): own loop with structured output.
//
//   1. number the units of the extracted input
//   2. call 1: classify into groups {area_id, template_id, unit_ids} plus `discarded` (effort `low`)
//   3. call 2, one per group and in parallel: decompose with the body of the group's template (effort
//      `medium`), requiring `unit_ids` and `discarded`
//   4. overlaps and gaps by sets (per group, and at the end over the union of all); a single rescue pass
//      per group with a conflict
//   5. if the input or a group exceeds the threshold: split only at structural boundaries, process the
//      chunks in parallel and reduce deterministically by `unit_ids`
//   6. validation with our own Ajv; one retry with the error as context
//
// Domain results are not thrown: a `refusal`, a cut by `max_tokens` and an invalid output are job
// states and come back as `status` (see index.js). What is thrown is an operation failure (network, key,
// timeout), with the calls already made in `error.calls`.
import {
  ProviderMaxTokensError, ProviderOutputError, ProviderRefusalError,
} from '../providers/errors.js';
import { withSpan } from '../telemetry/api.js';
import { AnalyzeInputError } from './errors.js';
import {
  chunkNote, classifySystem, classifyUser, decomposeSystem, decomposeUser, membersBlock, rescueUser, resolveLanguage, retryUser,
} from './prompts.js';
import { buildClassificationSchema, buildDecompositionSchema } from './schema.js';
import { parseTemplate } from './templates.js';
import { estimateTokens, numberUnits, partitionUnits, renderUnits } from './units.js';
import {
  contextFromBundle, coverage, describeConflicts, normalizeDecomposition, validateClassification, validateDecomposition, validateProposal,
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

/** One call to the text provider, recorded for llm_calls. */
async function callText(ctx, step, { system, messages, schema, effort, maxTokens, thinking }) {
  const provider = ctx.providers.text;
  const systemTokens = estimateTokens([].concat(system ?? []).join('\n'), ctx.config.charsPerToken);
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
  };
  ctx.calls.push(entry);
  try {
    const out = await provider.complete({ system, messages, schema, effort, maxTokens, cacheTtl: ctx.config.cacheTtl, ...(thinking ? { thinking } : {}) });
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
    const kind = typedKind(err);
    if (kind) return { ok: false, kind, error: err };
    err.calls = ctx.calls;
    throw err;
  }
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
    messages: [{ role: 'user', content: decomposeUser({ members: bundle.members ?? [], attachments: bundle.attachments ?? [], units, scopeNote, language: ctx.language }) }],
    validate: (json) => validateDecomposition(json, vctx),
  });
  if (first.status !== 'ok') return first;

  let { messages } = first.json;
  let discarded = [];
  let { overlaps, gaps } = first.conflicts;
  if (overlaps.length === 0 && gaps.length === 0) return { status: 'ok', messages, discarded, rescued: false };

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

  ctx.report(`corrigiendo ${coverageIds.length} unidades en conflicto`);
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
    return { status: 'invalid', step: `rescue${label}`, reason: 'mece_conflict', errors: describeConflicts(remaining), draft: { messages, discarded } };
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

/**
 * @param {object} bundle  see MASTER-SPEC §7.5; the templates also carry `body_markdown`
 * @param {{providers: object, onProgress?: Function, config: object}} opts  `config` already resolved
 */
export async function analyzeWithApi(bundle, { providers, onProgress, config }) {
  checkBundle(bundle);
  const units = numberUnits(bundle);
  if (units.length === 0) throw new AnalyzeInputError('El input no tiene texto ni adjuntos con texto extraído');
  const language = resolveLanguage(bundle.language);
  const ctx = createContext({ providers, config, onProgress, unitCount: units.length, language });
  const profile = providers.text.schemaProfile ?? 'anthropic';
  const attachments = bundle.attachments ?? [];
  const members = bundle.members ?? [];
  const { areas, templates } = bundle;
  const allIds = units.map((u) => u.id);
  const fail = (r) => ({ status: r.status, step: r.step, category: r.category, explanation: r.explanation, reason: r.reason, errors: r.errors ?? [], max_tokens: r.max_tokens, draft: r.draft, units, calls: ctx.calls, stats: ctx.stats });

  // -- Call 1: classify into groups by area and template -------------------------------------
  // An input can bring a bug, an idea and a question: each group carries its area and its template
  // (idea.md: «one or several messages that group the work into categories»). If the input does not fit
  // in one call it is classified in disjoint structural chunks and the groups are joined.
  ctx.report('clasificando el input');
  const cSystem = classifySystem({ areas, templates, language });
  const fixedClassify = estimateTokens([...cSystem, membersBlock([], language)].join('\n'), config.charsPerToken);
  const classifyChunks = partitionUnits(units, { budgetTokens: config.partitionThresholdTokens - fixedClassify, charsPerToken: config.charsPerToken });
  ctx.stats.classification_chunks = classifyChunks.length;
  ctx.progress.total = classifyChunks.length + 2;
  const cSchema = buildClassificationSchema({ areas, templates });
  const classifyTasks = classifyChunks.map((chunkUnits, index) => async () => {
    const scope = new Set(chunkUnits.map((u) => u.id));
    const r = await structuredStep(ctx, {
      step: classifyChunks.length > 1 ? `classify#${index + 1}` : 'classify',
      system: cSystem,
      messages: [{ role: 'user', content: classifyUser({ units: chunkUnits, attachments, language }) }],
      schema: cSchema,
      effort: config.classifyEffort,
      thinking: config.classifyThinking ?? undefined,
      validate: (json) => validateClassification(json, { areas, templates, scope }),
    });
    if (r.status === 'ok') ctx.report('input clasificado', { advance: true });
    return r;
  });
  const classified = await withSpan('classify', { 'team.step': 'classify', 'team.units': units.length, 'team.chunks': classifyChunks.length }, async (span) => {
    const results = await runPool(classifyTasks, config.partitionConcurrency);
    span.setAttribute('team.groups', results.reduce((n, r) => n + (r?.json?.groups?.length ?? 0), 0));
    return results;
  });
  const badClass = classified.find((r) => r && r.status !== 'ok');
  if (badClass) return fail(badClass);
  const groups = classified.flatMap((r) => r.json.groups);
  const classDiscarded = classified.flatMap((r) => r.json.discarded);
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
    const system = decomposeSystem(template, language);
    const entry = {
      template,
      system,
      schema: buildDecompositionSchema(template.fields, { profile, withDiscarded: false }),
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
  ctx.report(work.length > 1 ? `descomponiendo ${work.length} grupos` : 'descomponiendo el input');

  const tasks = work.map((w) => () => withSpan('decompose', {
    'team.step': 'decompose',
    'team.group_index': w.gi,
    'team.area_id': w.group.area_id,
    'team.template_id': w.group.template_id,
    'team.units': w.units.length,
  }, async (span) => {
    const scopeNote = w.parts > 1 ? chunkNote({ index: w.pi, total: w.parts, first: w.units[0].id, last: w.units.at(-1).id, language }) : undefined;
    const label = `[t${w.group.template_id}]${w.parts > 1 ? `#${w.pi + 1}` : ''}`;
    const r = await decomposeUnits(ctx, { bundle, template: w.entry.template, system: w.entry.system, schema: w.entry.schema, units: w.units, scopeNote, label });
    span.setAttributes({ 'team.status': r.status, 'team.rescued': r.rescued === true });
    if (r.status === 'ok') ctx.report('grupo descompuesto', { advance: true });
    return r.status === 'ok' ? { ...r, group: w.group } : r;
  }));
  const results = await runPool(tasks, config.partitionConcurrency);
  const bad = results.find((r) => r && r.status !== 'ok');
  if (bad) return fail(bad);

  // -- Deterministic reduction by unit_ids ---------------------------------------------------
  // Groups are disjoint by unit: the reduction is a concatenation, with no call (report 02 §3.3).
  ctx.report('validando la propuesta');
  const merged = {
    messages: results.flatMap((r) => r.messages.map((m) => ({ ...m, area_id: r.group.area_id, template_id: r.group.template_id }))),
    discarded: [...classDiscarded, ...results.flatMap((r) => r.discarded)],
  };
  const fieldsByTemplate = new Map([...prepared].map(([id, e]) => [id, e.template.fields]));
  const finalCheck = validateSpan('reduce', () => validateProposal(merged, {
    templates,
    fieldsByTemplate,
    scope: new Set(allIds),
    memberIds: new Set(members.map((m) => m.id)),
    attachmentIds: new Set(attachments.map((a) => a.id)),
  }));
  if (finalCheck.errors.length > 0 || finalCheck.conflicts.overlaps.length > 0 || finalCheck.conflicts.gaps.length > 0) {
    return fail({ status: 'invalid', step: 'reduce', reason: 'mece_conflict', errors: [...finalCheck.errors, ...describeConflicts(finalCheck.conflicts)], draft: merged });
  }
  const { messages, discarded } = normalizeDecomposition(merged);
  ctx.report('propuesta lista', { advance: true });
  return { status: 'ok', proposal: { messages, discarded }, units, calls: ctx.calls, stats: ctx.stats };
}

/**
 * Warms up, by event, the schema and the prompt of a template (report 02 §7 and §10.2: the grammar is
 * cached for 24 hours since the last use; it is called when saving or editing a template, no clock).
 * @returns {Promise<object>} the llm_calls entry of the warm-up call
 */
export async function warmTemplate({ providers, config, templateMarkdown, language }) {
  const template = parseTemplate(templateMarkdown, { source: 'warm-up' });
  const ctx = createContext({ providers, config, unitCount: 0, language: resolveLanguage(language) });
  const profile = providers.text.schemaProfile ?? 'anthropic';
  const r = await callText(ctx, 'warmup', {
    system: decomposeSystem(template, language),
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
export async function warmCatalog({ providers, config, areas, templates, language }) {
  const ctx = createContext({ providers, config, unitCount: 0, language: resolveLanguage(language) });
  const r = await callText(ctx, 'warmup-classify', {
    system: classifySystem({ areas, templates, language }),
    messages: [{ role: 'user', content: 'Catalog warm-up. Return empty groups and discarded arrays.' }],
    schema: buildClassificationSchema({ areas, templates }),
    effort: config.classifyEffort,
    maxTokens: config.maxTokens,
  });
  return { ...ctx.calls[0], ok: r.ok };
}
