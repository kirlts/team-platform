// Video extractor (MASTER-SPEC §7.4, report 06): the audio track goes to the audio
// extractor; one frame per second, deduplicated by dHash, goes to the vision provider in a
// single call; the system interleaves speech and frames in chronological order.
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { ExtractError } from './errors.js';
import { planAudio, transcribeFile } from './audio.js';
import { dhash, selectFrames } from './lib/dhash.js';
import { run, probe } from './lib/ffmpeg.js';
import { mapLimit } from './lib/pool.js';
import { createProgress } from './lib/progress.js';
import { formatTimestamp } from './lib/time.js';
import { annotate, withSpan } from '../telemetry/api.js';

const FRAMES_SCHEMA = {
  type: 'object',
  properties: {
    frames: {
      type: 'array',
      items: {
        type: 'object',
        properties: { index: { type: 'integer' }, description: { type: 'string' } },
        required: ['index', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['frames'],
  additionalProperties: false,
};

/** One frame per `frameSampleSeconds`, at `frameWidth` px, JPEG; the name is the second (`-frame_pts`). */
async function sampleFrames(videoPath, dir, cfg, signal) {
  await mkdir(dir, { recursive: true });
  await run(
    'ffmpeg',
    [
      '-nostdin', '-v', 'error', '-y', '-i', videoPath, '-an',
      '-vf', `fps=1/${cfg.frameSampleSeconds},scale='min(${cfg.frameWidth},iw)':-2`,
      '-q:v', String(cfg.frameQuality), '-frame_pts', '1', join(dir, '%08d.jpg'),
    ],
    { signal },
  );
  const names = (await readdir(dir)).filter((n) => n.endsWith('.jpg')).sort();
  return names.map((name) => ({
    path: join(dir, name),
    // With `fps=1/N` the output's presentation time counts frames, not seconds.
    second: Number.parseInt(name, 10) * cfg.frameSampleSeconds,
  }));
}

export async function extractVideo(attachment, ctx) {
  const { providers, config, onProgress, signal } = ctx;
  const cfg = config.video;
  if (!providers?.vision?.describe) {
    throw new ExtractError('provider_missing', 'No hay un proveedor de visión configurado.');
  }
  const startedAt = performance.now();
  const timings = {};
  const { size } = await stat(attachment.path);
  if (size > cfg.maxBytes) {
    throw new ExtractError('video_too_large', 'El video supera el tamaño máximo permitido.', { size, max: cfg.maxBytes });
  }
  const first = createProgress(onProgress, 1);
  first.report('Medición del video');
  const info = await probe(attachment.path, { signal });
  if (!info.hasVideo || info.durationSeconds <= 0) {
    throw new ExtractError('video_unreadable', 'El archivo no contiene un video que se pueda leer.');
  }
  if (info.durationSeconds > cfg.maxSeconds) {
    throw new ExtractError('video_too_long', 'El video supera la duración máxima permitida.', {
      seconds: info.durationSeconds,
      max: cfg.maxSeconds,
    });
  }

  const audioPlan = info.hasAudio ? planAudio(info.durationSeconds, config.audio) : null;
  // Steps: one frame per second, the hash, the vision call, plus one step per audio chunk.
  const progress = createProgress(onProgress, 3 + (audioPlan?.steps ?? 0));
  const warnings = [];
  const calls = [];

  // Transcription and frames do not depend on each other: they run at the same time.
  const audioJob = audioPlan
    ? (async () => {
        const t = performance.now();
        const segments = await transcribeFile(
          attachment.path,
          { durationSeconds: info.durationSeconds, plan: audioPlan.plan },
          ctx,
          progress,
        );
        timings.audioMs = Math.round(performance.now() - t);
        return segments;
      })()
    : Promise.resolve([]);

  const framesJob = (async () => {
    progress.report('Extracción de fotogramas');
    let t = performance.now();
    const sampled = await withSpan('extract.ffmpeg', { 'team.step': 'extract.ffmpeg', 'team.tool': 'ffmpeg', 'team.input_bytes': size }, async () => {
      const out = await sampleFrames(attachment.path, join(ctx.workDir, 'frames'), cfg, signal);
      annotate({ 'team.frames': out.length });
      return out;
    });
    timings.framesMs = Math.round(performance.now() - t);
    progress.advance('Fotogramas extraídos');
    t = performance.now();
    const { frames, dedupedCount } = await withSpan('extract.dhash', { 'team.step': 'extract.dhash', 'team.frames': sampled.length }, async () => {
      const hashed = await mapLimit(sampled, availableParallelism(), async (f) => ({ ...f, hash: await dhash(f.path) }));
      const picked = selectFrames(hashed, { distance: cfg.frameHashDistance, maxFrames: cfg.maxFrames });
      annotate({ 'team.selected_frames': picked.frames.length, 'team.deduped_frames': picked.dedupedCount });
      return picked;
    });
    timings.hashMs = Math.round(performance.now() - t);
    progress.advance('Fotogramas comparados');
    return { frames, dedupedCount, sampledCount: sampled.length };
  })();

  const [segments, frameSet] = await Promise.all([audioJob, framesJob]);
  if (info.hasAudio && segments.length === 0) {
    warnings.push({ code: 'no_speech', message: 'La transcripción no devolvió texto.' });
  }
  if (!info.hasAudio) warnings.push({ code: 'no_audio_track', message: 'El video no tiene pista de audio.' });

  const { frames } = frameSet;
  const t0 = performance.now();
  progress.report('Descripción de fotogramas');
  const images = await Promise.all(
    frames.map(async (f, i) => ({
      data: await readFile(f.path),
      mime: 'image/jpeg',
      label: `Fotograma ${i + 1} [${formatTimestamp(f.second)}]`,
    })),
  );
  const { json, usage } = await withSpan(
    'extract.vision',
    { 'team.step': 'extract.vision', 'team.images': images.length, 'team.input_bytes': images.reduce((sum, img) => sum + img.data.length, 0) },
    async () => {
      const out = await providers.vision.describe({ images, prompt: cfg.prompt, schema: FRAMES_SCHEMA });
      annotate({ 'team.output_chars': JSON.stringify(out.json ?? '').length });
      return out;
    },
  );
  timings.visionMs = Math.round(performance.now() - t0);
  progress.advance('Fotogramas descritos');
  calls.push({ modality: 'vision', images: images.length, usage });
  if (audioPlan) calls.push({ modality: 'speech', audioSeconds: audioPlan.billableSeconds, requests: audioPlan.plan.length });

  const byIndex = new Map();
  for (const item of Array.isArray(json?.frames) ? json.frames : []) {
    if (Number.isInteger(item?.index) && typeof item?.description === 'string') byIndex.set(item.index, item.description.trim());
  }
  const described = frames.map((f, i) => ({ ...f, number: i + 1, description: byIndex.get(i + 1) ?? '' }));
  const missing = described.filter((f) => f.description === '').length;
  if (missing > 0) {
    warnings.push({ code: 'frames_without_description', message: `${missing} de ${described.length} fotogramas quedaron sin descripción.` });
  }

  return {
    text: buildTimeline(described, segments),
    meta: {
      durationSeconds: info.durationSeconds,
      sampledFrames: frameSet.sampledCount,
      dedupedFrames: frameSet.dedupedCount,
      frames: described.map((f) => ({ number: f.number, second: f.second })),
      audioChunks: audioPlan?.plan.length ?? 0,
      billableSeconds: audioPlan?.billableSeconds ?? 0,
      segments: segments.length,
      calls,
      warnings,
      timings,
      elapsedMs: Math.round(performance.now() - startedAt),
    },
  };
}

/**
 * Timeline: frames and speech segments in chronological order, with the frame before
 * the speech that starts in the same second (report 06 §4.1: the image goes before the text).
 */
export function buildTimeline(frames, segments) {
  const events = [
    ...frames.map((f) => ({ at: f.second, order: 0, line: `[${formatTimestamp(f.second)}] Fotograma ${f.number}: ${f.description}` })),
    ...segments.map((s) => ({
      at: s.start,
      order: 1,
      line: `[${formatTimestamp(s.start)}-${formatTimestamp(s.end)}] Voz: ${s.text}`,
    })),
  ];
  events.sort((a, b) => a.at - b.at || a.order - b.order);
  return events.map((e) => e.line).join('\n');
}
