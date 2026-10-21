// Transcription through Groq's OpenAI-compatible API (MASTER-SPEC §3, §7.4 and §7.6; UD-001, UD-008).
// Documentation consulted in report 01 §3: `whisper-large-v3-turbo`, 0.04 USD per hour of audio,
// 25 MB per file for free. Chunking the audio (600 s with 5 s of overlap) belongs to the extractor
// (§7.4); this module transcribes one file.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ProviderConfigError, ProviderHttpError, ProviderTimeoutError } from './errors.js';
import { DEFAULT_TIMEOUT_MS, isRetryableStatus } from './http.js';
import { limiterFor } from './limiter.js';
import { annotate, withGenAiCall } from '../telemetry/api.js';

export const GROQ_SPEECH_DEFAULTS = Object.freeze({
  baseUrl: 'https://api.groq.com/openai/v1',
  // Default model from MASTER-SPEC §3.
  model: 'whisper-large-v3-turbo',
  // §7.4: `language=es`.
  language: 'es',
});

/**
 * @param {object} cfg
 * @param {string} cfg.apiKey
 * @param {string} [cfg.model]
 * @param {string} [cfg.baseUrl]
 * @param {number} [cfg.timeoutMs]
 * @param {typeof fetch} [cfg.fetchImpl]
 */
export function createGroqSpeechClient(cfg) {
  const provider = 'groq-speech';
  if (!cfg?.apiKey) throw new ProviderConfigError('groq-speech: falta la llave (GROQ_API_KEY)', { provider });
  const model = cfg.model ?? GROQ_SPEECH_DEFAULTS.model;
  const baseUrl = (cfg.baseUrl ?? GROQ_SPEECH_DEFAULTS.baseUrl).replace(/\/+$/, '');
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const limiter = cfg.limiter ?? limiterFor(provider); // the Groq organization's simultaneous requests (limiter.js, H-83)

  async function rawTranscribe({ audioPath, language, prompt }) {
    if (!audioPath) throw new ProviderConfigError('groq-speech: falta «audioPath»', { provider, model });
    const bytes = await readFile(audioPath);
    annotate({ 'team.input_bytes': bytes.length });
    const form = new FormData();
    form.append('file', new Blob([bytes]), basename(audioPath));
    form.append('model', model);
    // verbose_json + segments: per-segment timestamps for the timeline (§7.4).
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    if (language) form.append('language', language);
    if (prompt) form.append('prompt', prompt);

    // The slot is held around the request and the read of its answer; the audio is already in memory.
    return limiter.run(() => send(form, language));
  }

  async function send(form, language) {
    const started = performance.now();
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const duration_ms = Math.round(performance.now() - started);
      if (cause?.name === 'TimeoutError' || cause?.name === 'AbortError') {
        throw new ProviderTimeoutError(`groq-speech: la llamada superó ${timeoutMs} ms`, { provider, model, duration_ms, timeoutMs, cause });
      }
      throw new ProviderHttpError(`groq-speech: fallo de red (${cause?.message ?? cause})`, { provider, model, duration_ms, status: 0, retryable: true, cause });
    }
    const raw = await response.text();
    const duration_ms = Math.round(performance.now() - started);
    let json = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new ProviderHttpError(`groq-speech: ${json?.error?.message ?? `HTTP ${response.status}`}`, {
        provider,
        model,
        duration_ms,
        status: response.status,
        retryable: isRetryableStatus(response.status),
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
        body: json ?? raw.slice(0, 2000),
      });
    }
    const segments = (json?.segments ?? []).map((s) => ({
      start: s.start,
      end: s.end,
      text: String(s.text ?? '').trim(),
      no_speech_prob: s.no_speech_prob ?? null,
    }));
    return {
      text: String(json?.text ?? '').trim(),
      segments,
      language: json?.language ?? language ?? null,
      // Groq's quota is counted in seconds of audio (7,200 s per hour, §7.4), not in tokens.
      usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0, audio_seconds: json?.duration ?? segments.at(-1)?.end ?? 0 },
      duration_ms,
      provider,
      model,
    };
  }

  return {
    name: provider,
    model,
    /**
     * providers.speech.transcribe
     * @param {{audioPath: string, language?: string, prompt?: string}} req
     * `prompt` is vocabulary only (proper names, project terms), never instructions (§7.4).
     * One span per call (UD-014): the audio stays by reference and the full transcription in the event.
     */
    transcribe(req) {
      const request = { ...req, language: req.language === undefined ? GROQ_SPEECH_DEFAULTS.language : req.language };
      return withGenAiCall({ provider, model, modality: 'speech', operation: 'transcription', request }, () => rawTranscribe(request));
    },
  };
}
