// Transcripción por la API de Groq compatible con OpenAI (MASTER-SPEC §3, §7.4 y §7.6; UD-001, UD-008).
// Documentación consultada en el informe 01 §3: `whisper-large-v3-turbo`, 0,04 USD por hora de audio,
// 25 MB por archivo gratis. El troceado del audio (600 s con 5 s de solapamiento) es del extractor
// (§7.4); este módulo transcribe un archivo.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ProviderConfigError, ProviderHttpError, ProviderTimeoutError } from './errors.js';
import { DEFAULT_TIMEOUT_MS, isRetryableStatus } from './http.js';
import { annotate, withGenAiCall } from '../telemetry/api.js';

export const GROQ_SPEECH_DEFAULTS = Object.freeze({
  baseUrl: 'https://api.groq.com/openai/v1',
  // Modelo por omisión de MASTER-SPEC §3.
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

  async function rawTranscribe({ audioPath, language, prompt }) {
    if (!audioPath) throw new ProviderConfigError('groq-speech: falta «audioPath»', { provider, model });
    const bytes = await readFile(audioPath);
    annotate({ 'team.input_bytes': bytes.length });
    const form = new FormData();
    form.append('file', new Blob([bytes]), basename(audioPath));
    form.append('model', model);
    // verbose_json + segmentos: marcas de tiempo por segmento para la línea de tiempo (§7.4).
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    if (language) form.append('language', language);
    if (prompt) form.append('prompt', prompt);

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
      // La cuota de Groq se cuenta en segundos de audio (7.200 s por hora, §7.4), no en tokens.
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
     * `prompt` sólo de vocabulario (nombres propios, términos del proyecto), nunca instrucciones (§7.4).
     * Un span por llamada (UD-014): el audio queda por referencia y la transcripción completa en el evento.
     */
    transcribe(req) {
      const request = { ...req, language: req.language === undefined ? GROQ_SPEECH_DEFAULTS.language : req.language };
      return withGenAiCall({ provider, model, modality: 'speech', operation: 'transcription', request }, () => rawTranscribe(request));
    },
  };
}
