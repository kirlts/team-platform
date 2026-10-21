// Extractores de adjuntos (MASTER-SPEC §7.4): convierten cada adjunto en texto o descripción
// antes del analizador, de forma determinista y medida. Un archivo por tipo; registrar uno
// nuevo es agregarlo al mapa `EXTRACTORS`.
//
// extract(attachment, { providers, onProgress, config, signal, deps }) → { text, meta }
//   attachment: { id, kind, path, mime, size }   (para `link`, `path` lleva la dirección)
//   providers:  { vision.describe({ images, prompt, schema }), speech.transcribe({ audioPath, language }) }
//               (MASTER-SPEC §7.6). Cada imagen es { data: Buffer, mime, label }.
//   onProgress: (percent, phrase) por paso real (MASTER-SPEC §7.10)
//   config:     perillas sobre los valores de config.js
//   signal:     AbortSignal para cancelar al apagar el worker (MASTER-SPEC §7.3)
//   deps:       { lookup } sólo para pruebas del enlace
//
// `meta` siempre trae `kind`, `warnings` y `elapsedMs`; `meta.calls` lista las llamadas a
// proveedores para la tabla `llm_calls`. Un fallo es un `ExtractError` con código y motivo.
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
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

// Corta en el último salto de línea que cabe, para no partir una frase por la mitad.
function truncate(text, maxChars) {
  if (text.length <= maxChars) return null;
  const cut = text.lastIndexOf('\n', maxChars);
  return text.slice(0, cut > 0 ? cut : maxChars);
}

export async function extract(attachment, { providers, onProgress, config, signal, deps } = {}) {
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
  const workDir = await mkdtemp(join(base, 'tp-extract-'));
  try {
    // Un span por adjunto (UD-014); los pasos de cada extractor cuelgan de él.
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
        const out = await extractor(attachment, { providers, config: cfg, onProgress: tracked, signal, deps, workDir });
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
 * Segundos de audio que facturará el proveedor de transcripción por este adjunto, para que la cola
 * consulte el presupuesto por hora antes de reclamar el trabajo (MASTER-SPEC §7.4). Cero para lo
 * que no transcribe.
 */
export async function estimateAudioSeconds(attachment, { config, signal } = {}) {
  if (attachment.kind !== 'audio' && attachment.kind !== 'video') return 0;
  const cfg = resolveConfig(config);
  const info = await probe(attachment.path, { signal });
  if (!info.hasAudio || info.durationSeconds <= 0) return 0;
  return planAudio(info.durationSeconds, cfg.audio).billableSeconds;
}
