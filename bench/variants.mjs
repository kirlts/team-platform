// Variants B and C of the analyzer (MASTER-SPEC §7.5; research 02 §2.1), only for measurement: nothing here runs in the product.
// Both return what `analyze` returns (status, proposal, units, calls, stats), so `runCase` scores them like variant A.
//
//   A  the product: classification, then one decomposition per group.
//   B  one call: the catalog and every template in the system prompt, and the whole proposal in the answer, with a generic
//      `fields` object that is validated afterwards against the chosen template (no grammar on the required fields).
//   C  speculative decomposition: the classification runs while the whole input is decomposed with the most probable template.
//      When the classification gives one group with that template, the speculative messages are kept; otherwise the groups are
//      decomposed as in A and the speculative call is wasted.
//
// B and C get one retry with the error as context and the closing of overlaps and gaps by set arithmetic, but not the rescue call.
import { classifyInput, resolveConfig } from '../src/analyze/index.js';
import { buildDecompositionSchema, buildProposalSchema } from '../src/analyze/schema.js';
import { classifySystem, decomposeSystem, decomposeUser, promptSet, resolveLanguage, retryUser } from '../src/analyze/prompts.js';
import { parseTemplate } from '../src/analyze/templates.js';
import { coverage, describeConflicts, normalizeDecomposition, repairCoverage, validateDecomposition, validateProposal } from '../src/analyze/validate.js';
import { numberUnits } from '../src/analyze/units.js';

/** Schema of B: the proposal with `fields` as a list of name and value, because the grammar of the provider rejects an open object. */
function singleCallSchema() {
  const schema = structuredClone(buildProposalSchema());
  schema.properties.messages.items.properties.fields = {
    type: 'array',
    items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'], additionalProperties: false },
  };
  return schema;
}

/** The answer of B with `fields` as an object keyed by field name, ready for the validators of the product. */
const withFieldObjects = (json) => ({ ...json, messages: json.messages.map((m) => ({ ...m, fields: Object.fromEntries((m.fields ?? []).map((f) => [f.name, f.value])) })) });

const SPECULATED_TEMPLATE_ID = 2; // «Reporte de error»: the most frequent template in the bench

/** One structured call with one retry; returns { json, errors, rest } and records the calls. */
async function callValidated({ providers, config, calls, step, system, content, schema, effort, validate, language }) {
  let messages = [{ role: 'user', content }];
  let last = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const started = performance.now();
    const out = await providers.text.complete({ system, messages, schema, effort, maxTokens: config.maxTokens, cacheTtl: config.cacheTtl, thinking: config.decomposeThinking ?? undefined });
    calls.push({ step: attempt === 0 ? step : `${step}-retry`, modality: 'text', provider: out.provider, model: out.model, usage: out.usage ?? null, duration_ms: out.duration_ms ?? Math.round(performance.now() - started), outcome: 'ok' });
    const v = validate(out.json);
    last = { json: out.json, ...v };
    if (v.errors.length === 0) return last;
    messages = [...messages, { role: 'assistant', content: JSON.stringify(out.json) }, { role: 'user', content: retryUser(v.errors, language) }];
  }
  return last;
}

function prepare(bundle, language) {
  const parsed = new Map(bundle.templates.map((t) => [t.id, parseTemplate(t.body_markdown, { source: `template ${t.id}` })]));
  return { parsed, units: numberUnits(bundle), members: bundle.members ?? [], attachments: bundle.attachments ?? [], project: bundle.project, language };
}

function finish({ units, calls, stats, status, messages, discarded, errors = [], draft }) {
  if (status !== 'ok') return { status, step: 'validate', errors, draft, units, calls, stats };
  return { status: 'ok', proposal: { messages, discarded }, units, calls, stats };
}

/** Variant B: the whole proposal in one call. */
export async function analyzeB(bundle, { providers, config: overrides = {} }) {
  const config = resolveConfig(overrides);
  const language = resolveLanguage(bundle.language);
  const set = promptSet(bundle.language);
  const { parsed, units, members, attachments, project } = prepare(bundle, language);
  const scope = new Set(units.map((u) => u.id));
  const calls = [];
  const stats = { variant: 'B', units: units.length };
  const system = [
    set.CLASSIFY_INSTRUCTIONS,
    set.catalogBlock({ areas: bundle.areas, templates: bundle.templates }),
    ...[...parsed.values()].map((t) => set.templateBlock(t)),
    set.projectBlock(project),
    [
      'En esta respuesta cada grupo de las reglas anteriores es directamente un mensaje, ya redactado: no hay un paso posterior.',
      'Cada mensaje lleva: unit_ids; area_id y template_id del catálogo; title; fields, un objeto con los campos de la plantilla elegida (los de su bloque, con el nombre exacto; «No indicado» en un campo obligatorio que el input no responde); body, redactado para quien lo recibe, con el formato de salida de esa plantilla; assignee_ids según los perfiles del bloque de equipo; attachment_ids.',
      'Cada unidad aparece una sola vez, en un mensaje o en discarded.',
    ].join('\n'),
  ].filter(Boolean);
  const content = decomposeUser({ members, attachments, units, language: bundle.language, recent: bundle.recent_inputs });
  const fieldsByTemplate = new Map([...parsed].map(([id, t]) => [id, t.fields]));
  const r = await callValidated({
    providers, config, calls, step: 'single', system, content, schema: singleCallSchema(), effort: config.decomposeEffort, language: bundle.language,
    validate: (json) => validateProposal(withFieldObjects(json), { templates: bundle.templates, fieldsByTemplate, scope, memberIds: new Set(members.map((m) => m.id)), attachmentIds: new Set(attachments.map((a) => a.id)) }),
  });
  if (r.errors.length > 0) return finish({ units, calls, stats, status: 'invalid', errors: r.errors, draft: r.json });
  const answer = withFieldObjects(r.json);
  const merged = { messages: answer.messages.map((m) => ({ ...m, unit_ids: [...new Set(m.unit_ids)].sort((a, b) => a - b) })), discarded: answer.discarded };
  const conflicts = coverage(merged.messages, merged.discarded, scope);
  stats.overlaps = conflicts.overlaps.length;
  stats.gaps = conflicts.gaps.length;
  if (conflicts.overlaps.length + conflicts.gaps.length > 0) {
    const repaired = repairCoverage(merged.messages, merged.discarded, scope);
    if (!repaired) return finish({ units, calls, stats, status: 'invalid', errors: describeConflicts(conflicts), draft: merged });
    merged.messages = repaired.messages;
    merged.discarded = repaired.discarded;
  }
  return finish({ units, calls, stats, status: 'ok', ...merged });
}

/** Decomposes `groupUnits` with the template of `templateId`; returns validated, normalized messages. */
async function decomposeWith({ providers, config, calls, bundle, parsed, units, groupUnits, templateId, step, language }) {
  const template = parsed.get(templateId);
  const profile = providers.text.schemaProfile ?? 'anthropic';
  const members = bundle.members ?? [];
  const attachments = bundle.attachments ?? [];
  const scope = new Set(groupUnits.map((u) => u.id));
  const r = await callValidated({
    providers, config, calls, step, system: decomposeSystem(template, bundle.project, language), schema: buildDecompositionSchema(template.fields, { profile, withDiscarded: false, requireAssignee: members.length > 0 && profile === 'anthropic' }),
    content: decomposeUser({ members, attachments, units: groupUnits, language: bundle.language, recent: bundle.recent_inputs }), effort: config.decomposeEffort, language: bundle.language,
    validate: (json) => {
      const v = validateDecomposition(json, { fields: template.fields, scope, memberIds: new Set(members.map((m) => m.id)), attachmentIds: new Set(attachments.map((a) => a.id)), requireMessage: true, withDiscarded: false });
      return { errors: v.errors, conflicts: v.conflicts };
    },
  });
  if (r.errors.length > 0) return { errors: r.errors, draft: r.json };
  return { messages: normalizeDecomposition({ ...r.json, discarded: [] }).messages };
}

/** Variant C: speculative decomposition in parallel with the classification. */
export async function analyzeC(bundle, { providers, config: overrides = {} }) {
  const config = resolveConfig(overrides);
  const language = resolveLanguage(bundle.language);
  const { parsed, units } = prepare(bundle, language);
  const allIds = units.map((u) => u.id);
  const calls = [];
  const stats = { variant: 'C', units: units.length };
  const [stage, speculative] = await Promise.all([
    classifyInput(bundle, { providers, config }),
    decomposeWith({ providers, config, calls, bundle, parsed, units, groupUnits: units, templateId: SPECULATED_TEMPLATE_ID, step: 'speculative', language }),
  ]);
  calls.unshift(...stage.ctx.calls);
  if (stage.failed) return finish({ units, calls, stats, status: stage.failed.status, errors: stage.failed.errors, draft: stage.failed.draft });
  const { groups, discarded } = stage;
  const hit = groups.length === 1 && groups[0].template_id === SPECULATED_TEMPLATE_ID && !speculative.errors;
  stats.groups = groups.length;
  stats.speculation_hit = hit;
  let messages;
  if (hit) {
    const keep = new Set(groups[0].unit_ids);
    messages = speculative.messages
      .map((m) => ({ ...m, unit_ids: m.unit_ids.filter((id) => keep.has(id)), area_id: groups[0].area_id, template_id: groups[0].template_id }))
      .filter((m) => m.unit_ids.length > 0);
  } else {
    const results = await Promise.all(groups.map(async (g, i) => {
      const ids = new Set(g.unit_ids);
      return { g, r: await decomposeWith({ providers, config, calls, bundle, parsed, units, groupUnits: units.filter((u) => ids.has(u.id)), templateId: g.template_id, step: `decompose#${i + 1}`, language }) };
    }));
    const bad = results.find((x) => x.r.errors);
    if (bad) return finish({ units, calls, stats, status: 'invalid', errors: bad.r.errors, draft: bad.r.draft });
    messages = results.flatMap(({ g, r }) => r.messages.map((m) => ({ ...m, area_id: g.area_id, template_id: g.template_id })));
  }
  const merged = { messages, discarded };
  const conflicts = coverage(merged.messages, merged.discarded, new Set(allIds));
  stats.overlaps = conflicts.overlaps.length;
  stats.gaps = conflicts.gaps.length;
  if (conflicts.overlaps.length + conflicts.gaps.length > 0) {
    const repaired = repairCoverage(merged.messages, merged.discarded, allIds);
    if (!repaired) return finish({ units, calls, stats, status: 'invalid', errors: describeConflicts(conflicts), draft: merged });
    merged.messages = repaired.messages;
    merged.discarded = repaired.discarded;
  }
  return finish({ units, calls, stats, status: 'ok', ...merged });
}
