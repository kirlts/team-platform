// Fake providers to run the real analyzer without network or keys (src/providers/fake.js).
// They answer with a case's reference: the classification groups the expected units by area and
// template, and the decomposition returns each group's expected messages.
//
// Modes:
//   perfect  returns exactly the reference.
//   noisy    corrupts it deterministically: in the classification it changes the area of the first group;
//            in the decomposition it fuses the first two messages, splits the third, repeats a unit
//            and removes the last one. The real analyzer detects it and fails with `invalid`; the bench scores the draft.
import { createFakeProviders } from '../src/providers/fake.js';

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
const first = (v) => [].concat(v)[0];
const wrongAreaFor = (accepted) => [1, 2, 3, 4, 5].find((id) => !accepted.includes(id));

/** The unit numbers [uN] of the last message of a request that shows units (a retry message only lists errors). */
export function unitIdsIn(req) {
  for (const message of [...req.messages].reverse()) {
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    const ids = [...text.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1]));
    if (ids.length > 0) return ids;
  }
  return [];
}

function corrupt(messages) {
  const out = messages.map((m) => ({ ...m, unit_ids: [...m.unit_ids] }));
  if (out.length >= 2) {
    const [a, b, ...others] = out;
    out.splice(0, out.length, { ...a, title: `${a.title} / ${b.title}`, unit_ids: [...a.unit_ids, ...b.unit_ids] }, ...others);
  }
  if (out.length >= 3 && out[2].unit_ids.length >= 2) {
    const [x, ...tail] = out[2].unit_ids;
    out.splice(2, 1, { ...out[2], unit_ids: [x] }, { ...out[2], title: `${out[2].title} (resto)`, unit_ids: tail });
  }
  if (out.length >= 4) out.pop();
  if (out.length >= 2) out.at(-1).unit_ids.push(out[0].unit_ids[0]);
  return out;
}

/**
 * @param {{ expected: object, mode?: 'perfect'|'noisy', latencyMs?: number, model?: string }} options
 * @returns providers with the shape of §7.6 plus `calls`, like createFakeProviders
 */
export function createBenchProviders({ expected, mode = 'perfect', latencyMs = 0, model = 'claude-haiku-5-5' }) {
  const pairs = new Map(); // "area/template" → { area_id, template_id, unit_ids }
  expected.messages.forEach((m) => {
    const area_id = first(m.area_id);
    const template_id = first(m.template_id);
    const key = `${area_id}/${template_id}`;
    const group = pairs.get(key) ?? { area_id, template_id, accepted: [].concat(m.area_id), unit_ids: [] };
    group.unit_ids.push(...m.unit_ids);
    pairs.set(key, group);
  });
  const groups = [...pairs.values()].map((g) => ({ ...g, unit_ids: [...g.unit_ids].sort((a, b) => a - b) }));

  const respond = (json, req) => {
    const sent = [].concat(req.system ?? []).join('').length + JSON.stringify(req.messages).length;
    return {
      json,
      usage: { input_tokens: sent, output_tokens: JSON.stringify(json).length, cached_tokens: 0 },
      duration_ms: latencyMs,
    };
  };

  const script = async (req) => {
    await sleep(latencyMs);
    // Cut pass (UD-292): a perfect reader cuts exactly where the reference says (`expected.cuts`), in the units it was shown.
    if (req.schema.properties.cuts) {
      const scope = new Set(unitIdsIn(req));
      return respond({ cuts: (expected.cuts ?? []).filter((c) => scope.has(c.unit_id)) }, req);
    }
    if (req.schema.properties.groups) {
      // Only what the request shows: the analyzer also asks about a part of the units (second pass over what the first left out).
      const scope = new Set(unitIdsIn(req));
      const within = (ids) => ids.filter((id) => scope.has(id));
      const sent = groups
        .map((g, i) => ({
          unit_ids: within(g.unit_ids),
          requests: [g.request ?? 'pedido'],
          recap_unit_ids: [],
          area_id: mode === 'noisy' && i === 0 ? wrongAreaFor(g.accepted) : g.area_id,
          template_id: mode === 'noisy' && i === 0 ? wrongAreaFor(g.accepted) : g.template_id,
        }))
        .filter((g) => g.unit_ids.length > 0);
      const discarded = expected.discarded.map((d) => ({ ...d, unit_ids: within(d.unit_ids) })).filter((d) => d.unit_ids.length > 0);
      return respond({ split_at: [], groups: sent, discarded }, req);
    }
    // Split check of one written group: a perfect reader finds one request in it, so nothing is split.
    if (req.schema.properties.requests) return respond({ requests: [{ unit_ids: unitIdsIn(req), request: 'pedido' }] }, req);
    // Decomposition: the expected messages whose units are all within what was requested.
    const scope = new Set(unitIdsIn(req));
    const fieldProps = Object.keys(req.schema.properties.messages.items.properties.fields.properties ?? {});
    let messages = expected.messages
      .filter((m) => m.unit_ids.every((id) => scope.has(id)))
      .map((m) => ({
        unit_ids: [...m.unit_ids],
        title: m.title,
        fields: Object.fromEntries(fieldProps.map((name) => [name, 'dato de la referencia'])),
        body: `Cuerpo de «${m.title}».`,
        assignee_ids: [],
        attachment_ids: [...(m.attachment_ids ?? [])],
        // Where the reference skips units (the person talked about another request), the message resumes (H-3730).
        resumes_at: [...m.unit_ids].sort((a, b) => a - b).filter((id, i, ids) => i > 0 && id !== ids[i - 1] + 1),
        observed: [],
      }));
    if (mode === 'noisy') messages = corrupt(messages);
    return respond({ messages }, req);
  };

  return createFakeProviders({ text: script, name: 'fake', model });
}
