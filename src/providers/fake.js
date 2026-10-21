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
import { createLimiter } from './limiter.js';
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
 * @param {{text?: any, vision?: any, speech?: any, textProfile?: string, name?: string, model?: string, limiter?: object, maxInflight?: number}} [scripts]
 *   `limiter` or `maxInflight` give the fake the semaphore of a real provider (default: its own, with no cap).
 */
export function createFakeProviders(scripts = {}) {
  const calls = { text: [], textFallback: [], vision: [], speech: [] };
  const identity = { name: scripts.name ?? 'fake', model: scripts.model ?? 'fake-model' };
  // Like a real client, every call takes a slot of the provider's limiter before it "goes out".
  const limiter = scripts.limiter ?? createLimiter({ name: identity.name, max: scripts.maxInflight ?? 0 });
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
        return limiter.run(() => materialize(nextText(req, n), req, n, identity));
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
        return limiter.run(() => materialize(nextVision(req, n), req, n, identity));
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
        const out = await limiter.run(() => materialize(nextSpeech(req, n), req, n, identity));
        return { text: '', segments: [], ...out };
      });
    },
  };
  return { text, textFallback, vision, speech, calls, limiter };
}

/**
 * A `fetch` that answers like the providers do, for tests and for the development server (UD-120). The key and the model
 * decide the answer, so a test provokes each failure by choosing the text it sends:
 *   key containing `fail-<cause>`  → that cause (invalid_key 401, no_quota 429 insufficient_quota, rate_limited 429,
 *                                    provider_error 503, bad_address 404, no_network a failed connection, timeout a
 *                                    request that never answers until its deadline);
 *   model containing `missing-model` → 404 for the model;
 *   anything else → 200, with the models `fake-model-a` and `fake-model-b`.
 * `requests` records what arrived (URL and method, never headers or bodies), so a test sees which calls were made.
 */
export function createFakeUpstream({ latencyMs = 0 } = {}) {
  const requests = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  async function fetchImpl(url, init = {}) {
    requests.push({ url: String(url), method: init.method ?? 'GET' });
    const headers = new Headers(init.headers);
    const key = headers.get('x-api-key') ?? (headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const failing = /fail-([a-z_]+)/.exec(key)?.[1];
    if (latencyMs) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    if (failing === 'timeout') {
      await new Promise((resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    }
    if (failing === 'no_network') throw new TypeError('fetch failed');
    const authentication = { error: { type: 'authentication_error', message: 'invalid x-api-key' } };
    if (failing === 'invalid_key') return json(401, authentication);
    if (failing === 'no_quota') return json(429, { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'quota' } });
    if (failing === 'rate_limited') return json(429, { error: { type: 'rate_limit_error', message: 'rate' } });
    if (failing === 'provider_error') return json(503, { error: { type: 'overloaded_error', message: 'overloaded' } });
    if (failing === 'bad_address') return json(404, { error: { message: 'not found' } });
    let model = null;
    try {
      model = JSON.parse(String(init.body ?? '{}')).model ?? null;
    } catch {
      model = null;
    }
    if (model && model.includes('missing-model')) return json(404, { error: { type: 'not_found_error', code: 'model_not_found', message: `model: ${model}` } });
    if (init.method === 'POST') return json(200, { id: 'fake', content: [{ type: 'text', text: 'ok' }], choices: [{ message: { content: 'ok' } }], usage: { input_tokens: 1, output_tokens: 1 } });
    return json(200, { data: ['fake-model-a', 'fake-model-b'].map((id) => ({ id })) });
  }
  return { fetchImpl, requests };
}
