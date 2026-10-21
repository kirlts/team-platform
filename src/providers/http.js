// Utilities shared by the implementations: JSON POST with a deadline, neutral content parts.
import { readFile } from 'node:fs/promises';
import { ProviderHttpError, ProviderTimeoutError, ProviderConfigError } from './errors.js';

// Deadline of a call: the maximum duration of a job is 900 s (MASTER-SPEC §7.3);
// a call cannot last longer than the job that contains it.
export const DEFAULT_TIMEOUT_MS = 900_000;

// 408, 409, 429 and 5xx (including Anthropic's 529 «overloaded») are marked retryable;
// who retries is the queue (max_attempts 3, §7.3), not the provider.
export function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function parseRetryAfter(headers) {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

const REDACTED = '«clave omitida»';
const MIN_SECRET_CHARS = 8; // shorter than any real key (the API refuses a shorter one): a shorter value would also blank ordinary words

/** The secrets a request carries in its headers: the key itself, with or without its `Bearer ` prefix. */
export function secretsOfHeaders(headers) {
  const out = [];
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!/^(x-api-key|authorization)$/i.test(name) || typeof value !== 'string') continue;
    out.push(value.replace(/^Bearer /i, ''));
  }
  return out.filter((secret) => secret.length >= MIN_SECRET_CHARS);
}

/**
 * Replaces every occurrence of a secret in a text, or inside the strings of an object, so that an error body that repeats
 * the key (some providers do) never reaches an error message, a job record or a span.
 */
export function redactSecrets(value, secrets) {
  if (!secrets?.length) return value;
  if (typeof value === 'string') return secrets.reduce((text, secret) => text.split(secret).join(REDACTED), value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactSecrets(v, secrets)]));
  return value;
}

function errorMessageFrom(body, status) {
  if (body && typeof body === 'object') {
    const msg = body.error?.message ?? body.message ?? body.error;
    if (typeof msg === 'string' && msg) return msg;
  }
  return `HTTP ${status}`;
}

/**
 * POST and read the response as JSON. Throws ProviderHttpError or ProviderTimeoutError.
 * @returns {Promise<{status: number, json: any, headers: Headers, duration_ms: number}>}
 */
export async function postRequest(url, { headers, body, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, provider, model }) {
  const started = performance.now();
  const secrets = secretsOfHeaders(headers);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const duration_ms = Math.round(performance.now() - started);
    if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') {
      throw new ProviderTimeoutError(`${provider}: la llamada superó ${timeoutMs} ms`, { provider, model, duration_ms, timeoutMs, cause });
    }
    throw new ProviderHttpError(redactSecrets(`${provider}: fallo de red (${cause?.message ?? cause})`, secrets), {
      provider, model, duration_ms, status: 0, retryable: true, cause,
    });
  }
  const text = await response.text();
  const duration_ms = Math.round(performance.now() - started);
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new ProviderHttpError(redactSecrets(`${provider}: ${errorMessageFrom(json, response.status)}`, secrets), {
      provider,
      model,
      duration_ms,
      status: response.status,
      retryable: isRetryableStatus(response.status),
      retryAfterMs: parseRetryAfter(response.headers),
      body: redactSecrets(json ?? text.slice(0, 2000), secrets),
    });
  }
  return { status: response.status, json, headers: response.headers, duration_ms, raw: text };
}

/** Normalizes `content` (string or list of parts) to a list of neutral parts. */
export function toParts(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) return content;
  throw new ProviderConfigError('El contenido de un mensaje debe ser una cadena o una lista de partes');
}

/** Returns the binary content of a part (`data` as base64 or Buffer, or `path` on disk) as base64. */
export async function partToBase64(part) {
  if (part.data !== undefined && part.data !== null) {
    return Buffer.isBuffer(part.data) ? part.data.toString('base64') : String(part.data);
  }
  if (part.path) return (await readFile(part.path)).toString('base64');
  throw new ProviderConfigError(`La parte ${part.type} necesita «data» o «path»`);
}

/** `system` accepts a string or a list of strings; empty if there is none. */
export function systemBlocks(system) {
  if (system === undefined || system === null) return [];
  const list = Array.isArray(system) ? system : [system];
  return list.map((s) => String(s)).filter((s) => s.length > 0);
}
