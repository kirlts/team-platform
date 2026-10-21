// Fake provider for tests: pre-written responses, recorded calls.
//
//   const fake = createFakeProviders({ text: [ {json: {...}}, new ProviderRefusalError('x') ] });
//   await analyze(bundle, { providers: fake });
//   fake.calls.text  // what each call received
//
// `textFallback` (optional) is the script of the fallback text provider; without it `textFallback` is null.
// Each script (text, vision, speech) can be a function `(req, n) => response` or a list
// consumed in order. A response is: an Error (thrown), a function, `{json}`, `{text}`
// or any other object (taken as `json`). The fields `usage`, `duration_ms`, `provider`
// and `model` are filled in if missing, with the shape of the §7.6 contract.
import { withGenAiCall } from '../telemetry/api.js';

function defaultUsage() {
  return { input_tokens: 10, output_tokens: 5, cached_tokens: 0 };
}

function resolver(slotName, script) {
  if (script === undefined) {
    return () => {
      throw new Error(`fake: slot «${slotName}» has no script`);
    };
  }
  if (typeof script === 'function') return script;
  const queue = [...script];
  return () => {
    if (queue.length === 0) throw new Error(`fake: the responses of «${slotName}» ran out`);
    return queue.shift();
  };
}

async function materialize(response, req, n, identity) {
  let value = await response; // the script may be asynchronous
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
  const calls = { text: [], textFallback: [], vision: [], speech: [] };
  const identity = { name: scripts.name ?? 'fake', model: scripts.model ?? 'fake-model' };
  const nextText = resolver('text', scripts.text);
  const nextFallback = resolver('textFallback', scripts.textFallback);
  const nextVision = resolver('vision', scripts.vision);
  const nextSpeech = resolver('speech', scripts.speech);

  const text = {
    ...identity,
    schemaProfile: scripts.textProfile ?? 'anthropic',
    // Like the real providers, it leaves one span per call (UD-014): so tests and the bench with
    // the fake provider produce the same tree as production.
    complete(req) {
      return withGenAiCall({ provider: identity.name, model: identity.model, modality: 'text', request: req }, async () => {
        const n = calls.text.length;
        calls.text.push(structuredClone(req));
        return materialize(nextText(req, n), req, n, identity);
      });
    },
  };
  // The fallback slot exists only when the test gives it a script, as in the real providers (null when not configured).
  const fallbackIdentity = { name: `${identity.name}-fallback`, model: `${identity.model}-fallback` };
  const textFallback = scripts.textFallback === undefined ? null : {
    ...fallbackIdentity,
    schemaProfile: scripts.textProfile ?? 'anthropic',
    complete(req) {
      return withGenAiCall({ provider: fallbackIdentity.name, model: fallbackIdentity.model, modality: 'text', request: req }, async () => {
        const n = calls.textFallback.length;
        calls.textFallback.push(structuredClone(req));
        return materialize(nextFallback(req, n), req, n, fallbackIdentity);
      });
    },
  };
  const vision = {
    ...identity,
    describe(req) {
      return withGenAiCall({ provider: identity.name, model: identity.model, modality: 'vision', request: req }, async () => {
        const n = calls.vision.length;
        calls.vision.push(structuredClone(req));
        return materialize(nextVision(req, n), req, n, identity);
      });
    },
  };
  const speech = {
    ...identity,
    transcribe(req) {
      const request = { language: 'es', ...req };
      return withGenAiCall({ provider: identity.name, model: identity.model, modality: 'speech', operation: 'transcription', request }, async () => {
        const n = calls.speech.length;
        calls.speech.push(structuredClone(req));
        const out = await materialize(nextSpeech(req, n), req, n, identity);
        return { text: '', segments: [], ...out };
      });
    },
  };
  return { text, textFallback, vision, speech, calls };
}
