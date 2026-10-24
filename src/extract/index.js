// Attachment extractors (MASTER-SPEC §7.4): they turn each attachment into text or a description
// ahead of the analyzer, deterministically and measured. One file per type; registering a
// new one means adding it to the `EXTRACTORS` map.
//
// extract(attachment, { providers, onProgress, config, signal, deps }) → { text, meta }
//   attachment: { id, kind, path, mime, size }   (for `link`, `path` carries the address)
//   providers:  { vision.describe({ images, prompt, schema }), speech.transcribe({ audioPath, language }) }
//               (MASTER-SPEC §7.6). Each image is { data: Buffer, mime, label }.
//   onProgress: (percent, phrase) per real step (MASTER-SPEC §7.10)
//   config:     knobs over the values of config.js
//   signal:     AbortSignal to cancel when the worker shuts down (MASTER-SPEC §7.3)
//   deps:       { lookup } only for link tests
//   deep:       true for the second reading of the analyzer (UD-021): an image is described in more detail
//
// `meta` always carries `kind`, `warnings` and `elapsedMs`; `meta.calls` lists the calls to
// providers for the `llm_calls` table. A failure is an `ExtractError` with a code and a reason.
import { access, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from './config.js';
import { ExtractError } from './errors.js';
import { extractAudio, planAudio } from './audio.js';
import { extractDocument } from './document.js';
import { extractImage } from './image.js';
import { extractLink } from './link.js';
import { extractVideo } from './video.js';
import { probe } from './lib/ffmpeg.js';
import { annotate, withSpan } from '../telemetry/api.js';

export { resolveConfig, DEFAULTS } from './config.js';
export { ExtractError } from './errors.js';
export { createAudioBudget } from './audio-budget.js';
export { selectPdfPages } from './lib/pdf-pages.js';

export const EXTRACTORS = Object.freeze({
  image: extractImage,
  document: extractDocument,
  audio: extractAudio,
  video: extractVideo,
  link: extractLink,
});

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// A working directory untouched for this long belongs to a worker that was killed (out of memory, a restart) before its `finally` ran: the
// audio chunks and frames of a video would stay on the disk for ever. Declared courtesy, no measurement: four times the 15 minutes a job may run.
const STALE_WORKDIR_MS = 3_600_000;

async function removeStaleWorkDirs(base, now = Date.now()) {
  let names;
  try {
    names = await readdir(base);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith('tp-extract-')) continue;
    try {
      const path = join(base, name);
      const info = await stat(path);
      if (info.isDirectory() && now - info.mtimeMs > STALE_WORKDIR_MS) await rm(path, { recursive: true, force: true });
    } catch {
      // another worker removed it first, or it cannot be read: not a reason to fail this extraction
    }
  }
}

// Cuts at the last line break that fits, so as not to split a sentence in half.
function truncate(text, maxChars) {
  if (text.length <= maxChars) return null;
  const cut = text.lastIndexOf('\n', maxChars);
  return text.slice(0, cut > 0 ? cut : maxChars);
}

export async function extract(attachment, { providers, onProgress, config, signal, deps, deep = false } = {}) {
  const extractor = EXTRACTORS[attachment?.kind];
  if (!extractor) {
    throw new ExtractError('kind_unsupported', 'Este tipo de adjunto no se puede leer.', { kind: attachment?.kind });
  }
  if (attachment.kind !== 'link' && !(await exists(attachment.path))) {
    throw new ExtractError('file_missing', 'El archivo del adjunto no existe.', { id: attachment.id });
  }
  const cfg = resolveConfig(config);
  let lastPercent = -1;
  const tracked = (percent, phrase) => {
    lastPercent = percent;
    onProgress?.(percent, phrase);
  };
  const base = cfg.workDir ?? tmpdir();
  await mkdir(base, { recursive: true });
  await removeStaleWorkDirs(base);
  const workDir = await mkdtemp(join(base, 'tp-extract-'));
  try {
    // One span per attachment (UD-014); each extractor's steps hang from it.
    const result = await withSpan(
      'extract.attachment',
      {
        'team.step': 'extract',
        'team.input_id': attachment.input_id,
        'team.attachment_id': attachment.id,
        'team.attachment_kind': attachment.kind,
        'team.mime': attachment.mime,
        'team.input_bytes': attachment.size,
      },
      async () => {
        const out = await extractor(attachment, { providers, config: cfg, onProgress: tracked, signal, deps, workDir, deep });
        annotate({
          'team.output_chars': out.text.length,
          'team.warnings': out.meta.warnings?.length ?? 0,
          'team.elapsed_ms': out.meta.elapsedMs,
        });
        return out;
      },
    );
    const meta = { ...result.meta, kind: attachment.kind, warnings: [...(result.meta.warnings ?? [])] };
    let text = result.text;
    const cut = truncate(text, cfg.text.maxChars);
    if (cut !== null) {
      meta.truncated = true;
      meta.originalChars = text.length;
      meta.warnings.push({ code: 'text_truncated', message: `El texto supera ${cfg.text.maxChars} caracteres y se cortó.` });
      text = cut;
    }
    if (lastPercent < 100) tracked(100, 'listo');
    return { text, meta };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Seconds of audio the transcription provider will bill for this attachment, so the queue
 * can check the hourly budget before claiming the job (MASTER-SPEC §7.4). Zero for what
 * does not transcribe.
 */
export async function estimateAudioSeconds(attachment, { config, signal } = {}) {
  if (attachment.kind !== 'audio' && attachment.kind !== 'video') return 0;
  const cfg = resolveConfig(config);
  const info = await probe(attachment.path, { signal });
  if (!info.hasAudio || info.durationSeconds <= 0) return 0;
  return planAudio(info.durationSeconds, cfg.audio).billableSeconds;
}
