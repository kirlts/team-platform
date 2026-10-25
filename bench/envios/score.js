// Score of one send of the bank: how many messages came out against how many were expected, with which area, template, fields and
// attachments. Pure arithmetic over `unit_ids`, ids and the fields of the proposal; it never reads the prose the model wrote.
import { parseTemplate } from '../../src/analyze/templates.js';
import { score as meceScore } from '../score.js';

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * @param {{input: object, expected: object}} testCase
 * @param {{units: object[], proposal: object|null, templates: object[], status: string}} run
 */
export function scoreEnvio(testCase, { units, proposal, templates, status }) {
  const actual = proposal?.messages ?? [];
  const expected = testCase.expected.messages;
  const m = meceScore({ units, expected: { messages: expected }, actual: proposal ?? { messages: [], discarded: [] } });

  // Each expected request is paired with the obtained message that holds most of its units.
  const pairs = expected.map((e) => {
    let best = null;
    actual.forEach((a, index) => {
      const hit = e.unit_ids.filter((id) => a.unit_ids.includes(id)).length;
      if (hit > 0 && (!best || hit > best.hit)) best = { a, index, hit };
    });
    return { e, best };
  });
  const attachmentsOf = (reqs) => new Set(reqs.flatMap((r) => r.attachment_ids));
  // The attachments that are evidence (an image, a document) must go with the messages they belong to; a voice or video source need not.
  const kindOf = new Map(testCase.input.attachments.map((x) => [x.id, x.kind]));
  const evidenceOf = (ids) => ids.filter((id) => !['audio', 'video'].includes(kindOf.get(id)));

  const areaOk = pairs.filter((p) => p.best && p.best.a.area_id === p.e.area_id).length;
  const templateOk = pairs.filter((p) => p.best && p.best.a.template_id === p.e.template_id).length;
  const attachmentsOk = pairs.filter((p) => {
    if (!p.best) return false;
    const got = p.best.a.attachment_ids ?? [];
    const required = evidenceOf(p.e.attachment_ids);
    const foreign = got.filter((id) => !p.e.attachment_ids.includes(id) && attachmentsOf(expected).has(id));
    return required.every((id) => got.includes(id)) && foreign.length === 0;
  }).length;

  // Required fields of the template of each obtained message, filled in.
  const required = (templateId) => {
    const row = templates.find((t) => t.id === templateId);
    return row ? parseTemplate(row.body_markdown, { source: `template ${row.id}` }).fields.filter((f) => f.required).map((f) => f.name) : [];
  };
  const fieldsOk = actual.filter((a) => required(a.template_id).every((name) => typeof a.fields?.[name] === 'string' && a.fields[name].trim() !== '')).length;

  // Order: the obtained messages follow the order of the first unit of each request.
  const indexes = pairs.map((p) => p.best?.index).filter((i) => i !== undefined);
  const ordered = indexes.every((x, i) => i === 0 || x > indexes[i - 1]);

  const countOk = actual.length === expected.length;
  const pass = status === 'ok' && countOk && m.mece && areaOk === expected.length && templateOk === expected.length && attachmentsOk === expected.length && fieldsOk === actual.length && ordered
    && sameSet(pairs.map((p) => p.best?.index ?? -1).sort(), actual.map((_, i) => i));
  return {
    status,
    expected: expected.length,
    got: actual.length,
    count_ok: countOk,
    mece: m.mece,
    coverage: m.coverage,
    fused: m.fused,
    split: m.split,
    area_ok: areaOk,
    template_ok: templateOk,
    attachments_ok: attachmentsOk,
    fields_ok: fieldsOk,
    ordered,
    pass,
  };
}

export function formatTable(rows) {
  const head = ['send', 'status', 'msgs got/exp', 'area', 'template', 'fields', 'attach', 'order', 'pass'];
  const line = (r) => [r.id, r.s.status, `${r.s.got}/${r.s.expected}`, `${r.s.area_ok}/${r.s.expected}`, `${r.s.template_ok}/${r.s.expected}`, `${r.s.fields_ok}/${r.s.got}`, `${r.s.attachments_ok}/${r.s.expected}`, r.s.ordered ? 'yes' : 'no', r.s.pass ? 'PASS' : 'FAIL'];
  const all = [head, ...rows.map(line)];
  const widths = head.map((_, i) => Math.max(...all.map((l) => String(l[i]).length)));
  return all.map((l) => l.map((c, i) => String(c).padEnd(widths[i])).join('  ')).join('\n');
}
