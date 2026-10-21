// Analizador `api` (MASTER-SPEC §7.5, variante A): bucle propio con salida estructurada.
//
//   1. numerar las unidades del input extraído
//   2. llamada 1: clasificar en grupos {area_id, template_id, unit_ids} más `discarded` (esfuerzo `low`)
//   3. llamada 2, una por grupo y en paralelo: descomponer con el cuerpo de la plantilla del grupo (esfuerzo
//      `medium`), exigiendo `unit_ids` y `discarded`
//   4. solapes y huecos por conjuntos (por grupo, y al final sobre la unión de todos); un único pase de
//      rescate por grupo con conflicto
//   5. si el input o un grupo supera el umbral: partir sólo por fronteras estructurales, procesar los
//      trozos en paralelo y reducir de forma determinista por `unit_ids`
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

/** Contexto de ejecución compartido por los pasos de un análisis. */
function createContext({ providers, config, onProgress, unitCount }) {
  const ctx = {
    providers,
    config,
    calls: [],
    stats: { chunks: 1, groups: 0, classification_chunks: 1, rescues: 0, invalid_retries: 0, max_tokens_retries: 0, partitioned: false, units: unitCount },
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
    // Si el sistema no llega al mínimo cacheable no se cachea y la lectura de caché será cero (informe 02 §7).
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

/** Descompone un conjunto de unidades (todo el input o un trozo) con recuperación y un único rescate. */
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
    messages: [{ role: 'user', content: decomposeUser({ members: bundle.members ?? [], attachments: bundle.attachments ?? [], units, scopeNote }) }],
    validate: (json) => validateDecomposition(json, vctx),
  });
  if (first.status !== 'ok') return first;

  let { messages } = first.json;
  let discarded = [];
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
  const rescueCtx = { ...contextFromBundle(bundle, { fields: template.fields, scope: coverageSet }), withDiscarded: false };
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
  discarded = keptDiscarded;
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
  const allIds = units.map((u) => u.id);
  const fail = (r) => ({ status: r.status, step: r.step, category: r.category, explanation: r.explanation, reason: r.reason, errors: r.errors ?? [], max_tokens: r.max_tokens, draft: r.draft, units, calls: ctx.calls, stats: ctx.stats });

  // -- Llamada 1: clasificar en grupos por área y plantilla ----------------------------------
  // Un input puede traer un error, una idea y una pregunta: cada grupo lleva su área y su plantilla
  // (idea.md: «uno o varios mensajes que agrupen el trabajo en categorías»). Si el input no cabe en una
  // llamada se clasifica por trozos estructurales disjuntos y los grupos se unen.
  ctx.report('clasificando el input');
  const cSystem = classifySystem({ areas, templates });
  const fixedClassify = estimateTokens([...cSystem, membersBlock([])].join('\n'), config.charsPerToken);
  const classifyChunks = partitionUnits(units, { budgetTokens: config.partitionThresholdTokens - fixedClassify, charsPerToken: config.charsPerToken });
  ctx.stats.classification_chunks = classifyChunks.length;
  ctx.progress.total = classifyChunks.length + 2;
  const cSchema = buildClassificationSchema({ areas, templates });
  const classifyTasks = classifyChunks.map((chunkUnits, index) => async () => {
    const scope = new Set(chunkUnits.map((u) => u.id));
    const r = await structuredStep(ctx, {
      step: classifyChunks.length > 1 ? `classify#${index + 1}` : 'classify',
      system: cSystem,
      messages: [{ role: 'user', content: classifyUser({ units: chunkUnits, attachments }) }],
      schema: cSchema,
      effort: config.classifyEffort,
      thinking: config.classifyThinking ?? undefined,
      validate: (json) => validateClassification(json, { areas, templates, scope }),
    });
    if (r.status === 'ok') ctx.report('input clasificado', { advance: true });
    return r;
  });
  const classified = await runPool(classifyTasks, config.partitionConcurrency);
  const badClass = classified.find((r) => r && r.status !== 'ok');
  if (badClass) return fail(badClass);
  const groups = classified.flatMap((r) => r.json.groups);
  const classDiscarded = classified.flatMap((r) => r.json.discarded);
  ctx.stats.groups = groups.length;

  // -- Llamada 2: descomponer cada grupo con la plantilla del grupo --------------------------
  const prepared = new Map(); // template_id -> plantilla leída, sistema y esquema
  const prepare = (templateId) => {
    if (prepared.has(templateId)) return prepared.get(templateId);
    const row = templates.find((t) => t.id === templateId);
    if (typeof row.body_markdown !== 'string') {
      throw new AnalyzeInputError(`La plantilla ${templateId} no trae «body_markdown»`, { calls: ctx.calls });
    }
    const template = parseTemplate(row.body_markdown, { source: `plantilla ${templateId}` });
    const system = decomposeSystem(template);
    const entry = {
      template,
      system,
      schema: buildDecompositionSchema(template.fields, { profile, withDiscarded: false }),
      fixed: estimateTokens([...system, membersBlock(members)].join('\n'), config.charsPerToken),
    };
    prepared.set(templateId, entry);
    return entry;
  };

  const work = []; // una tarea por grupo, o por trozo de un grupo que no cabe
  for (const [gi, group] of groups.entries()) {
    const entry = prepare(group.template_id);
    const ids = new Set(group.unit_ids);
    const groupUnits = units.filter((u) => ids.has(u.id));
    const parts = partitionUnits(groupUnits, { budgetTokens: config.partitionThresholdTokens - entry.fixed, charsPerToken: config.charsPerToken });
    parts.forEach((partUnits, pi) => work.push({ group, entry, gi, pi, parts: parts.length, units: partUnits }));
  }
  ctx.stats.chunks = work.length;
  ctx.stats.partitioned = work.length > groups.length || classifyChunks.length > 1;
  ctx.stats.estimated_input_tokens = estimateTokens(renderUnits(units), config.charsPerToken);
  ctx.progress.total = classifyChunks.length + work.length + 1;
  ctx.report(work.length > 1 ? `descomponiendo ${work.length} grupos` : 'descomponiendo el input');

  const tasks = work.map((w) => async () => {
    const scopeNote = w.parts > 1 ? chunkNote({ index: w.pi, total: w.parts, first: w.units[0].id, last: w.units.at(-1).id }) : undefined;
    const label = `[t${w.group.template_id}]${w.parts > 1 ? `#${w.pi + 1}` : ''}`;
    const r = await decomposeUnits(ctx, { bundle, template: w.entry.template, system: w.entry.system, schema: w.entry.schema, units: w.units, scopeNote, label });
    if (r.status === 'ok') ctx.report('grupo descompuesto', { advance: true });
    return r.status === 'ok' ? { ...r, group: w.group } : r;
  });
  const results = await runPool(tasks, config.partitionConcurrency);
  const bad = results.find((r) => r && r.status !== 'ok');
  if (bad) return fail(bad);

  // -- Reducción determinista por unit_ids ---------------------------------------------------
  // Los grupos son disjuntos por unidad: la reducción es una concatenación, sin llamada (informe 02 §3.3).
  ctx.report('validando la propuesta');
  const merged = {
    messages: results.flatMap((r) => r.messages.map((m) => ({ ...m, area_id: r.group.area_id, template_id: r.group.template_id }))),
    discarded: [...classDiscarded, ...results.flatMap((r) => r.discarded)],
  };
  const fieldsByTemplate = new Map([...prepared].map(([id, e]) => [id, e.template.fields]));
  const finalCheck = validateProposal(merged, {
    templates,
    fieldsByTemplate,
    scope: new Set(allIds),
    memberIds: new Set(members.map((m) => m.id)),
    attachmentIds: new Set(attachments.map((a) => a.id)),
  });
  if (finalCheck.errors.length > 0 || finalCheck.conflicts.overlaps.length > 0 || finalCheck.conflicts.gaps.length > 0) {
    return fail({ status: 'invalid', step: 'reduce', reason: 'mece_conflict', errors: [...finalCheck.errors, ...describeConflicts(finalCheck.conflicts)], draft: merged });
  }
  const { messages, discarded } = normalizeDecomposition(merged);
  ctx.report('propuesta lista', { advance: true });
  return { status: 'ok', proposal: { messages, discarded }, units, calls: ctx.calls, stats: ctx.stats };
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
    messages: [{ role: 'user', content: 'Calentamiento de la plantilla. Devuelve messages vacío.' }],
    schema: buildDecompositionSchema(template.fields, { profile, withDiscarded: false }),
    effort: config.classifyEffort,
    maxTokens: config.maxTokens,
  });
  return { ...ctx.calls[0], ok: r.ok };
}

/**
 * Calienta por evento el esquema y el prompt de la clasificación: cambian cuando el Editor edita áreas o
 * plantillas (los `enum` de ids son parte de la estructura). Mismo criterio que `warmTemplate`.
 * @returns {Promise<object>} la entrada de llm_calls de la llamada de calentamiento
 */
export async function warmCatalog({ providers, config, areas, templates }) {
  const ctx = createContext({ providers, config, unitCount: 0 });
  const r = await callText(ctx, 'warmup-classify', {
    system: classifySystem({ areas, templates }),
    messages: [{ role: 'user', content: 'Calentamiento del catálogo. Devuelve groups y discarded vacíos.' }],
    schema: buildClassificationSchema({ areas, templates }),
    effort: config.classifyEffort,
    maxTokens: config.maxTokens,
  });
  return { ...ctx.calls[0], ok: r.ok };
}
