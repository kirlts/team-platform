// Minimal call to a provider to tell whether a key, an address and a model work (UD-120, report 11).
//
// One request of one output token (or, for transcription, the list of models) measures the duration and classifies the
// failure into a fixed set of causes. Nothing that comes from the provider is returned as text: only the cause, the HTTP
// status, the duration and the model identifiers, so an error body that echoes part of a key can never reach a response
// or a log. The key travels in a header and is never part of a result.
import { ANTHROPIC_DEFAULTS } from './anthropic.js';
import { GROQ_SPEECH_DEFAULTS } from './groq-speech.js';

export const CHECK_CAUSES = Object.freeze([
  'invalid_key', 'no_quota', 'model_not_found', 'no_network', 'rate_limited', 'timeout', 'bad_address', 'provider_error', 'unknown',
]);

/** Models returned to the panel; a provider with more (OpenRouter lists hundreds) is cut and the panel filters. */
const MAX_MODELS = 500; // the list is shown in a filterable view; OpenRouter's catalogue is the largest one known (report 11 §5)
const MODEL_PAGE = 100; // Anthropic's List Models accepts 1 to 1000 per page (report 11, W2); one page is enough to choose from

function trimBase(url) {
  return String(url).replace(/\/+$/, '');
}

function errorFields(body) {
  const error = body && typeof body === 'object' ? body.error : null;
  if (error && typeof error === 'object') return { type: String(error.type ?? ''), code: String(error.code ?? ''), message: String(error.message ?? '') };
  return { type: '', code: '', message: typeof error === 'string' ? error : '' };
}

/**
 * Cause of an unsuccessful HTTP response. The priority follows report 11 §6 point 6: authentication first, then quota
 * against rate (a 429 is either; the machine-readable `code`/`type` tells), then the model, then the server.
 * The `message` is read only for the two providers that say nothing else (Anthropic's spend limit arrives as a 400 and
 * DeepSeek's unknown model as a 400); it is never returned.
 */
export function classifyStatus(status, body) {
  const { type, code, message } = errorFields(body);
  const text = `${type} ${code}`.toLowerCase();
  if (status === 401 || status === 403) return 'invalid_key';
  if (status === 402) return 'no_quota';
  if (status === 429) return /quota|billing|credit|insufficient/.test(text) ? 'no_quota' : 'rate_limited';
  if (status === 404) return /model/.test(text) || type === 'not_found_error' ? 'model_not_found' : 'bad_address';
  if (status === 400) {
    if (/credit balance|spend limit|usage limit/i.test(message)) return 'no_quota';
    if (/model/.test(text) || /model/i.test(message) && /(exist|found|support|access)/i.test(message)) return 'model_not_found';
    return 'unknown';
  }
  if (status >= 500) return 'provider_error';
  return 'unknown';
}

async function request(fetchImpl, url, init, timeoutMs) {
  const started = performance.now();
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const duration_ms = Math.round(performance.now() - started);
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return { ok: false, cause: 'timeout', status: null, duration_ms, json: null };
    return { ok: false, cause: 'no_network', status: null, duration_ms, json: null };
  }
  let json = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  const duration_ms = Math.round(performance.now() - started);
  if (response.ok) return { ok: true, cause: null, status: response.status, duration_ms, json };
  return { ok: false, cause: classifyStatus(response.status, json), status: response.status, duration_ms, json };
}

function authHeaders(kind, apiKey) {
  if (kind === 'anthropic') return { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_DEFAULTS.apiVersion };
  return { authorization: `Bearer ${apiKey}` };
}

function endpoints(kind, baseUrl) {
  const base = trimBase(baseUrl);
  if (kind === 'anthropic') return { complete: `${base}/v1/messages`, models: `${base}/v1/models?limit=${MODEL_PAGE}` };
  // DeepSeek's chat endpoint lives under /beta for strict tools; its model list is one level up.
  return { complete: `${base}/chat/completions`, models: `${base.replace(/\/beta$/, '')}/models` };
}

function completionBody(model) {
  // The same body serves both families: one user message and one output token.
  return JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
}

/**
 * @param {object} spec
 * @param {'anthropic'|'openai-compatible'|'groq-speech'} spec.kind
 * @param {string} spec.apiKey
 * @param {string} [spec.baseUrl]       the provider's default when missing
 * @param {string} [spec.model]         without it only the list of models is requested
 * @param {number} spec.timeoutMs       deadline of each request (PROVIDER_PROBE_TIMEOUT_MS)
 * @param {typeof fetch} [spec.fetchImpl]
 * @returns {Promise<{ok: boolean, cause: string|null, status: number|null, duration_ms: number, model: string|null, models: string[]|null, model_listed: boolean|null, checked_at: string}>}
 */
export async function probeConnection(spec) {
  const { kind, apiKey, model = null, timeoutMs, fetchImpl = fetch } = spec;
  const checked_at = new Date().toISOString();
  const baseUrl = spec.baseUrl || (kind === 'anthropic' ? ANTHROPIC_DEFAULTS.baseUrl : kind === 'groq-speech' ? GROQ_SPEECH_DEFAULTS.baseUrl : '');
  const result = (core, models = null) => ({
    ok: core.ok, cause: core.cause, status: core.status, duration_ms: core.duration_ms, model,
    models, model_listed: models && model ? models.includes(model) : null, checked_at,
  });
  try {
    new URL(baseUrl);
  } catch {
    return result({ ok: false, cause: 'bad_address', status: null, duration_ms: 0 });
  }
  const urls = endpoints(kind, baseUrl);
  const headers = { ...authHeaders(kind, apiKey), 'content-type': 'application/json' };

  const lister = async () => {
    const listed = await request(fetchImpl, urls.models, { method: 'GET', headers }, timeoutMs);
    const data = listed.ok && Array.isArray(listed.json?.data) ? listed.json.data : null;
    return { listed, models: data ? data.map((m) => String(m?.id ?? '')).filter(Boolean).slice(0, MAX_MODELS) : null };
  };

  // A transcription model cannot be exercised without audio: the list of models proves the key, the address and the model.
  if (kind === 'groq-speech' || !model) {
    const { listed, models } = await lister();
    if (listed.ok && model && models && !models.includes(model)) return result({ ...listed, ok: false, cause: 'model_not_found' }, models);
    return result(listed, models);
  }

  const call = await request(fetchImpl, urls.complete, { method: 'POST', headers, body: completionBody(model) }, timeoutMs);
  // A rejected model or a working one is worth the list of what the provider does offer; a rejected key or a dead network is not.
  if (call.ok || call.cause === 'model_not_found') {
    const { models } = await lister();
    return result(call, models);
  }
  return result(call);
}
