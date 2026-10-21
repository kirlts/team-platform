// OpenAI-compatible provider (DeepSeek, Groq, OpenRouter, Gemini through its compatible endpoint).
// MASTER-SPEC §3 and §7.6; schema shapes per provider in report 02 §1.2 to §1.4.
//
// Three structured-output modes (`structured`):
//  - `json_schema`: `response_format` with a strict schema (OpenAI guide, report 02 [F9]).
//  - `tool`: a strict tool the model must call; it is the only way to get a schema
//    on DeepSeek, and only on its beta endpoint (report 02 [F12]).
//  - `json_object`: JSON mode without a schema in the grammar; the schema is written in the prompt
//    and the output is validated here with Ajv (report 02 [F11]: DeepSeek has no `json_schema`).
import Ajv from 'ajv';
import {
  ProviderConfigError,
  ProviderMaxTokensError,
  ProviderOutputError,
  ProviderRefusalError,
  ProviderUnsupportedError,
} from './errors.js';
import { DEFAULT_TIMEOUT_MS, partToBase64, postRequest, systemBlocks, toParts } from './http.js';
import { limiterFor } from './limiter.js';
import { withGenAiCall } from '../telemetry/api.js';

// Addresses and modes of each provider, from each one's documentation consulted for
// report 02 (2026-10-20). The default mode of each preset could not be tested with a real
// key: it is confirmed when the provider is added (report 02 §8: the seed and the temperature of
// DeepSeek and OpenAI are current, to be tested when adding the provider).
export const OPENAI_COMPATIBLE_PRESETS = Object.freeze({
  deepseek: { baseUrl: 'https://api.deepseek.com/beta', keyVar: 'DEEPSEEK_API_KEY', model: 'deepseek-flash', structured: 'tool' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyVar: 'GROQ_API_KEY', model: null, structured: 'json_schema' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyVar: 'OPENROUTER_API_KEY', model: null, structured: 'json_schema' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyVar: 'GEMINI_API_KEY', model: null, structured: 'json_schema' },
  'openai-compatible': { baseUrl: null, keyVar: 'OPENAI_COMPATIBLE_API_KEY', model: null, structured: 'json_schema' },
});

const STRUCTURED_MODES = new Set(['json_schema', 'tool', 'json_object']);
const TOOL_NAME = 'respond';

const ajv = new Ajv({ allErrors: true, strict: false });

function jsonObjectInstruction(schema) {
  // DeepSeek requires the word «json» and an example of the format in the prompt (report 02 [F11]).
  return [
    'Respond only with a valid JSON object, with no text before or after it.',
    'The JSON object must conform to this JSON schema:',
    JSON.stringify(schema),
  ].join('\n');
}

async function toOpenAIContent(content, provider, model) {
  const parts = toParts(content);
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text;
  const out = [];
  for (const part of parts) {
    if (part.type === 'text') {
      out.push({ type: 'text', text: part.text });
    } else if (part.type === 'image') {
      out.push({ type: 'image_url', image_url: { url: `data:${part.mime};base64,${await partToBase64(part)}` } });
    } else if (part.type === 'document') {
      // DeepSeek Flash does not accept PDF (report 01 §2): it is extracted to text beforehand (UD-009).
      throw new ProviderUnsupportedError(`${provider}: este proveedor no lee documentos nativos; extraerlos a texto antes`, { provider, model });
    } else {
      throw new ProviderConfigError(`${provider}: tipo de parte desconocido «${part.type}»`, { provider, model });
    }
  }
  return out;
}

function mapUsage(u = {}) {
  // OpenAI counts cached tokens inside prompt_tokens; DeepSeek separates them.
  // Normalized to Anthropic's convention: input_tokens excludes what was read from the cache.
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0;
  const prompt = u.prompt_tokens ?? 0;
  return {
    input_tokens: Math.max(0, prompt - cached),
    output_tokens: u.completion_tokens ?? 0,
    cached_tokens: cached,
  };
}

/**
 * @param {object} cfg
 * @param {string} cfg.name preset name (deepseek, groq, openrouter, gemini, openai-compatible)
 * @param {string} cfg.apiKey
 * @param {string} cfg.model
 * @param {string} cfg.baseUrl
 * @param {'json_schema'|'tool'|'json_object'} [cfg.structured]
 * @param {string} [cfg.effortParam] name of the provider's parameter for effort (for example `reasoning_effort`); omitted = not sent
 * @param {object} [cfg.extraBody] fixed fields merged into the body
 * @param {number} [cfg.maxTokens]
 * @param {number} [cfg.timeoutMs]
 * @param {typeof fetch} [cfg.fetchImpl]
 * @param {ReturnType<typeof import('./limiter.js').createLimiter>} [cfg.limiter] default: the process-wide one of this provider
 */
export function createOpenAICompatibleClient(cfg) {
  const provider = cfg?.name ?? 'openai-compatible';
  if (!cfg?.apiKey) throw new ProviderConfigError(`${provider}: falta la llave`, { provider });
  if (!cfg.baseUrl) throw new ProviderConfigError(`${provider}: falta la dirección base`, { provider });
  if (!cfg.model) throw new ProviderConfigError(`${provider}: falta el modelo`, { provider });
  const structured = cfg.structured ?? 'json_schema';
  if (!STRUCTURED_MODES.has(structured)) {
    throw new ProviderConfigError(`${provider}: modo de salida estructurada desconocido «${structured}»`, { provider });
  }
  const model = cfg.model;
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limiter = cfg.limiter ?? limiterFor(provider); // simultaneous requests of the process to this provider (limiter.js, H-83)
  const defaultMaxTokens = cfg.maxTokens ?? 16_000; // same provisional value as the default provider (report 02 §10.2)

  // One span per call with the full input and output (UD-014, MASTER-SPEC §7.10 bis).
  const call = (req, modality = 'text') => withGenAiCall({ provider, model, modality, request: req }, () => rawCall(req));

  async function rawCall({ system, messages, schema, effort, maxTokens }) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new ProviderConfigError(`${provider}: «messages» no puede estar vacío`, { provider, model });
    }
    const max_tokens = maxTokens ?? defaultMaxTokens;
    const sys = systemBlocks(system);
    if (schema && structured === 'json_object') sys.push(jsonObjectInstruction(schema));
    const wire = [];
    if (sys.length > 0) wire.push({ role: 'system', content: sys.join('\n\n') });
    for (const m of messages) wire.push({ role: m.role, content: await toOpenAIContent(m.content, provider, model) });

    const body = { ...(cfg.extraBody ?? {}), model, messages: wire, max_tokens };
    if (effort && cfg.effortParam) body[cfg.effortParam] = effort;
    if (schema && structured === 'json_schema') {
      body.response_format = { type: 'json_schema', json_schema: { name: 'response', strict: true, schema } };
    } else if (schema && structured === 'tool') {
      body.tools = [{ type: 'function', function: { name: TOOL_NAME, description: 'Delivers the final answer in the requested format.', strict: true, parameters: schema } }];
      body.tool_choice = { type: 'function', function: { name: TOOL_NAME } };
    } else if (schema && structured === 'json_object') {
      body.response_format = { type: 'json_object' };
    }

    // The slot is held only around the request: the body above is already built.
    const res = await limiter.run(() => postRequest(`${baseUrl}/chat/completions`, {
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}`, ...(cfg.headers ?? {}) },
      body: JSON.stringify(body),
      timeoutMs,
      fetchImpl: cfg.fetchImpl,
      provider,
      model,
    }));

    const data = res.json ?? {};
    const choice = data.choices?.[0] ?? {};
    const message = choice.message ?? {};
    const usage = mapUsage(data.usage);
    const meta = { provider, model: data.model ?? model, usage, duration_ms: res.duration_ms };

    if (message.refusal || choice.finish_reason === 'content_filter') {
      throw new ProviderRefusalError(`${provider}: el modelo rechazó la solicitud`, {
        ...meta,
        category: choice.finish_reason === 'content_filter' ? 'content_filter' : null,
        explanation: typeof message.refusal === 'string' ? message.refusal : null,
      });
    }
    if (choice.finish_reason === 'length') {
      throw new ProviderMaxTokensError(`${provider}: la salida se cortó en ${max_tokens} tokens`, { ...meta, maxTokens: max_tokens });
    }

    const toolArgs = message.tool_calls?.[0]?.function?.arguments;
    const text = typeof toolArgs === 'string' ? toolArgs : (message.content ?? '');
    const result = { text, usage, duration_ms: res.duration_ms, provider, model: meta.model, stop_reason: choice.finish_reason ?? null };
    if (schema) {
      // DeepSeek «puede devolver contenido vacío ocasionalmente» in JSON mode (report 02 [F11]).
      if (!text.trim()) throw new ProviderOutputError(`${provider}: respuesta vacía`, { ...meta, raw: '' });
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (cause) {
        throw new ProviderOutputError(`${provider}: la salida no es JSON`, { ...meta, raw: text.slice(0, 2000), cause });
      }
      if (structured === 'json_object') {
        const validate = ajv.compile(schema);
        if (!validate(parsed)) {
          const errors = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
          throw new ProviderOutputError(`${provider}: la salida no cumple el esquema`, { ...meta, raw: text.slice(0, 2000), errors });
        }
      }
      result.json = parsed;
    }
    return result;
  }

  return {
    name: provider,
    model,
    // These servers require all properties to be required; optional is emulated with `null` (report 02 §1.4).
    schemaProfile: 'all-required',
    structured,
    complete: (req) => call(req),
    describe({ images, prompt, schema, system, effort, maxTokens }) {
      if (!Array.isArray(images) || images.length === 0) {
        throw new ProviderConfigError(`${provider}: describe necesita al menos una imagen`, { provider, model });
      }
      const parts = images.map((img) => ({ type: img.mime === 'application/pdf' ? 'document' : 'image', ...img }));
      return call({ system, messages: [{ role: 'user', content: [...parts, { type: 'text', text: prompt }] }], schema, effort, maxTokens }, 'vision');
    },
  };
}
