// Oracle decomposition for the private bench (H-90). The full pipeline mixes two questions: how the analyzer splits an
// input into points, and what it does with a point once it has one (area, template, assignees, body). Every variant is
// scored here on the same messages by taking the first question away: the points are the reference messages, with their
// units grouped exactly as in expected.json.
//
// The calls are the analyzer's own, built with the exported prompt and schema builders of src/analyze/ (nothing there
// changes):
//   1. classification: classifySystem + classifyUser, the whole input (cut into chunks when it is over the partition
//      threshold, as the pipeline does), with the reference grouping appended to the user turn. The model is told to
//      classify exactly those groups; each reference group keeps the area and template that most of its units got in the
//      answer. The classification prompt has the project description but not the team.
//   2. decomposition, one call per reference group, with the template the model chose for it: decomposeSystem(template,
//      project) + decomposeUser({ members, units }). This is where profiles act: assignee_ids come from here.
// There is no MECE validation, rescue pass or reduction: the group is the point. When a group comes back as several
// messages the output keeps the first message's text and the union of the assignees, and counts the group as split.

import { classifySystem, classifyUser, decomposeSystem, decomposeUser } from '../src/analyze/prompts.js';
import { buildClassificationSchema, buildDecompositionSchema, numberUnits, partitionUnits, resolveConfig } from '../src/analyze/index.js';
import { parseTemplate } from '../src/analyze/templates.js';
import { estimateTokens, renderUnits } from '../src/analyze/units.js';
import { costOf } from './pricing.js';
import { withQueueRetries } from './spend.mjs';

/** The grouping instruction appended to the classification user turn. */
export function groupingNote(groups, discarded) {
  const list = (ids) => ids.map((id) => `u${id}`).join(', ');
  return [
    '',
    'Condición de la medición: la agrupación ya está hecha. Clasifica exactamente estos grupos, sin unirlos ni partirlos, y devuelve cada uno con sus unit_ids exactos y el área y la plantilla que le corresponden.',
    ...groups.map((g, i) => `Grupo ${i + 1}: ${list(g.unit_ids)}`),
    ...(discarded.length ? [`Descartadas: ${list(discarded.flatMap((d) => d.unit_ids))}`] : []),
  ].join('\n');
}

/**
 * Maps the model's classification onto the reference groups. Each reference group takes the (area, template) held by
 * most of its units in the model's answer; a tie goes to the first. `exact` counts the reference groups the model had
 * also drawn exactly; a group none of whose units the model classified comes back without area (`unmapped`).
 */
export function mapOntoReference(modelGroups, groups) {
  const owner = new Map();
  for (const mg of modelGroups) for (const id of mg.unit_ids) owner.set(id, mg);
  let exact = 0;
  let unmapped = 0;
  const mapped = groups.map((g) => {
    const first = owner.get(g.unit_ids[0]);
    if (first && first.unit_ids.length === g.unit_ids.length && g.unit_ids.every((id) => owner.get(id) === first)) exact += 1;
    const tally = new Map();
    for (const id of g.unit_ids) {
      const mg = owner.get(id);
      if (!mg) continue;
      const key = `${mg.area_id}:${mg.template_id}`;
      tally.set(key, { mg, n: (tally.get(key)?.n ?? 0) + 1 });
    }
    const best = [...tally.values()].sort((a, b) => b.n - a.n)[0];
    if (!best) {
      unmapped += 1;
      return { ...g, area_id: null, template_id: null };
    }
    return { ...g, area_id: best.mg.area_id, template_id: best.mg.template_id };
  });
  return { groups: mapped, exact, unmapped };
}

/** Runs `tasks` with at most `limit` in flight, keeping order. */
async function inPool(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]();
    }
  }));
  return out;
}

/**
 * @param {object} args
 * @param {object} args.providers   as built by createProviders
 * @param {{ text: string, attachments: object[] }} args.input  the stored extraction of the case
 * @param {{ areas: object[], templates: object[], members: object[], project?: object }} args.context
 * @param {{ messages: Array<{ id: string, unit_ids: number[] }>, discarded?: object[] }} args.expected
 * @param {object} [args.config]    analyzer knobs (src/analyze/config.js)
 * @param {number} [args.concurrency]
 * @param {(error: Error, attempt: number) => void} [args.onRetry]
 */
export async function runOracleCase({ providers, input, context, expected, config: overrides, concurrency = 4, onRetry }) {
  const config = resolveConfig(overrides);
  const { areas, templates, members, project } = context;
  const attachments = (input.attachments ?? []).map((a) => ({ id: a.id, kind: a.kind, extracted: a.extracted }));
  const units = numberUnits({ text: input.text, attachments });
  const profile = providers.text.schemaProfile ?? 'anthropic';
  const calls = [];
  const started = performance.now();

  const complete = async (step, req) => {
    const t0 = performance.now();
    const out = await withQueueRetries(() => providers.text.complete(req), { attempts: 6, onRetry });
    calls.push({ step, model: out.model, usage: out.usage, duration_ms: out.duration_ms ?? performance.now() - t0, cost_usd: costOf({ model: out.model, usage: out.usage }) });
    return out;
  };

  // 1. Classification of the reference groups.
  const allGroups = expected.messages.map((m) => ({ id: m.id, unit_ids: [...m.unit_ids].sort((a, b) => a - b) }));
  const cSystem = classifySystem({ areas, templates, project });
  const chunks = partitionUnits(units, { budgetTokens: config.partitionThresholdTokens - estimateTokens(cSystem.join('\n'), config.charsPerToken), charsPerToken: config.charsPerToken });
  const cSchema = buildClassificationSchema({ areas, templates });
  const classified = new Map();
  let exactGroups = 0;
  await inPool(chunks.map((chunkUnits, ci) => async () => {
    const scope = new Set(chunkUnits.map((u) => u.id));
    const groups = allGroups.map((g) => ({ ...g, unit_ids: g.unit_ids.filter((id) => scope.has(id)) })).filter((g) => g.unit_ids.length > 0);
    const discarded = (expected.discarded ?? []).map((d) => ({ ...d, unit_ids: d.unit_ids.filter((id) => scope.has(id)) })).filter((d) => d.unit_ids.length > 0);
    const out = await complete(`classify${chunks.length > 1 ? `#${ci + 1}` : ''}`, {
      system: cSystem,
      messages: [{ role: 'user', content: classifyUser({ units: chunkUnits, attachments }) + groupingNote(groups, discarded) }],
      schema: cSchema,
      effort: config.classifyEffort,
      maxTokens: config.maxTokens,
      cacheTtl: config.cacheTtl,
      ...(config.classifyThinking ? { thinking: config.classifyThinking } : {}),
    });
    const mapped = mapOntoReference(out.json?.groups ?? [], groups);
    exactGroups += mapped.exact;
    for (const g of mapped.groups) classified.set(g.id, { ...(classified.get(g.id) ?? {}), ...g, unit_ids: allGroups.find((x) => x.id === g.id).unit_ids });
  }), config.partitionConcurrency);

  // 2. One decomposition per reference group, with the template the model chose for it.
  const prepared = new Map();
  const prepare = (templateId) => {
    if (!prepared.has(templateId)) {
      const row = templates.find((t) => t.id === templateId);
      const template = parseTemplate(row.body_markdown, { source: `plantilla ${templateId}` });
      prepared.set(templateId, { system: decomposeSystem(template, project), schema: buildDecompositionSchema(template.fields, { profile, withDiscarded: false }) });
    }
    return prepared.get(templateId);
  };
  const memberIds = new Set(members.map((m) => m.id));
  const failed = [];
  let split = 0;
  const messages = await inPool(allGroups.map((g) => async () => {
    const c = classified.get(g.id);
    if (!c || c.template_id === null || c.template_id === undefined) {
      failed.push({ id: g.id, why: 'unclassified' });
      return null;
    }
    const ids = new Set(g.unit_ids);
    const entry = prepare(c.template_id);
    try {
      const out = await complete(`decompose[t${c.template_id}]`, {
        system: entry.system,
        messages: [{ role: 'user', content: decomposeUser({ members, attachments, units: units.filter((u) => ids.has(u.id)) }) }],
        schema: entry.schema,
        effort: config.decomposeEffort,
        maxTokens: config.maxTokens,
        cacheTtl: config.cacheTtl,
        ...(config.decomposeThinking ? { thinking: config.decomposeThinking } : {}),
      });
      const parts = out.json?.messages ?? [];
      if (parts.length === 0) {
        failed.push({ id: g.id, why: 'no message' });
        return null;
      }
      if (parts.length > 1) split += 1;
      const assignees = [...new Set(parts.flatMap((p) => p.assignee_ids ?? []))].filter((id) => memberIds.has(id)).sort((a, b) => a - b);
      const [first] = parts;
      return { unit_ids: g.unit_ids, area_id: c.area_id, template_id: c.template_id, title: first.title, fields: first.fields, body: first.body, assignee_ids: assignees, attachment_ids: first.attachment_ids ?? [], parts: parts.length };
    } catch (error) {
      failed.push({ id: g.id, why: error.code ?? error.message.slice(0, 80) });
      return null;
    }
  }), concurrency);

  const totalMs = performance.now() - started;
  const sum = (key) => calls.reduce((a, c) => a + (c.usage?.[key] ?? 0), 0);
  const unpriced = calls.filter((c) => c.cost_usd === null).length;
  return {
    status: failed.length === 0 ? 'ok' : 'partial',
    total_ms: totalMs,
    steps: [],
    calls,
    usage: {
      calls: calls.length,
      input_tokens: sum('input_tokens'),
      output_tokens: sum('output_tokens'),
      cached_tokens: sum('cached_tokens'),
      cost_usd: unpriced === calls.length && calls.length > 0 ? null : calls.reduce((a, c) => a + (c.cost_usd ?? 0), 0),
      model_ms: calls.reduce((a, c) => a + (c.duration_ms ?? 0), 0),
    },
    stats: { groups: allGroups.length, classification_chunks: chunks.length },
    proposal: { messages: messages.filter(Boolean), discarded: expected.discarded ?? [] },
    units,
    oracle: { groups: allGroups.length, exact_grouping: exactGroups, split_groups: split, failed },
  };
}
