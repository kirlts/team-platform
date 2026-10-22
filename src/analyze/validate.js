// Validation of the model output (MASTER-SPEC §7.5): done by the system, not by the model.
//
// A dedicated Ajv instance: Fastify response schemas coerce types and drop
// properties (report 03), the opposite of what is wanted here. Nothing is coerced or trimmed.
//
// The system validates shape and sets: that the area exists, that each member and each attachment exist, that each
// unit is in a message or in `discarded`. It never interprets the text a person wrote (§4.2).
import Ajv from 'ajv';
import { buildClassificationSchema, buildDecompositionSchema, buildProposalSchema } from './schema.js';
import { compileFieldsSchema, compileOutputSchema } from './templates.js';
import { timeRange } from './units.js';

export const ajv = new Ajv({
  allErrors: true,
  strict: true,
  allowUnionTypes: true, // `type: ['string', 'null']` in optional fields
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});

const compiled = new Map();
function compile(schema) {
  const key = JSON.stringify(schema);
  let validate = compiled.get(key);
  if (!validate) {
    validate = ajv.compile(schema);
    compiled.set(key, validate);
  }
  return validate;
}

/** `/messages/0/fields` → `message 1, fields`: the error path as a person would read it. */
function readablePath(instancePath) {
  if (!instancePath) return 'the output';
  const parts = instancePath.split('/').slice(1);
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const next = parts[i + 1];
    const isIndex = next !== undefined && /^\d+$/.test(next);
    if (parts[i] === 'messages' && isIndex) { out.push(`message ${Number(next) + 1}`); i += 1; }
    else if (parts[i] === 'discarded' && isIndex) { out.push(`discard ${Number(next) + 1}`); i += 1; }
    else if (/^\d+$/.test(parts[i])) out[out.length - 1] = `${out.at(-1)}[${Number(parts[i]) + 1}]`;
    else out.push(parts[i]);
  }
  return out.join(', ');
}

/** Ajv errors as sentences the model and the person understand. */
export function formatAjvErrors(errors = []) {
  return errors.map((e) => {
    const path = readablePath(e.instancePath);
    switch (e.keyword) {
      case 'required': return `${path}: missing «${e.params.missingProperty}»`;
      case 'additionalProperties': return `${path}: unexpected «${e.params.additionalProperty}»`;
      case 'type': return `${path}: must be of type ${[].concat(e.params.type).join(' or ')}`;
      case 'minLength': return `${path}: cannot be empty`;
      case 'minItems': return `${path}: must have at least ${e.params.limit} item(s)`;
      case 'uniqueItems': return `${path}: has repeated items`;
      case 'enum': return `${path}: value outside the allowed list`;
      default: return `${path}: ${e.message}`;
    }
  });
}

/** Ids of a list of objects as a set. */
const idSet = (list) => new Set((list ?? []).map((x) => x.id));

/** Sentences for the MECE conflicts (overlaps and gaps), for the model and for the visible reason of the job. */
export function describeConflicts({ overlaps, gaps }) {
  const out = overlaps.map((o) => `unit ${o.unit_id} is in more than one place (${o.owners.join(' and ')})`);
  if (gaps.length > 0) out.push(`units ${gaps.join(', ')} are in no place`);
  return out;
}

/**
 * Validation of the first call: each group has an area and a template that exist and match each other,
 * cites units of the input and, together with `discarded`, the groups cover each unit exactly once.
 * Overlaps and gaps between groups are retryable errors here (rescue belongs to the decomposition).
 * @param {any} output  `{groups, discarded}`
 * @param {{areas: object[], templates: object[], scope: Set<number>}} ctx
 * @returns {{errors: string[]}}
 */
export function validateClassification(output, { areas, templates, scope, frameIds = null }) {
  const validate = compile(buildClassificationSchema({ areas, templates }, { validation: true }));
  if (!validate(output)) return { errors: formatAjvErrors(validate.errors) };
  const errors = [];
  output.groups.forEach((g, i) => {
    const template = templates.find((t) => t.id === g.template_id);
    if (template.area_id !== g.area_id) errors.push(`group ${i + 1}: template ${g.template_id} does not belong to area ${g.area_id}`);
    for (const id of g.unit_ids) if (!scope.has(id)) errors.push(`group ${i + 1}: unit ${id} does not exist in this input`);
  });
  output.discarded.forEach((d, i) => {
    for (const id of d.unit_ids) if (!scope.has(id)) errors.push(`discard ${i + 1}: unit ${id} does not exist in this input`);
  });
  if (errors.length > 0) return { errors };
  // H-3728: a request is born from what the author says or writes. A group made only of frame units, in an input where the author
  // speaks or writes, is a point nobody asked for: the frames go to the group of the request they show, or to discarded.
  const frameErrors = frameIds ? output.groups.flatMap((g, i) => (g.unit_ids.every((id) => frameIds.has(id))
    ? [`group ${i + 1}: cites only frame descriptions (${g.unit_ids.map((id) => `u${id}`).join(', ')}); a group is born from what the person says or writes, so put these frames in the group of the point they show, or in discarded when nobody talks about them`]
    : [])) : [];
  const conflicts = coverage(output.groups.map((g) => ({ unit_ids: g.unit_ids })), output.discarded, scope, 'group');
  // Only overlaps and gaps are left: if the retry does not fix them, `repairClassification` closes them (the output travels in `repairable`).
  const conflictErrors = [...frameErrors, ...describeConflicts(conflicts)];
  return conflictErrors.length > 0 ? { errors: conflictErrors, repairable: output } : { errors: [] };
}

/**
 * Set arithmetic over the units: overlaps (in more than one place) and gaps (in none).
 * @param {{unit_ids: number[]}[]} messages  (or groups, with `noun: 'group'`)
 * @param {{unit_ids: number[]}[]} discarded
 * @param {Iterable<number>} scope units that must end up covered
 */
export function coverage(messages, discarded, scope, noun = 'message') {
  const owners = new Map();
  const add = (unitId, label) => {
    if (!owners.has(unitId)) owners.set(unitId, []);
    owners.get(unitId).push(label);
  };
  messages.forEach((m, i) => m.unit_ids.forEach((id) => add(id, `${noun} ${i + 1}`)));
  discarded.forEach((d) => d.unit_ids.forEach((id) => add(id, 'discarded')));
  const overlaps = [];
  for (const [unit_id, list] of owners) if (list.length > 1) overlaps.push({ unit_id, owners: list });
  overlaps.sort((a, b) => a.unit_id - b.unit_id);
  const gaps = [...scope].filter((id) => !owners.has(id)).sort((a, b) => a - b);
  return { overlaps, gaps };
}

/**
 * Closes the overlaps and gaps of a classification that the single retry did not fix, by set arithmetic alone. A unit cited
 * twice stays in the first place that cites it; a unit cited nowhere goes where the closest unit before it went (or after it,
 * when it is the first), whether that is a group or `discarded`.
 * @param {{groups: object[], discarded: object[]}} output
 * @param {Iterable<number>} scope
 */
export function repairClassification(output, scope, { frameIds = null, frameReason = 'Observed, not said' } = {}) {
  if (frameIds) {
    // H-3728: a group of frames alone that the retry did not fix is discarded: what nobody says does not become a message.
    const frameOnly = output.groups.filter((g) => g.unit_ids.every((id) => frameIds.has(id)));
    if (frameOnly.length > 0) {
      output = {
        groups: output.groups.filter((g) => !frameOnly.includes(g)),
        discarded: [...output.discarded, { unit_ids: frameOnly.flatMap((g) => g.unit_ids), reason: frameReason }],
      };
    }
  }
  const order = [...scope].sort((a, b) => a - b);
  const owner = new Map(); // unit -> 'g<i>' | 'd<i>'
  output.groups.forEach((g, i) => g.unit_ids.forEach((id) => { if (!owner.has(id)) owner.set(id, `g${i}`); }));
  output.discarded.forEach((d, i) => d.unit_ids.forEach((id) => { if (!owner.has(id)) owner.set(id, `d${i}`); }));
  const first = order.map((id) => owner.get(id)).find((o) => o !== undefined);
  let last = null;
  for (const id of order) {
    if (owner.has(id)) last = owner.get(id);
    else if (last ?? first) owner.set(id, last ?? first);
  }
  const keep = (prefix, list) => list.map((x, i) => ({ ...x, unit_ids: order.filter((id) => owner.get(id) === `${prefix}${i}`) })).filter((x) => x.unit_ids.length > 0);
  return { groups: keep('g', output.groups), discarded: keep('d', output.discarded) };
}

/**
 * A point occupies a continuous stretch (classification rule 2): a unit discarded between the first and the last unit of a group
 * belongs to that group. Applied after the classification, by set arithmetic alone: no text is read. When the spans of several
 * groups contain the unit (interleaved points), it goes to the group with the closest member.
 * @param {{unit_ids: number[]}[]} groups
 * @param {{unit_ids: number[], reason: string}[]} discarded
 */
export function closeStretches(groups, discarded) {
  const spans = groups.map((g) => ({ min: Math.min(...g.unit_ids), max: Math.max(...g.unit_ids) }));
  const added = groups.map(() => []);
  const kept = [];
  for (const d of discarded) {
    const stay = [];
    for (const id of d.unit_ids) {
      let best = -1;
      let bestDistance = Infinity;
      groups.forEach((g, i) => {
        if (id <= spans[i].min || id >= spans[i].max) return;
        const distance = Math.min(...g.unit_ids.map((u) => Math.abs(u - id)));
        if (distance < bestDistance) { best = i; bestDistance = distance; }
      });
      if (best === -1) stay.push(id);
      else added[best].push(id);
    }
    if (stay.length > 0) kept.push({ ...d, unit_ids: stay });
  }
  return {
    groups: groups.map((g, i) => ({ ...g, unit_ids: [...g.unit_ids, ...added[i]].sort((a, b) => a - b) })),
    discarded: kept,
  };
}

/**
 * H-3728: a frame is evidence of what the person says while it is on screen. Each frame whose time falls inside a voice segment of
 * the same attachment goes to the group of that segment, so the same symptom does not end up in two messages (once said, once
 * seen). A frame whose segment was discarded, or that falls in a silence, stays where the model put it. Times and sets only.
 * @param {{unit_ids: number[]}[]} groups
 * @param {{unit_ids: number[], reason: string}[]} discarded
 * @param {{id: number, kind: string, time: string|null, source: object}[]} units
 */
export function anchorFrames(groups, discarded, units) {
  const owner = new Map();
  groups.forEach((g, i) => g.unit_ids.forEach((id) => owner.set(id, i)));
  const voices = units.filter((u) => u.kind === 'voice' && owner.has(u.id)).map((u) => ({ u, range: timeRange(u.time) })).filter((v) => v.range);
  const moves = new Map(); // frame id -> group index
  for (const f of units) {
    if (f.kind !== 'frame' || f.source.type !== 'attachment') continue;
    const at = timeRange(f.time)?.start;
    if (at === undefined) continue;
    // The latest segment that has started at the frame time and has not ended (a frame on a boundary goes with the one that starts).
    const holder = voices.filter((v) => v.u.source.attachment_id === f.source.attachment_id && v.range.start <= at && at <= v.range.end).at(-1);
    if (holder && owner.get(f.id) !== owner.get(holder.u.id)) moves.set(f.id, owner.get(holder.u.id));
  }
  if (moves.size === 0) return { groups, discarded, anchored: 0 };
  return {
    groups: groups.map((g, i) => ({ ...g, unit_ids: [...g.unit_ids.filter((id) => !moves.has(id)), ...[...moves].filter(([, gi]) => gi === i).map(([id]) => id)].sort((a, b) => a - b) })).filter((g) => g.unit_ids.length > 0),
    discarded: discarded.map((d) => ({ ...d, unit_ids: d.unit_ids.filter((id) => !moves.has(id)) })).filter((d) => d.unit_ids.length > 0),
    anchored: moves.size,
  };
}

/**
 * H-3728: a message the decomposition wrote from frames alone, in a group where the person speaks or writes, is not a request. It
 * joins the message that holds the closest unit after it (or before it), and its title travels in that message's `observed`,
 * outside the body. Sets over `unit_ids`; the title is moved as written, never read.
 * @param {{unit_ids: number[], title: string, observed?: string[]}[]} messages
 * @param {Set<number>} frameIds
 */
export function foldFrameMessages(messages, frameIds) {
  let current = messages.map((m) => ({ ...m, unit_ids: [...m.unit_ids], observed: [...(m.observed ?? [])] }));
  let folded = 0;
  for (;;) {
    const index = current.findIndex((m) => m.unit_ids.every((id) => frameIds.has(id)));
    if (index === -1 || current.every((m) => m.unit_ids.every((id) => frameIds.has(id)))) break;
    const seen = current[index];
    const rest = current.filter((_, i) => i !== index && !current[i].unit_ids.every((id) => frameIds.has(id)));
    const last = Math.max(...seen.unit_ids);
    const target = rest.find((m) => m.unit_ids.some((id) => id > last)) ?? rest.at(-1);
    target.unit_ids = [...target.unit_ids, ...seen.unit_ids].sort((a, b) => a - b);
    target.observed = [...target.observed, seen.title, ...seen.observed];
    current = current.filter((m) => m !== seen);
    folded += 1;
  }
  return { messages: current, folded };
}

/**
 * H-1902: a group made only of units with no content of their own (a speaker mark, a list number) would reach the
 * decomposition, whose rule 3 asks for one message per group, and come out as a message about the unit itself. The mark
 * introduces what follows it, so the group joins the group of the unit right after its last unit. When that unit belongs to no
 * group (it was discarded, or the mark is the last unit) the mark is discarded with it. Set arithmetic over `unit_ids`
 * and a predicate on the units already numbered; no text is read here.
 * @param {{unit_ids: number[], area_id: number, template_id: number}[]} groups
 * @param {{unit_ids: number[], reason: string}[]} discarded
 * @param {Set<number>} emptyIds  ids of the units that say nothing by themselves
 * @param {string} reason  discard reason for a mark that has no group to join
 */
export function foldEmptyGroups(groups, discarded, emptyIds, reason) {
  let current = groups.map((g) => ({ ...g, unit_ids: [...g.unit_ids] }));
  const dropped = [];
  let folded = 0;
  for (;;) {
    const index = current.findIndex((g) => g.unit_ids.every((id) => emptyIds.has(id)));
    if (index === -1) break;
    const mark = current[index];
    const next = Math.max(...mark.unit_ids) + 1;
    current = current.filter((_, i) => i !== index);
    const target = current.find((g) => g.unit_ids.includes(next));
    folded += 1;
    if (target) target.unit_ids = [...target.unit_ids, ...mark.unit_ids].sort((a, b) => a - b);
    else dropped.push(...mark.unit_ids);
  }
  if (folded === 0) return { groups, discarded, folded };
  return { groups: current, discarded: dropped.length > 0 ? [...discarded, { unit_ids: dropped.sort((a, b) => a - b), reason }] : discarded, folded };
}

/**
 * H-1902: units with no content of their own that no message cited (gaps) join the message of the unit right after them, or of
 * the one right before when nothing follows. Only meant for gaps made of such units: the rescue call would give them a
 * message about the unit itself. Set arithmetic over `unit_ids`.
 * @param {{unit_ids: number[]}[]} messages
 * @param {number[]} gaps
 * @param {Iterable<number>} scope
 */
export function closeEmptyGaps(messages, gaps, scope) {
  const order = [...scope].sort((a, b) => a - b);
  const owner = new Map();
  messages.forEach((m, i) => m.unit_ids.forEach((id) => owner.set(id, i)));
  const added = messages.map(() => []);
  const missing = new Set(gaps);
  order.forEach((id, at) => {
    if (!missing.has(id)) return;
    const after = order.slice(at + 1).find((x) => owner.has(x));
    const before = order.slice(0, at).reverse().find((x) => owner.has(x));
    const target = owner.get(after ?? before);
    if (target !== undefined) added[target].push(id);
  });
  return messages.map((m, i) => ({ ...m, unit_ids: [...m.unit_ids, ...added[i]].sort((a, b) => a - b) }));
}

/**
 * H-1902: a message whose units all say nothing by themselves (a speaker mark the rescue or the decomposition cited apart)
 * joins the message of the unit right after it, or of the one right before when nothing follows.
 * @param {{unit_ids: number[]}[]} messages
 * @param {Set<number>} emptyIds
 */
export function foldEmptyMessages(messages, emptyIds) {
  let current = messages.map((m) => ({ ...m, unit_ids: [...m.unit_ids] }));
  let folded = 0;
  for (;;) {
    const index = current.findIndex((m) => m.unit_ids.every((id) => emptyIds.has(id)));
    if (index === -1 || current.length === 1) break;
    const mark = current[index];
    const rest = current.filter((_, i) => i !== index);
    const next = Math.max(...mark.unit_ids) + 1;
    const target = rest.find((m) => m.unit_ids.includes(next))
      ?? rest.find((m) => m.unit_ids.some((id) => id > next))
      ?? rest.at(-1);
    target.unit_ids = [...target.unit_ids, ...mark.unit_ids].sort((a, b) => a - b);
    current = rest;
    folded += 1;
  }
  return { messages: current, folded };
}

/**
 * Last resort after the single rescue pass: restores exact coverage by set arithmetic alone. A unit cited by several messages
 * stays in the first one; a unit cited by none (and not discarded) joins the message of the closest unit before it, or after it
 * when it is the first. No text is read. Returns null when there is no message to receive a unit.
 * @param {{unit_ids: number[]}[]} messages
 * @param {{unit_ids: number[]}[]} discarded
 * @param {Iterable<number>} scope
 */
export function repairCoverage(messages, discarded, scope) {
  if (messages.length === 0) return null;
  const order = [...scope].sort((a, b) => a - b);
  const owner = new Map();
  messages.forEach((m, i) => m.unit_ids.forEach((id) => { if (!owner.has(id)) owner.set(id, i); }));
  const dropped = new Set(discarded.flatMap((d) => d.unit_ids).filter((id) => !owner.has(id)));
  const firstOwner = order.map((id) => owner.get(id)).find((i) => i !== undefined);
  let last = null;
  for (const id of order) {
    if (owner.has(id)) last = owner.get(id);
    else if (!dropped.has(id)) owner.set(id, last ?? firstOwner);
  }
  return {
    messages: messages.map((m, i) => ({ ...m, unit_ids: order.filter((id) => owner.get(id) === i) })).filter((m) => m.unit_ids.length > 0),
    discarded: discarded.map((d) => ({ ...d, unit_ids: d.unit_ids.filter((id) => !owner.has(id)) })).filter((d) => d.unit_ids.length > 0),
  };
}

/** References, empty texts and blank required fields of a message already validated in shape. */
function checkMessage(m, label, { fields, scope, memberIds, attachmentIds, errors }) {
  for (const id of m.unit_ids) if (!scope.has(id)) errors.push(`${label}: unit ${id} does not exist in this input`);
  for (const id of m.assignee_ids) if (!memberIds.has(id)) errors.push(`${label}: member ${id} does not exist`);
  for (const id of m.attachment_ids) if (!attachmentIds.has(id)) errors.push(`${label}: attachment ${id} does not belong to the input`);
  // «No empty message»: the schema requires a minimum length; here the whitespace-only texts are rejected.
  if (m.title.trim() === '') errors.push(`${label}: the title is empty`);
  // The value a field takes when the input does not answer it is not a title or a body: the point has no message to write.
  if (m.title.trim() === 'No indicado' || m.body.trim() === 'No indicado') errors.push(`${label}: the title or the body only says that there is no data`);
  if (m.body.trim() === '') errors.push(`${label}: the body is empty`);
  for (const f of fields) {
    if (f.required && typeof m.fields[f.name] === 'string' && m.fields[f.name].trim() === '') {
      errors.push(`${label}: the required field «${f.name}» is empty`);
    }
  }
}

/**
 * Validates a decomposition.
 *
 * `errors`  shape and references: retryable once with the error as context.
 * `conflicts` overlaps and gaps: they go to the rescue pass, not to the retry.
 *
 * @param {any} output  `{messages, discarded}`
 * @param {object} ctx
 * @param {{name: string, label: string, required: boolean}[]} ctx.fields  fields of the chosen template
 * @param {Set<number>} ctx.scope  units of this analysis (or of this chunk)
 * @param {Set<number>} ctx.memberIds
 * @param {Set<number>} ctx.attachmentIds  attachments of the input
 * @param {boolean} [ctx.requireMessage]  the group cannot end up without messages
 * @param {boolean} [ctx.withDiscarded]  false: the output carries no `discarded`
 */
export function validateDecomposition(output, { fields, scope, memberIds, attachmentIds, requireMessage = false, withDiscarded = true }) {
  const validate = compile(buildDecompositionSchema(fields, { validation: true, withDiscarded }));
  if (!validate(output)) {
    return { errors: formatAjvErrors(validate.errors), conflicts: { overlaps: [], gaps: [] } };
  }
  const errors = [];
  // The classification chose a group as a point of this template: it cannot end without a message.
  if (requireMessage && output.messages.length === 0) errors.push('the group produced no message: the classification chose it as a point of this template, so its units have to go in messages');
  output.messages.forEach((m, i) => checkMessage(m, `message ${i + 1}`, { fields, scope, memberIds, attachmentIds, errors }));
  const discarded = output.discarded ?? [];
  discarded.forEach((d, i) => {
    for (const id of d.unit_ids) if (!scope.has(id)) errors.push(`discard ${i + 1}: unit ${id} does not exist in this input`);
  });
  if (errors.length > 0) return { errors, conflicts: { overlaps: [], gaps: [] } };
  return { errors: [], conflicts: coverage(output.messages, discarded, scope) };
}

/**
 * Validates the whole proposal: messages of different groups, each against the fields of its own template,
 * and overlaps and gaps over the union of all groups (MASTER-SPEC §7.5).
 * @param {any} output  `{messages:[{area_id, template_id, …}], discarded}`
 * @param {object} ctx
 * @param {object[]} ctx.areas
 * @param {object[]} ctx.templates  bundle rows (id, area_id)
 * @param {Map<number, {name: string, label: string, required: boolean}[]>} ctx.fieldsByTemplate  fields of each template in use
 * @param {Set<number>} ctx.scope
 * @param {Set<number>} ctx.memberIds
 * @param {Set<number>} ctx.attachmentIds
 */
export function validateProposal(output, { templates, fieldsByTemplate, scope, memberIds, attachmentIds }) {
  const validate = compile(buildProposalSchema({ validation: true }));
  if (!validate(output)) return { errors: formatAjvErrors(validate.errors), conflicts: { overlaps: [], gaps: [] } };
  const errors = [];
  output.messages.forEach((m, i) => {
    const label = `message ${i + 1}`;
    const template = templates.find((t) => t.id === m.template_id);
    if (!template) {
      errors.push(`${label}: template ${m.template_id} does not exist`);
      return;
    }
    if (template.area_id !== m.area_id) errors.push(`${label}: template ${m.template_id} does not belong to area ${m.area_id}`);
    const fields = fieldsByTemplate.get(m.template_id);
    if (!fields) {
      errors.push(`${label}: template ${m.template_id} was not loaded`);
      return;
    }
    const fieldsValidate = compile(compileFieldsSchema(fields, { validation: true }));
    if (!fieldsValidate(m.fields)) {
      errors.push(...formatAjvErrors(fieldsValidate.errors).map((e) => `${label}, fields: ${e.replace(/^the output: /, '')}`));
      return;
    }
    checkMessage(m, label, { fields, scope, memberIds, attachmentIds, errors });
  });
  output.discarded.forEach((d, i) => {
    for (const id of d.unit_ids) if (!scope.has(id)) errors.push(`discard ${i + 1}: unit ${id} does not exist in this input`);
  });
  if (errors.length > 0) return { errors, conflicts: { overlaps: [], gaps: [] } };
  return { errors: [], conflicts: coverage(output.messages, output.discarded, scope) };
}

/** Validation context built from the bundle. */
export function contextFromBundle(bundle, { fields, scope }) {
  return {
    fields,
    scope: scope instanceof Set ? scope : new Set(scope),
    memberIds: idSet(bundle.members),
    attachmentIds: idSet(bundle.attachments),
  };
}

/** The «observed, not said» notes of a message, trimmed and without empty ones. */
const observedOf = (m) => (Array.isArray(m.observed) ? m.observed.filter((o) => typeof o === 'string' && o.trim() !== '').map((o) => o.trim()) : []);

/** Cleans a valid decomposition: no nulls, unique sorted ids, trimmed texts. */
export function normalizeDecomposition(output) {
  const sortedUnique = (ids) => [...new Set(ids)].sort((a, b) => a - b);
  const messages = output.messages.map((m) => ({
    ...(m.area_id === undefined ? {} : { area_id: m.area_id, template_id: m.template_id }),
    unit_ids: sortedUnique(m.unit_ids),
    title: m.title.trim(),
    body: m.body.trim(),
    fields: Object.fromEntries(Object.entries(m.fields).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v.trim()])),
    assignee_ids: sortedUnique(m.assignee_ids),
    attachment_ids: sortedUnique(m.attachment_ids),
    ...(m.source === 'frame' ? { source: 'frame' } : {}),
    ...(observedOf(m).length > 0 ? { observed: observedOf(m) } : {}),
  }));
  messages.sort((a, b) => a.unit_ids[0] - b.unit_ids[0] || a.title.localeCompare(b.title));
  const discarded = output.discarded
    .map((d) => ({ unit_ids: sortedUnique(d.unit_ids), reason: d.reason.trim() }))
    .sort((a, b) => a.unit_ids[0] - b.unit_ids[0]);
  return { messages, discarded };
}

/**
 * Validates the output of a worked message against what its template declares (UD-254 (5)). Shape only: the text the
 * harness wrote is not read. A template with no `output` block has nothing to check against: `errors` says so.
 * @param {any} output  the harness `structured_output`
 * @param {string | {output?: object[]|null} | object[]} markdownOrTemplate  as `compileOutputSchema` takes it
 * @returns {{errors: string[]}}
 */
export function validateOutput(output, markdownOrTemplate) {
  const schema = compileOutputSchema(markdownOrTemplate, { validation: true });
  if (!schema) return { errors: ['the template declares no output'] };
  const validate = compile(schema);
  if (!validate(output)) return { errors: formatAjvErrors(validate.errors) };
  if (output.summary.trim() === '') return { errors: ['the output: «summary» is empty'] };
  return { errors: [] };
}
