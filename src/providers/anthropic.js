// Anthropic provider: native Messages over `fetch`, no SDK (MASTER-SPEC §3 and §7.6).
//
// Why no SDK: the §7.6 contract uses four API fields (system, messages,
// output_config, usage). `fetch` is enough, adds no dependency and lets tests
// start a local HTTP server instead of mocking a client.
//
// Rules of the default model (Claude Haiku 5.5, report 02 §1.1 and migration guide):
//  - `temperature`, `top_p` and `top_k` are not sent: any other value returns 400 (report 02 [F3]).
//  - No `prefill`: the last message is always from the user.
//  - Structured output with `output_config.format` of type `json_schema` [F1]; the grammar's
//    schema requires `additionalProperties: false` and does not support `minLength`/`maxItems`.
//  - `effort` goes inside `output_config`, not at the top level.
//  - The system prompt carries `cache_control` (Haiku 5.5 minimum cacheable: 512 tokens [F2]).
import {
  ProviderConfigError,
  ProviderMaxTokensError,
  ProviderOutputError,
  ProviderRefusalError,
} from './errors.js';
import { DEFAULT_TIMEOUT_MS, partToBase64, postRequest, postStream, systemBlocks, toParts } from './http.js';
import { currentJobScope, limiterFor } from './limiter.js';
import { minCacheableTokens, resolveThinkingAndEffort } from './anthropic-models.js';
import { prefixKey, processCacheWarmup } from './cache-warmup.js';
import { annotate, withGenAiCall } from '../telemetry/api.js';

export const ANTHROPIC_DEFAULTS = Object.freeze({
  baseUrl: 'https://api.anthropic.com',
  // Default model from MASTER-SPEC §3.
  model: 'claude-haiku-5-5',
  apiVersion: '2023-06-01',
  // Default from §10.2 of report 02: provisional 16,000 (the bench sets the real p95).
  maxTokens: 16_000,
  // Prompt cache lifetime: 5 minutes by default, 1 hour if the measured hit rate is low (report 02 §10.2 [F2]).
  cacheTtl: '5m',
  // Parallel calls with the same prefix: the first one opens a stream and the others leave when its response starts, so they read
  // the cache entry instead of writing it again (src/providers/cache-warmup.js; bench/cache-probe.mjs, 2026-10-23).
  cacheWarmup: true,
  // Longest wait of a follower for its leader. A leader answers its first event in 1.2 to 1.9 s (same probe); this is about ten times
  // that, so a leader that hangs delays the others by no more than this before they go as they did before.
  cacheWarmupMaxWaitMs: 15_000,
  // Characters per token to decide, before sending, whether the system prompt reaches the cacheable minimum. It is its own value: the
  // analyzer's `charsPerToken` (src/analyze/config.js) was measured on Spanish units (2.25), and this one counts the instructions of the
  // system prompt, which are not measured; 3 stays until `bench/calibrate.mjs` has runs that say otherwise.
  charsPerToken: 3,
});

const TTL_MS = Object.freeze({ '5m': 5 * 60_000, '1h': 60 * 60_000 });

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// Anthropic proposes this line when thinking is off and the output is JSON:
// it raised the share of complete and correct JSON at `low` and `medium` (report 02 §10.2, F4).
const JSON_FINAL_ANSWER_LINE = 'The JSON output format applies to your final answer only.';

function buildSystem(blocks, { cacheTtl, thinkingOff }) {
  const list = [...blocks];
  if (thinkingOff) list.push(JSON_FINAL_ANSWER_LINE);
  if (list.length === 0) return undefined;
  // The cache point goes in the last block: the whole stable prefix is cached (exact prefix, [F2]).
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
      // Native PDF: `document` block in base64 (600 pages per request with a 1M context; report 01 §2).
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
 * @param {'disabled'|undefined} [cfg.thinking] intent: 'disabled' turns thinking off in the form the model accepts; omitted = the model's default
 * @param {number} [cfg.timeoutMs]
 * @param {number} [cfg.maxTokens] default for `complete`
 * @param {typeof fetch} [cfg.fetchImpl]
 * @param {ReturnType<typeof import('./limiter.js').createLimiter>} [cfg.limiter] default: the process-wide one of Anthropic
 * @param {boolean} [cfg.cacheWarmup] default true; false sends parallel calls with the same prefix all at once, as before
 * @param {ReturnType<typeof import('./cache-warmup.js').createCacheWarmup>} [cfg.warmup] default: the process-wide one
 */
export function createAnthropicClient(cfg) {
  if (!cfg?.apiKey) throw new ProviderConfigError('anthropic: falta la llave (ANTHROPIC_API_KEY)', { provider: 'anthropic' });
  const model = cfg.model ?? ANTHROPIC_DEFAULTS.model;
  const baseUrl = (cfg.baseUrl ?? ANTHROPIC_DEFAULTS.baseUrl).replace(/\/+$/, '');
  const cacheTtl = cfg.cacheTtl ?? ANTHROPIC_DEFAULTS.cacheTtl;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const defaultMaxTokens = cfg.maxTokens ?? ANTHROPIC_DEFAULTS.maxTokens;
  const provider = 'anthropic';
  // The simultaneous requests of the whole process to this provider (limiter.js, H-83).
  const limiter = cfg.limiter ?? limiterFor(provider);
  const warmup = cfg.cacheWarmup === false ? null : cfg.warmup ?? processCacheWarmup;
  const charsPerToken = cfg.charsPerToken ?? ANTHROPIC_DEFAULTS.charsPerToken;

  // One span per call with the full input and output (UD-014, MASTER-SPEC §7.10 bis).
  const call = (req, modality = 'text') =>
    withGenAiCall({ provider, model, modality, request: req, cacheTtl: req.cacheTtl ?? cacheTtl }, () => rawCall(req));

  async function rawCall({ system, messages, schema, effort, maxTokens, cacheTtl: callCacheTtl, thinking: callThinking }) {
    // A per-call `thinking: 'disabled'` overrides the configured one: classification and decomposition are measured separately.
    const thinking = callThinking ?? cfg.thinking;
    if (effort !== undefined && !EFFORTS.has(effort)) {
      throw new ProviderConfigError(`anthropic: esfuerzo inválido «${effort}»`, { provider, model });
    }
    // The shape of `thinking` and `effort` comes from the model's declared capabilities (anthropic-models.js, H-1100).
    const resolved = resolveThinkingAndEffort(model, { wantOff: thinking === 'disabled', effort });
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new ProviderConfigError('anthropic: «messages» no puede estar vacío', { provider, model });
    }
    const max_tokens = maxTokens ?? defaultMaxTokens;
    const body = {
      model,
      max_tokens,
      messages: await Promise.all(messages.map(async (m) => ({ role: m.role, content: await toAnthropicContent(m.content, provider) }))),
    };
    const sys = buildSystem(systemBlocks(system), { cacheTtl: callCacheTtl ?? cacheTtl, thinkingOff: resolved.thinkingOff });
    if (sys) body.system = sys;
    if (resolved.thinking) body.thinking = resolved.thinking;
    const outputConfig = {};
    if (schema) outputConfig.format = { type: 'json_schema', schema };
    if (resolved.effort) outputConfig.effort = resolved.effort;
    if (Object.keys(outputConfig).length > 0) body.output_config = outputConfig;

    // Parallel calls with the same prefix: the first (leader) streams and the rest wait for its first event, then read the cache.
    // Only when the system prompt reaches the model's cacheable minimum; below it nothing is cached and nothing is worth waiting for.
    const systemChars = (body.system ?? []).reduce((n, block) => n + block.text.length, 0);
    const callTtl = callCacheTtl ?? cacheTtl;
    const turn = warmup && systemChars >= minCacheableTokens(model) * charsPerToken
      ? await warmup.enter(prefixKey(body), { signal: currentJobScope()?.signal, maxWaitMs: cfg.cacheWarmupMaxWaitMs ?? ANTHROPIC_DEFAULTS.cacheWarmupMaxWaitMs })
      : null;
    if (turn) annotate({ 'team.cache.role': turn.role, 'team.cache.wait_ms': turn.waitedMs });

    // The slot is held only around the request: the body above is already built.
    let res;
    try {
      res = await limiter.run(() => {
        const request = {
          headers: {
            'content-type': 'application/json',
            'x-api-key': cfg.apiKey,
            'anthropic-version': cfg.apiVersion ?? ANTHROPIC_DEFAULTS.apiVersion,
          },
          timeoutMs,
          fetchImpl: cfg.fetchImpl,
          provider,
          model,
        };
        const url = `${baseUrl}/v1/messages`;
        return turn?.role === 'leader'
          ? postStream(url, { ...request, body: JSON.stringify({ ...body, stream: true }), onStart: () => turn.started(TTL_MS[callTtl] ?? TTL_MS['5m']) })
          : postRequest(url, { ...request, body: JSON.stringify(body) });
      });
    } finally {
      turn?.finish();
    }

    const msg = res.json ?? {};
    const u = msg.usage ?? {};
    const usage = {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      // Cache read; the write is separate because it is billed at another rate (1.25x; report 02 [F2]).
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
    /** providers.text.complete: returns `json` if there is a schema, otherwise `text`. */
    complete: (req) => call(req),
    /** providers.vision.describe: images (and PDF) as blocks, then the prompt. */
    describe({ images, prompt, schema, system, effort, maxTokens, cacheTtl, thinking }) {
      if (!Array.isArray(images) || images.length === 0) {
        throw new ProviderConfigError('anthropic: describe necesita al menos una imagen', { provider, model });
      }
      const parts = images.map((img) => ({ type: img.mime === 'application/pdf' ? 'document' : 'image', ...img }));
      // Images go before the text: that is what the vision documentation recommends.
      return call({ system, messages: [{ role: 'user', content: [...parts, { type: 'text', text: prompt }] }], schema, effort, maxTokens, cacheTtl, thinking }, 'vision');
    },
  };
}
