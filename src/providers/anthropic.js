// Proveedor Anthropic: Messages nativo por `fetch`, sin SDK (MASTER-SPEC §3 y §7.6).
//
// Por qué sin SDK: el contrato de §7.6 usa cuatro campos de la API (system, messages,
// output_config, usage). `fetch` alcanza, no suma una dependencia y deja que las pruebas
// levanten un servidor HTTP local en vez de simular un cliente.
//
// Reglas del modelo por omisión (Claude Haiku 5.5, informe 02 §1.1 y guía de migración):
//  - `temperature`, `top_p` y `top_k` no se envían: otro valor devuelve 400 (informe 02 [F3]).
//  - Sin `prefill`: el último mensaje es siempre del usuario.
//  - Salida estructurada con `output_config.format` de tipo `json_schema` [F1]; el esquema
//    de la gramática exige `additionalProperties: false` y no admite `minLength`/`maxItems`.
//  - `effort` va dentro de `output_config`, no en el nivel superior.
//  - El prompt de sistema lleva `cache_control` (mínimo cacheable de Haiku 5.5: 512 tokens [F2]).
import {
  ProviderConfigError,
  ProviderMaxTokensError,
  ProviderOutputError,
  ProviderRefusalError,
} from './errors.js';
import { DEFAULT_TIMEOUT_MS, partToBase64, postRequest, systemBlocks, toParts } from './http.js';

export const ANTHROPIC_DEFAULTS = Object.freeze({
  baseUrl: 'https://api.anthropic.com',
  // Modelo por omisión de MASTER-SPEC §3.
  model: 'claude-haiku-5-5',
  apiVersion: '2023-06-01',
  // Valor por omisión de §10.2 del informe 02: provisional 16.000 (el banco fija el p95 real).
  maxTokens: 16_000,
  // Vida de la caché de prompt: 5 minutos por omisión, 1 hora si el acierto medido es bajo (informe 02 §10.2 [F2]).
  cacheTtl: '5m',
});

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// Anthropic propone esta línea cuando el pensamiento está apagado y la salida es JSON:
// subió la proporción de JSON completos y correctos en `low` y `medium` (informe 02 §10.2, F4).
const JSON_FINAL_ANSWER_LINE = 'The JSON output format applies to your final answer only.';

function buildSystem(blocks, { cacheTtl, thinking }) {
  const list = [...blocks];
  if (thinking === 'disabled') list.push(JSON_FINAL_ANSWER_LINE);
  if (list.length === 0) return undefined;
  // El punto de caché va en el último bloque: todo el prefijo estable se cachea (prefijo exacto, [F2]).
  const cacheControl = cacheTtl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
  return list.map((text, i) => (i === list.length - 1 ? { type: 'text', text, cache_control: cacheControl } : { type: 'text', text }));
}

async function toAnthropicContent(content, provider) {
  const out = [];
  for (const part of toParts(content)) {
    if (part.type === 'text') {
      out.push({ type: 'text', text: part.text });
    } else if (part.type === 'image') {
      out.push({ type: 'image', source: { type: 'base64', media_type: part.mime, data: await partToBase64(part) } });
    } else if (part.type === 'document') {
      // PDF nativo: bloque `document` en base64 (600 páginas por solicitud con contexto de 1M; informe 01 §2).
      out.push({ type: 'document', source: { type: 'base64', media_type: part.mime ?? 'application/pdf', data: await partToBase64(part) } });
    } else {
      throw new ProviderConfigError(`${provider}: tipo de parte desconocido «${part.type}»`);
    }
  }
  return out;
}

/**
 * @param {object} cfg
 * @param {string} cfg.apiKey
 * @param {string} [cfg.model]
 * @param {string} [cfg.baseUrl]
 * @param {'5m'|'1h'} [cfg.cacheTtl]
 * @param {'disabled'|undefined} [cfg.thinking] omitido = pensamiento adaptativo del modelo
 * @param {number} [cfg.timeoutMs]
 * @param {number} [cfg.maxTokens] valor por omisión de `complete`
 * @param {typeof fetch} [cfg.fetchImpl]
 */
export function createAnthropicClient(cfg) {
  if (!cfg?.apiKey) throw new ProviderConfigError('anthropic: falta la llave (ANTHROPIC_API_KEY)', { provider: 'anthropic' });
  const model = cfg.model ?? ANTHROPIC_DEFAULTS.model;
  const baseUrl = (cfg.baseUrl ?? ANTHROPIC_DEFAULTS.baseUrl).replace(/\/+$/, '');
  const cacheTtl = cfg.cacheTtl ?? ANTHROPIC_DEFAULTS.cacheTtl;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultMaxTokens = cfg.maxTokens ?? ANTHROPIC_DEFAULTS.maxTokens;
  const provider = 'anthropic';

  async function call({ system, messages, schema, effort, maxTokens, cacheTtl: callCacheTtl }) {
    if (effort !== undefined && !EFFORTS.has(effort)) {
      throw new ProviderConfigError(`anthropic: esfuerzo inválido «${effort}»`, { provider, model });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new ProviderConfigError('anthropic: «messages» no puede estar vacío', { provider, model });
    }
    const max_tokens = maxTokens ?? defaultMaxTokens;
    const body = {
      model,
      max_tokens,
      messages: await Promise.all(messages.map(async (m) => ({ role: m.role, content: await toAnthropicContent(m.content, provider) }))),
    };
    const sys = buildSystem(systemBlocks(system), { cacheTtl: callCacheTtl ?? cacheTtl, thinking: cfg.thinking });
    if (sys) body.system = sys;
    if (cfg.thinking === 'disabled') body.thinking = { type: 'disabled' };
    const outputConfig = {};
    if (schema) outputConfig.format = { type: 'json_schema', schema };
    if (effort) outputConfig.effort = effort;
    if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;

    const res = await postRequest(`${baseUrl}/v1/messages`, {
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': cfg.apiVersion ?? ANTHROPIC_DEFAULTS.apiVersion,
      },
      body: JSON.stringify(body),
      timeoutMs,
      fetchImpl: cfg.fetchImpl,
      provider,
      model,
    });

    const msg = res.json ?? {};
    const u = msg.usage ?? {};
    const usage = {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      // Lectura de caché; la escritura va aparte porque se cobra a otra tarifa (1,25x; informe 02 [F2]).
      cached_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_tokens: u.cache_creation_input_tokens ?? 0,
    };
    const meta = { provider, model: msg.model ?? model, usage, duration_ms: res.duration_ms };

    if (msg.stop_reason === 'refusal') {
      throw new ProviderRefusalError(`anthropic: el modelo rechazó la solicitud (${msg.stop_details?.category ?? 'sin categoría'})`, {
        ...meta,
        category: msg.stop_details?.category ?? null,
        explanation: msg.stop_details?.explanation ?? null,
      });
    }
    if (msg.stop_reason === 'max_tokens') {
      throw new ProviderMaxTokensError(`anthropic: la salida se cortó en ${max_tokens} tokens`, { ...meta, maxTokens: max_tokens });
    }

    const text = (msg.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const result = { text, usage, duration_ms: res.duration_ms, provider, model: meta.model, stop_reason: msg.stop_reason ?? null, request_id: res.headers.get('request-id') };
    if (schema) {
      try {
        result.json = JSON.parse(text);
      } catch (cause) {
        throw new ProviderOutputError('anthropic: la salida no es JSON', { ...meta, raw: text.slice(0, 2000), cause });
      }
    }
    return result;
  }

  return {
    name: provider,
    model,
    schemaProfile: 'anthropic',
    /** providers.text.complete: devuelve `json` si hay esquema, si no `text`. */
    complete: (req) => call(req),
    /** providers.vision.describe: imágenes (y PDF) como bloques, luego el prompt. */
    describe({ images, prompt, schema, system, effort, maxTokens, cacheTtl }) {
      if (!Array.isArray(images) || images.length === 0) {
        throw new ProviderConfigError('anthropic: describe necesita al menos una imagen', { provider, model });
      }
      const parts = images.map((img) => ({ type: img.mime === 'application/pdf' ? 'document' : 'image', ...img }));
      // Las imágenes van antes del texto: así lo recomienda la documentación de visión.
      return call({ system, messages: [{ role: 'user', content: [...parts, { type: 'text', text: prompt }] }], schema, effort, maxTokens, cacheTtl });
    },
  };
}
