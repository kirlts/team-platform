// Proveedores falsos para correr el analizador real sin red ni llaves (src/providers/fake.js).
// Responden con la referencia de un caso: la clasificación agrupa las unidades esperadas por área y
// plantilla, y la descomposición devuelve los mensajes esperados de cada grupo.
//
// Modos:
//   perfect  devuelve exactamente la referencia.
//   noisy    la corrompe de forma determinista: en la clasificación cambia el área del primer grupo;
//            en la descomposición fusiona los dos primeros mensajes, parte el tercero, repite una unidad
//            y quita el último. El analizador real lo detecta y falla con `invalid`; el banco puntúa el borrador.
import { createFakeProviders } from '../src/providers/fake.js';

const sleep = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
const first = (v) => [].concat(v)[0];
const wrongAreaFor = (accepted) => [1, 2, 3, 4, 5].find((id) => !accepted.includes(id));

/** Los números de unidad [uN] del último mensaje de usuario de una solicitud. */
export function unitIdsIn(req) {
  const last = req.messages.at(-1);
  const text = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
  return [...text.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1]));
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
 * @returns proveedores con la forma de §7.6 más `calls`, como createFakeProviders
 */
export function createBenchProviders({ expected, mode = 'perfect', latencyMs = 0, model = 'claude-haiku-5-5' }) {
  const pairs = new Map(); // "área/plantilla" → { area_id, template_id, unit_ids }
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
    if (req.schema.properties.groups) {
      const sent = groups.map((g, i) => ({
        unit_ids: g.unit_ids,
        area_id: mode === 'noisy' && i === 0 ? wrongAreaFor(g.accepted) : g.area_id,
        template_id: mode === 'noisy' && i === 0 ? wrongAreaFor(g.accepted) : g.template_id,
      }));
      return respond({ groups: sent, discarded: expected.discarded.map((d) => ({ ...d })) }, req);
    }
    // Descomposición: los mensajes esperados cuyas unidades están todas en lo que se pidió.
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
        attachment_ids: [],
      }));
    if (mode === 'noisy') messages = corrupt(messages);
    return respond({ messages, discarded: [] }, req);
  };

  return createFakeProviders({ text: script, name: 'fake', model });
}
