// Proveedor falso para pruebas: respuestas escritas de antemano, llamadas registradas.
//
//   const fake = createFakeProviders({ text: [ {json: {...}}, new ProviderRefusalError('x') ] });
//   await analyze(bundle, { providers: fake });
//   fake.calls.text  // lo que recibió cada llamada
//
// Cada guion (text, vision, speech) puede ser una función `(req, n) => respuesta` o una lista
// consumida en orden. Una respuesta es: un Error (se lanza), una función, `{json}`, `{text}`
// u otro objeto cualquiera (se toma como `json`). Los campos `usage`, `duration_ms`, `provider`
// y `model` se completan si faltan, con la forma del contrato de §7.6.

function defaultUsage() {
  return { input_tokens: 10, output_tokens: 5, cached_tokens: 0 };
}

function resolver(slotName, script) {
  if (script === undefined) {
    return () => {
      throw new Error(`fake: la ranura «${slotName}» no tiene guion`);
    };
  }
  if (typeof script === 'function') return script;
  const queue = [...script];
  return () => {
    if (queue.length === 0) throw new Error(`fake: se agotaron las respuestas de «${slotName}»`);
    return queue.shift();
  };
}

async function materialize(response, req, n, identity) {
  let value = response;
  if (typeof value === 'function') value = await value(req, n);
  if (value instanceof Error) throw value;
  const hasShape = value && typeof value === 'object' && ('json' in value || 'text' in value || 'segments' in value);
  const base = hasShape ? value : { json: value };
  return { usage: defaultUsage(), duration_ms: 0, provider: identity.name, model: identity.model, ...base };
}

/**
 * @param {{text?: any, vision?: any, speech?: any, textProfile?: string, name?: string, model?: string}} [scripts]
 */
export function createFakeProviders(scripts = {}) {
  const calls = { text: [], vision: [], speech: [] };
  const identity = { name: scripts.name ?? 'fake', model: scripts.model ?? 'fake-model' };
  const nextText = resolver('text', scripts.text);
  const nextVision = resolver('vision', scripts.vision);
  const nextSpeech = resolver('speech', scripts.speech);

  const text = {
    ...identity,
    schemaProfile: scripts.textProfile ?? 'anthropic',
    async complete(req) {
      const n = calls.text.length;
      calls.text.push(structuredClone(req));
      return materialize(nextText(req, n), req, n, identity);
    },
  };
  const vision = {
    ...identity,
    async describe(req) {
      const n = calls.vision.length;
      calls.vision.push(structuredClone(req));
      return materialize(nextVision(req, n), req, n, identity);
    },
  };
  const speech = {
    ...identity,
    async transcribe(req) {
      const n = calls.speech.length;
      calls.speech.push(structuredClone(req));
      const out = await materialize(nextSpeech(req, n), req, n, identity);
      return { text: '', segments: [], ...out };
    },
  };
  return { text, vision, speech, calls };
}
