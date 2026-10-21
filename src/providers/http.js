// Utilidades compartidas por las implementaciones: POST JSON con plazo, partes de contenido neutras.
import { readFile } from 'node:fs/promises';
import { ProviderHttpError, ProviderTimeoutError, ProviderConfigError } from './errors.js';

// Plazo de una llamada: la duración máxima de un trabajo es 900 s (MASTER-SPEC §7.3);
// una llamada no puede durar más que el trabajo que la contiene.
export const DEFAULT_TIMEOUT_MS = 900_000;

// 408, 409, 429 y 5xx (incluido 529 «overloaded» de Anthropic) se marcan reintentables;
// quién reintenta es la cola (max_attempts 3, §7.3), no el proveedor.
export function isRetryableStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function parseRetryAfter(headers) {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

function errorMessageFrom(body, status) {
  if (body && typeof body === 'object') {
    const msg = body.error?.message ?? body.message ?? body.error;
    if (typeof msg === 'string' && msg) return msg;
  }
  return `HTTP ${status}`;
}

/**
 * POST y lectura de la respuesta como JSON. Lanza ProviderHttpError o ProviderTimeoutError.
 * @returns {Promise<{status: number, json: any, headers: Headers, duration_ms: number}>}
 */
export async function postRequest(url, { headers, body, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, provider, model }) {
  const started = performance.now();
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
    throw new ProviderHttpError(`${provider}: fallo de red (${cause?.message ?? cause})`, {
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
    throw new ProviderHttpError(`${provider}: ${errorMessageFrom(json, response.status)}`, {
      provider,
      model,
      duration_ms,
      status: response.status,
      retryable: isRetryableStatus(response.status),
      retryAfterMs: parseRetryAfter(response.headers),
      body: json ?? text.slice(0, 2000),
    });
  }
  return { status: response.status, json, headers: response.headers, duration_ms, raw: text };
}

/** Normaliza `content` (cadena o lista de partes) a lista de partes neutras. */
export function toParts(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) return content;
  throw new ProviderConfigError('El contenido de un mensaje debe ser una cadena o una lista de partes');
}

/** Devuelve el contenido binario de una parte (`data` en base64 o Buffer, o `path` en disco) como base64. */
export async function partToBase64(part) {
  if (part.data !== undefined && part.data !== null) {
    return Buffer.isBuffer(part.data) ? part.data.toString('base64') : String(part.data);
  }
  if (part.path) return (await readFile(part.path)).toString('base64');
  throw new ProviderConfigError(`La parte ${part.type} necesita «data» o «path»`);
}

/** `system` admite una cadena o una lista de cadenas; vacío si no hay. */
export function systemBlocks(system) {
  if (system === undefined || system === null) return [];
  const list = Array.isArray(system) ? system : [system];
  return list.map((s) => String(s)).filter((s) => s.length > 0);
}
