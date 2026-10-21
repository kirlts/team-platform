// Extractor de audio (MASTER-SPEC §7.4): FLAC 16 kHz mono, trozos de 600 s con 5 s de
// solapamiento, transcripción con segmentos y fusión por marca de tiempo.
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ExtractError } from './errors.js';
import { run, probe } from './lib/ffmpeg.js';
import { planChunks, billableSeconds, mergeSegments } from './lib/chunks.js';
import { joinSegments } from './lib/sentences.js';
import { mapLimit } from './lib/pool.js';
import { createProgress } from './lib/progress.js';
import { formatTimestamp } from './lib/time.js';
import { annotate, withSpan } from '../telemetry/api.js';

/** Pasos de progreso de una transcripción: uno por trozo. */
export function planAudio(durationSeconds, cfg) {
  const plan = planChunks(durationSeconds, cfg);
  return { plan, steps: plan.length, billableSeconds: billableSeconds(plan, cfg.minChunkSeconds) };
}

/**
 * Transcribe un archivo con pista de audio (de un audio o de un video) y devuelve los segmentos
 * fusionados con tiempos absolutos. El llamador crea `progress` con un paso por trozo.
 * Segments come out already joined into sentence-sized phrases (`joinSegments`): the provider returns
 * one short phrase per segment and the analyzer numbers one unit per line.
 */
export async function transcribeFile(sourcePath, { durationSeconds, plan }, ctx, progress) {
  const { providers, config, signal } = ctx;
  const cfg = config.audio;
  if (!providers?.speech?.transcribe) {
    throw new ExtractError('provider_missing', 'No hay un proveedor de transcripción configurado.');
  }
  const dir = join(ctx.workDir, 'audio');
  await mkdir(dir, { recursive: true });

  const perChunk = await mapLimit(plan, cfg.chunkConcurrency, async (chunk) => {
    const file = join(dir, `chunk-${String(chunk.index).padStart(4, '0')}.flac`);
    const { size } = await withSpan(
      'extract.ffmpeg',
      { 'team.step': 'extract.ffmpeg', 'team.tool': 'ffmpeg', 'team.chunk': chunk.index, 'team.chunk_seconds': chunk.length },
      async () => {
        await run(
          'ffmpeg',
          [
            '-nostdin', '-v', 'error', '-y',
            '-ss', String(chunk.start), '-t', String(chunk.length), '-i', sourcePath,
            '-map', '0:a:0', '-vn', '-ar', String(cfg.sampleRate), '-ac', '1', '-c:a', 'flac', file,
          ],
          { signal },
        );
        const info = await stat(file);
        annotate({ 'team.output_bytes': info.size });
        return info;
      },
    );
    if (size > cfg.maxChunkBytes) {
      throw new ExtractError('audio_chunk_too_large', 'Un trozo de audio supera el tope del proveedor de transcripción.', {
        size,
        max: cfg.maxChunkBytes,
      });
    }
    const request = { audioPath: file, language: cfg.language };
    if (cfg.vocabulary) request.prompt = cfg.vocabulary;
    const result = await withSpan('extract.transcription', { 'team.step': 'extract.transcription', 'team.chunk': chunk.index, 'team.input_bytes': size }, async () => {
      const out = await providers.speech.transcribe(request);
      annotate({ 'team.output_chars': out?.text?.length, 'team.segments': out?.segments?.length });
      return out;
    });
    progress.advance(`transcribiendo el audio, trozo ${chunk.index + 1} de ${plan.length}`);
    return normalizeSegments(result, chunk);
  });

  return joinSegments(mergeSegments(plan, perChunk), cfg.pauseSeconds, cfg.maxUnitWords);
}

// Un proveedor sin segmentos devuelve sólo `text`: se trata como un único segmento del trozo.
function normalizeSegments(result, chunk) {
  const segments = Array.isArray(result?.segments) ? result.segments : [];
  if (segments.length > 0) {
    return segments
      .filter((s) => typeof s?.text === 'string' && s.text.trim() !== '')
      .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: s.text.trim() }));
  }
  if (typeof result?.text === 'string' && result.text.trim() !== '') {
    return [{ start: 0, end: chunk.length, text: result.text.trim() }];
  }
  return [];
}

/** Una línea por segmento unido: `[mm:ss] texto`. */
export function formatSegments(segments) {
  return segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`).join('\n');
}

export async function extractAudio(attachment, ctx) {
  const { config, onProgress, signal } = ctx;
  const cfg = config.audio;
  const warnings = [];

  const { size } = await stat(attachment.path);
  if (size > cfg.maxBytes) {
    throw new ExtractError('audio_too_large', 'El audio supera el tamaño máximo permitido.', { size, max: cfg.maxBytes });
  }
  const startedAt = performance.now();
  const tmp = createProgress(onProgress, 1);
  tmp.report('midiendo el audio');
  const info = await probe(attachment.path, { signal });
  if (!info.hasAudio || info.durationSeconds <= 0) {
    throw new ExtractError('audio_no_stream', 'El archivo no contiene una pista de audio que se pueda leer.');
  }
  const { plan, steps, billableSeconds: billable } = planAudio(info.durationSeconds, cfg);
  const progress = createProgress(onProgress, steps);
  progress.report(`transcribiendo el audio, ${steps} ${steps === 1 ? 'trozo' : 'trozos'}`);

  const segments = await transcribeFile(attachment.path, { durationSeconds: info.durationSeconds, plan }, ctx, progress);
  if (segments.length === 0) warnings.push({ code: 'no_speech', message: 'La transcripción no devolvió texto.' });

  return {
    text: formatSegments(segments),
    meta: {
      durationSeconds: info.durationSeconds,
      chunks: plan.length,
      segments: segments.length,
      billableSeconds: billable,
      calls: [{ modality: 'speech', audioSeconds: billable, requests: plan.length }],
      warnings,
      elapsedMs: Math.round(performance.now() - startedAt),
    },
  };
}
