// Analizador `api` (MASTER-SPEC §7.5, variante A): bucle propio con salida estructurada.
//
//   1. numerar las unidades del input extraído
//   2. llamada 1: clasificar (área y plantilla; esfuerzo `low`)
//   3. llamada 2: descomponer con el cuerpo de la plantilla (esfuerzo `medium`), exigiendo `unit_ids` y `discarded`
//   4. solapes y huecos por conjuntos; un único pase de rescate sobre el conflicto
//   5. si el input supera el umbral: partir sólo por fronteras estructurales, descomponer en paralelo y
//      reducir de forma determinista por `unit_ids`
//   6. validación con Ajv propio; un reintento con el error como contexto
//
// Los resultados de dominio no se lanzan: un `refusal`, un corte por `max_tokens` y una salida inválida
// son estados del trabajo y vuelven como `status` (ver index.js). Lo que sí se lanza es un fallo de
// operación (red, llave, plazo), con las llamadas ya hechas en `error.calls`.
import {
  ProviderMaxTokensError, ProviderOutputError, ProviderRefusalError,
} from '../providers/errors.js';
import { AnalyzeInputError } from './errors.js';
import {
  chunkNote, classifySystem, classifyUser, decomposeSystem, decomposeUser, membersBlock, rescueUser, retryUser,
} from './prompts.js';
import { buildClassificationSchema, buildDecompositionSchema } from './schema.js';
import { parseTemplate } from './templates.js';
import { estimateTokens, numberUnits, partitionUnits, renderUnits } from './units.js';
import {
  contextFromBundle, coverage, normalizeDecomposition, validateClassification, validateDecomposition,
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

/** Contexto de ejecución compartido por los pasos de un análisis. */
function createContext({ providers, config, onProgress, unitCount }) {
  const ctx = {
    providers,
    config,
    calls: [],
    stats: { chunks: 1, rescues: 0, invalid_retries: 0, max_tokens_retries: 0, partitioned: false, classified_on_partial: false, units: unitCount },
    stopped: false,
    progress: { done: 0, total: 3, last: 0 },
    onProgress,
  };
  ctx.report = (phrase, { advance = false, total } = {}) => {
    if (total !== undefined) ctx.progress.total = total;
    if (advance) ctx.progress.done += 1;
    // El porcentaje sale de pasos completados sobre pasos totales, nunca de un reloj (§7.10); no retrocede.
    const pct = Math.min(100, Math.round((100 * ctx.progress.done) / ctx.progress.total));
    ctx.progress.last = Math.max(ctx.progress.last, pct);
    ctx.onProgress?.({ percent: ctx.progress.last, phrase });
  };
  return ctx;
}

/** Una llamada al proveedor de texto, registrada para llm_calls. */
async function callText(ctx, step, { system, messages, schema, effort, maxTokens }) {
  const provider = ctx.providers.text;
  const systemTokens = estimateTokens([].concat(system ?? []).join('\n'), ctx.config.charsPerToken);
  const entry = {
    step,
    modality: 'text',
    provider: provider.name,
    model: provider.model,
    effort,
    max_tokens: maxTokens,
    // Si el sistema no llega al mínimo cacheable no se cachea y la lectura de caché será cero (informe 02 §7).
    cacheable: systemTokens >= ctx.config.minCacheableSystemTokens,
    usage: null,
    duration_ms: null,
    outcome: 'ok',
  };
  ctx.calls.push(entry);
  try {
    const out = await provider.complete({ system, messages, schema, effort, maxTokens, cacheTtl: ctx.config.cacheTtl });
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

function withErrorContext(messages, raw, errors) {
  const feedback = retryUser(errors);
  if (raw) return [...messages, { role: 'assistant', content: raw }, { role: 'user', content: feedback }];
  const last = messages.at(-1);
  const lastText = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
  return [...messages.slice(0, -1), { role: 'user', content: `${lastText}\n\n${feedback}` }];
}

/**
 * Una llamada estructurada con su recuperación:
 *  - `refusal`: no se reintenta igual (informe 02 [F4]); vuelve como estado.
 *  - `max_tokens`: un reintento con el doble (MASTER-SPEC §7.5); un segundo corte vuelve como estado.
 *  - salida inválida: un reintento con el error como contexto; después, estado `invalid`.
 * `validate(json)` devuelve `{ errors: string[], ...resto }`.
 */
async function structuredStep(ctx, { step, system, messages, schema, effort, validate }) {
  const { config } = ctx;
  let maxTokens = config.maxTokens;
  let cutRetried = false;
  let invalidRetries = 0;
  let current = messages;
  for (;;) {
    const r = await callText(ctx, step, { system, messages: current, schema, effort, maxTokens });
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
      const v = validate(r.out.json);
      if (v.errors.length === 0) return { status: 'ok', json: r.out.json, ...v };
      ({ errors, ...rest } = v);
      raw = JSON.stringify(r.out.json);
    }
    if (invalidRetries >= config.invalidOutputRetries) return { status: 'invalid', step, errors, ...rest };
    invalidRetries += 1;
    ctx.stats.invalid_retries += 1;
    current = withErrorContext(messages, raw, errors);
  }
}

function describeConflicts({ overlaps, gaps }) {
  const out = [];
  for (const o of overlaps) out.push(`la unidad ${o.unit_id} está en más de un lugar (${o.owners.join(' y ')})`);
  if (gaps.length > 0) out.push(`las unidades ${gaps.join(', ')} no están en ningún mensaje ni en discarded`);
  return out;
}

/** Descompone un conjunto de unidades (todo el input o un trozo) con recuperación y un único rescate. */
async function decomposeUnits(ctx, { bundle, template, system, schema, units, scopeNote, label }) {
  const { config } = ctx;
  const scope = new Set(units.map((u) => u.id));
  const vctx = contextFromBundle(bundle, { fields: template.fields, scope });
  const base = {
    system,
    schema,
    effort: config.decomposeEffort,
  };
  const first = await structuredStep(ctx, {
    ...base,
    step: `decompose${label}`,
    messages: [{ role: 'user', content: decomposeUser({ members: bundle.members ?? [], attachments: bundle.attachments ?? [], units, scopeNote }) }],
    validate: (json) => validateDecomposition(json, vctx),
  });
  if (first.status !== 'ok') return first;

  let { messages, discarded } = first.json;
  let { overlaps, gaps } = first.conflicts;
  if (overlaps.length === 0 && gaps.length === 0) return { status: 'ok', messages, discarded, rescued: false };

  // Conflicto de exclusión mutua o de exhaustividad: un único pase de rescate sobre lo que falló.
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
  const rescueCtx = contextFromBundle(bundle, { fields: template.fields, scope: coverageSet });
  const rescue = await structuredStep(ctx, {
    ...base,
    step: `rescue${label}`,
    messages: [{
      role: 'user',
      content: rescueUser({
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
  });
  if (rescue.status !== 'ok') return rescue;

  messages = [...keptMessages, ...rescue.json.messages];
  discarded = [...keptDiscarded, ...rescue.json.discarded];
  const remaining = rescue.conflicts.overlaps.length > 0 || rescue.conflicts.gaps.length > 0 ? rescue.conflicts : coverage(messages, discarded, scope);
  if (remaining.overlaps.length > 0 || remaining.gaps.length > 0) {
    return { status: 'invalid', step: `rescue${label}`, reason: 'mece_conflict', errors: describeConflicts(remaining), draft: { messages, discarded } };
  }
  return { status: 'ok', messages, discarded, rescued: true };
}

/** Ejecuta `tasks` con a lo sumo `limit` a la vez; deja de iniciar nuevas si una devuelve un estado que no es `ok`. */
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
 * @param {object} bundle  ver MASTER-SPEC §7.5; las plantillas traen además `body_markdown`
 * @param {{providers: object, onProgress?: Function, config: object}} opts  `config` ya resuelta
 */
export async function analyzeWithApi(bundle, { providers, onProgress, config }) {
  checkBundle(bundle);
  const units = numberUnits(bundle);
  if (units.length === 0) throw new AnalyzeInputError('El input no tiene texto ni adjuntos con texto extraído');
  const ctx = createContext({ providers, config, onProgress, unitCount: units.length });
  const profile = providers.text.schemaProfile ?? 'anthropic';
  const attachments = bundle.attachments ?? [];
  const members = bundle.members ?? [];
  const { areas, templates } = bundle;
  const fail = (r) => ({ status: r.status, step: r.step, category: r.category, explanation: r.explanation, reason: r.reason, errors: r.errors ?? [], max_tokens: r.max_tokens, draft: r.draft, units, calls: ctx.calls, stats: ctx.stats });

  // -- Llamada 1: clasificar ----------------------------------------------------------------
  ctx.report('clasificando el input');
  const cSystem = classifySystem({ areas, templates });
  const fixedClassify = estimateTokens([...cSystem, membersBlock(members)].join('\n'), config.charsPerToken);
  const classifyChunks = partitionUnits(units, { budgetTokens: config.partitionThresholdTokens - fixedClassify, charsPerToken: config.charsPerToken });
  // Un solo área por propuesta (§7.5): si el input no cabe, se clasifica sobre su primer trozo.
  ctx.stats.classified_on_partial = classifyChunks.length > 1;
  const classification = await structuredStep(ctx, {
    step: 'classify',
    system: cSystem,
    messages: [{ role: 'user', content: classifyUser({ units: classifyChunks[0], attachments }) }],
    schema: buildClassificationSchema({ areas, templates }),
    effort: config.classifyEffort,
    validate: (json) => ({ errors: validateClassification(json, { areas, templates }) }),
  });
  if (classification.status !== 'ok') return fail(classification);
  const { area_id, template_id } = classification.json;
  ctx.report('input clasificado', { advance: true });

  // -- Llamada 2: descomponer ---------------------------------------------------------------
  const templateRow = templates.find((t) => t.id === template_id);
  if (typeof templateRow.body_markdown !== 'string') {
    throw new AnalyzeInputError(`La plantilla ${template_id} no trae «body_markdown»`, { calls: ctx.calls });
  }
  const template = parseTemplate(templateRow.body_markdown, { source: `plantilla ${template_id}` });
  const dSystem = decomposeSystem(template);
  const schema = buildDecompositionSchema(template.fields, { profile });
  const fixedDecompose = estimateTokens([...dSystem, membersBlock(members)].join('\n'), config.charsPerToken);
  const chunks = partitionUnits(units, { budgetTokens: config.partitionThresholdTokens - fixedDecompose, charsPerToken: config.charsPerToken });
  ctx.stats.chunks = chunks.length;
  ctx.stats.partitioned = chunks.length > 1;
  ctx.stats.estimated_input_tokens = estimateTokens(renderUnits(units), config.charsPerToken);
  ctx.progress.total = 2 + chunks.length;
  ctx.report(chunks.length > 1 ? `descomponiendo ${chunks.length} trozos` : 'descomponiendo el input');

  const tasks = chunks.map((chunkUnits, index) => async () => {
    const scopeNote = chunks.length > 1 ? chunkNote({ index, total: chunks.length, first: chunkUnits[0].id, last: chunkUnits.at(-1).id }) : undefined;
    const r = await decomposeUnits(ctx, { bundle, template, system: dSystem, schema, units: chunkUnits, scopeNote, label: chunks.length > 1 ? `#${index + 1}` : '' });
    if (r.status === 'ok') ctx.report(chunks.length > 1 ? `trozo ${index + 1} de ${chunks.length} listo` : 'input descompuesto', { advance: true });
    return r;
  });
  const results = await runPool(tasks, config.partitionConcurrency);
  const bad = results.find((r) => r && r.status !== 'ok');
  if (bad) return fail(bad);

  // -- Reducción determinista por unit_ids ---------------------------------------------------
  // Los trozos son disjuntos por unidad: la reducción es una concatenación, sin llamada (informe 02 §3.3).
  ctx.report('validando la propuesta');
  const merged = {
    messages: results.flatMap((r) => r.messages),
    discarded: results.flatMap((r) => r.discarded),
  };
  const finalCheck = validateDecomposition(merged, contextFromBundle(bundle, { fields: template.fields, scope: units.map((u) => u.id) }));
  if (finalCheck.errors.length > 0 || finalCheck.conflicts.overlaps.length > 0 || finalCheck.conflicts.gaps.length > 0) {
    return fail({ status: 'invalid', step: 'reduce', reason: 'mece_conflict', errors: [...finalCheck.errors, ...describeConflicts(finalCheck.conflicts)], draft: merged });
  }
  const { messages, discarded } = normalizeDecomposition(merged);
  ctx.report('propuesta lista', { advance: true });
  return {
    status: 'ok',
    proposal: { area_id, template_id, messages, discarded },
    units,
    calls: ctx.calls,
    stats: ctx.stats,
  };
}

/**
 * Calienta por evento el esquema y el prompt de una plantilla (informe 02 §7 y §10.2: la gramática se
 * cachea 24 horas desde el último uso; se llama al guardar o editar una plantilla, sin reloj).
 * @returns {Promise<object>} la entrada de llm_calls de la llamada de calentamiento
 */
export async function warmTemplate({ providers, config, templateMarkdown }) {
  const template = parseTemplate(templateMarkdown, { source: 'calentamiento' });
  const ctx = createContext({ providers, config, unitCount: 0 });
  const profile = providers.text.schemaProfile ?? 'anthropic';
  const r = await callText(ctx, 'warmup', {
    system: decomposeSystem(template),
    messages: [{ role: 'user', content: 'Calentamiento de la plantilla. Devuelve messages y discarded vacíos.' }],
    schema: buildDecompositionSchema(template.fields, { profile }),
    effort: config.classifyEffort,
    maxTokens: config.maxTokens,
  });
  return { ...ctx.calls[0], ok: r.ok };
}
