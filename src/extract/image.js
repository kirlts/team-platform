// Image extractor (MASTER-SPEC §7.4): the vision provider describes what is actionable.
// iPhone HEIC: `sharp` with its precompiled binaries does not decode it (report 06 §6.2),
// so it is rejected with a reason instead of failing inside the provider.
import { open, readFile, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { ExtractError } from './errors.js';
import { createProgress } from './lib/progress.js';
import { annotate, withSpan } from '../telemetry/api.js';

// Brands of the ISO-BMFF container used by HEIC/HEIF photos with the HEVC codec. `avif` is left out
// on purpose: sharp does read it. It is a binary signature of the format, not human text.
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

const MIME_BY_FORMAT = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

/** True when the file is a HEIC/HEIF container (by its `ftyp` brand, never by name or declared type). */
export async function isHeicFile(path) {
  const brand = await readBrand(path);
  return Boolean(brand && HEIC_BRANDS.has(brand));
}

/** Message of the rejection, shared by the upload and the extractor so both say the same thing. */
export const HEIC_MESSAGE = 'La foto está en formato HEIC (iPhone) y no se puede leer. Exportarla como JPEG o enviarla desde la cámara de la aplicación.';

async function readBrand(path) {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(12);
    await handle.read(head, 0, 12, 0);
    if (head.toString('latin1', 4, 8) !== 'ftyp') return null;
    return head.toString('latin1', 8, 12);
  } finally {
    await handle.close();
  }
}

/**
 * Leaves the image in a format providers accept: passes it as is if it already is one, is
 * upright and fits; otherwise rotates it per EXIF, shrinks it to the maximum side and converts it.
 */
export async function normalizeImage(path, cfg) {
  const brand = await readBrand(path);
  if (brand && HEIC_BRANDS.has(brand)) {
    throw new ExtractError(
      'image_heic_unsupported',
      HEIC_MESSAGE,
      { brand },
    );
  }
  let meta;
  try {
    meta = await sharp(path).metadata();
  } catch (cause) {
    throw new ExtractError('image_unreadable', 'El archivo no es una imagen que se pueda leer.', { cause: String(cause?.message ?? cause) });
  }
  const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
  const needsRotation = (meta.orientation ?? 1) > 1;
  const passthrough = cfg.passthroughFormats.includes(meta.format);
  if (passthrough && !needsRotation && longSide <= cfg.maxSide) {
    return { data: await readFile(path), mime: MIME_BY_FORMAT[meta.format], width: meta.width, height: meta.height, converted: false };
  }
  // A photo downscaled to PNG (lossless) weighs several times more than its JPEG: a 12 MP one came out at 17 MB in base64
  // and Anthropic rejected it («image exceeds 10 MB maximum», VPS, 2026-10-21). What was already lossy stays lossy.
  const lossy = cfg.lossyFormats.includes(meta.format);
  let side = Math.min(cfg.maxSide, longSide);
  for (;;) {
    const { data, info } = await sharp(path)
      .rotate()
      .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
      .flatten(lossy ? { background: '#ffffff' } : false)
      .toFormat(lossy ? 'jpeg' : cfg.outputFormat)
      .toBuffer({ resolveWithObject: true });
    // The provider measures the image in base64 against 10 MiB: with `maxBytes` (7 MiB) of binary it fits. If it does not fit, the side is halved.
    if (data.length <= cfg.maxBytes || side <= cfg.minSide) {
      return { data, mime: `image/${info.format}`, width: info.width, height: info.height, converted: true };
    }
    side = Math.max(cfg.minSide, Math.floor(side / 2));
  }
}

const DESCRIPTION_SCHEMA = {
  type: 'object',
  properties: { description: { type: 'string' } },
  required: ['description'],
  additionalProperties: false,
};

export async function extractImage(attachment, ctx) {
  const { providers, config, onProgress } = ctx;
  const cfg = config.image;
  if (!providers?.vision?.describe) {
    throw new ExtractError('provider_missing', 'No hay un proveedor de visión configurado.');
  }
  const { size } = await stat(attachment.path);
  if (size > cfg.maxBytes) {
    throw new ExtractError('image_too_large', 'La imagen supera el tamaño máximo permitido.', { size, max: cfg.maxBytes });
  }
  const startedAt = performance.now();
  const progress = createProgress(onProgress, 2);
  progress.report('preparando la imagen');
  const image = await withSpan('extract.sharp', { 'team.step': 'extract.sharp', 'team.tool': 'sharp', 'team.input_bytes': size }, async () => {
    const out = await normalizeImage(attachment.path, cfg);
    annotate({ 'team.output_bytes': out.data.length, 'team.width': out.width, 'team.height': out.height, 'team.converted': out.converted });
    return out;
  });
  progress.advance('describiendo la imagen');
  const { json, usage } = await withSpan('extract.vision', { 'team.step': 'extract.vision', 'team.images': 1, 'team.input_bytes': image.data.length }, async () => {
    const out = await providers.vision.describe({
      images: [{ data: image.data, mime: image.mime, label: 'Imagen' }],
      prompt: ctx.deep ? cfg.deepPrompt : cfg.prompt,
      schema: DESCRIPTION_SCHEMA,
    });
    annotate({ 'team.output_chars': typeof out.json?.description === 'string' ? out.json.description.length : 0 });
    return out;
  });
  const description = typeof json?.description === 'string' ? json.description.trim() : '';
  const warnings = description === '' ? [{ code: 'empty_description', message: 'El proveedor no devolvió una descripción.' }] : [];
  progress.advance('imagen descrita');
  return {
    text: description,
    meta: {
      width: image.width,
      height: image.height,
      converted: image.converted,
      calls: [{ modality: 'vision', images: 1, usage }],
      warnings,
      elapsedMs: Math.round(performance.now() - startedAt),
    },
  };
}
