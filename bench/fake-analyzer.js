// Analizador falso para probar el banco sin red ni llaves.
// Cumple la firma de MASTER-SPEC §7.5 y llama a un proveedor falso con la forma de §7.6
// (providers.text.complete → { json, usage }), de modo que exercita onProgress y onCall.
//
// Modos:
//   perfect  devuelve exactamente la descomposición esperada.
//   noisy    la corrompe de forma determinista: fusiona los dos primeros mensajes, parte el tercero,
//            repite una unidad en otro mensaje, agrega un mensaje de más y quita el último.

// Precios de lista de Haiku 5.5 por millón de tokens (MASTER-SPEC §3, fila "Modelo: texto, visión y PDF").
export const PRICE_PER_MTOK = { input: 0.1, output: 0.5, cached: 0.01 };

const cost = ({ input_tokens, output_tokens, cached_tokens }) =>
  (input_tokens * PRICE_PER_MTOK.input + output_tokens * PRICE_PER_MTOK.output + cached_tokens * PRICE_PER_MTOK.cached) / 1e6;

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

/** Convierte lo esperado en la salida que daría un modelo, aplicando el modo. */
export function decompositionFor(expected, mode) {
  let messages = expected.messages.map((m) => ({ title: m.title, unit_ids: [...m.unit_ids] }));
  let discarded = expected.discarded.map((d) => ({ ...d }));
  if (mode === 'noisy') {
    if (messages.length >= 2) {
      const [a, b, ...rest] = messages;
      messages = [{ title: `${a.title} / ${b.title}`, unit_ids: [...a.unit_ids, ...b.unit_ids] }, ...rest];
    }
    if (messages.length >= 3 && messages[2].unit_ids.length >= 2) {
      const [x, ...tail] = messages[2].unit_ids;
      messages.splice(2, 1, { title: messages[2].title, unit_ids: [x] }, { title: `${messages[2].title} (resto)`, unit_ids: tail });
    }
    if (messages.length >= 4) messages.pop();
    if (messages.length >= 2 && messages[0].unit_ids.length > 0) {
      messages[messages.length - 1].unit_ids.push(messages[0].unit_ids[0]);
    }
    if (discarded.length > 0) {
      const [d, ...others] = discarded;
      messages.push({ title: 'Mensaje de más', unit_ids: [d.unit_id] });
      discarded = others;
    }
  }
  return { messages, discarded };
}

/**
 * Proveedor de texto falso. Responde a dos tipos de llamada según el esquema: clasificar (área y
 * plantilla) y descomponer. Los tokens son el largo en caracteres del texto enviado: un relleno
 * determinista, no una estimación del tokenizador.
 */
export function createFakeProvider({ expected, mode = 'perfect', latencyMs = 0, model = 'fake-model' }) {
  const area = Array.isArray(expected.area) ? expected.area[0] : expected.area;
  const template = Array.isArray(expected.template) ? expected.template[0] : expected.template;
  return {
    text: {
      async complete({ system, messages, schema }) {
        await sleep(latencyMs);
        const sent = system.length + JSON.stringify(messages).length;
        const classify = !schema?.properties?.messages;
        const json = classify ? { area_id: area, template_id: template } : decompositionFor(expected, mode);
        const output = JSON.stringify(json).length;
        const usage = {
          provider: 'fake',
          model,
          modality: 'text',
          input_tokens: sent,
          output_tokens: output,
          cached_tokens: classify ? 0 : system.length,
          duration_ms: latencyMs,
        };
        usage.cost_usd = cost(usage);
        return { json, usage };
      },
    },
  };
}

/** Analizador con las dos llamadas de la variante A (§7.5): clasificar y descomponer. */
export function createFakeAnalyze({ expected, mode = 'perfect', latencyMs = 0 }) {
  const providers = createFakeProvider({ expected, mode, latencyMs });
  return async function analyze(bundle, { onProgress = () => {}, onCall = () => {} } = {}) {
    const system = 'Eres el analizador de team-platform (relleno del banco).';
    onProgress({ percent: 10, phrase: 'clasificando', at: Date.now() });
    const first = await providers.text.complete({
      system,
      messages: [{ role: 'user', content: bundle.text + JSON.stringify(bundle.attachments) }],
      schema: { properties: { area_id: {}, template_id: {} } },
      effort: 'low',
    });
    onCall(first.usage);
    onProgress({ percent: 40, phrase: 'descomponiendo', at: Date.now() });
    const second = await providers.text.complete({
      system,
      messages: [{ role: 'user', content: JSON.stringify(bundle.units) }],
      schema: { properties: { messages: {} } },
      effort: 'medium',
    });
    onCall(second.usage);
    onProgress({ percent: 90, phrase: 'validando', at: Date.now() });
    return {
      area_id: first.json.area_id,
      template_id: first.json.template_id,
      messages: second.json.messages.map((m) => ({ title: m.title, body: '', fields: {}, assignee_ids: [], attachment_ids: [], unit_ids: m.unit_ids })),
      discarded: second.json.discarded,
    };
  };
}
