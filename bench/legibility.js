// Legibility of on-screen text in the frames of a video at several widths (TASK-013). The video extractor scales each frame to
// `video.frameWidth` (src/extract/config.js: 720 px, report 06 §8) before the vision model reads it; this module builds the same frame at
// 540, 720 and 1080 px from a still with known text, asks the model to read it and scores how many of the words and numbers it returns.
// The still imitates a phone screen (1080 × 1920) with lines of text at four sizes; the reference is the text that was drawn, so no person has
// to transcribe anything. The scoring is pure and tested with a fake model; the frames need `ffmpeg` with `drawtext`.
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Source still: a phone in portrait at 1080 px wide, the most common recording in the private bench (`ffprobe` of its mp4 cases). */
export const STILL = Object.freeze({ width: 1080, height: 1920 });

/** Sizes in pixels of the source still: 22 is a caption, 28 a small body, 36 a body (14 sp at 2.6 density), 48 a title. */
export const LINES = Object.freeze([
  { size: 22, text: 'Pedido 48213 pendiente de pago desde el 14/03' },
  { size: 28, text: 'Total a pagar 19.990 pesos con tarjeta terminada en 7305' },
  { size: 36, text: 'Cliente Valentina Rojas, martes 22 a las 10:30' },
  { size: 48, text: 'Error 504 en la pantalla de reservas' },
]);

/** Lowercase, no accents, no punctuation, and the thousands separator removed from numbers (19.990 and 19,990 read as 19990). */
export function normalize(text) {
  return String(text)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/(\d)[.,](?=\d{3}\b)/g, '$1')
    .replace(/[^a-z0-9:/\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The words that must come back: the numbers and the words of three letters or more. */
export function tokensOf(line) {
  return normalize(line).split(' ').filter((t) => /\d/.test(t) || t.length >= 3);
}

/** Share of the tokens of `line` that appear in `answer`, as a whole word. */
export function recall(line, answer) {
  const tokens = tokensOf(line);
  if (tokens.length === 0) return null;
  const seen = new Set(normalize(answer).split(' '));
  return tokens.filter((t) => seen.has(t)).length / tokens.length;
}

/**
 * Builds the still and one JPEG per width, with the filter and the quality of the video extractor.
 * @param {{ dir: string, widths: number[], quality: number, fontFile: string }} opts
 * @returns {Promise<{ width: number, path: string }[]>}
 */
export async function buildFrames({ dir, widths, quality, fontFile }) {
  mkdirSync(dir, { recursive: true });
  let y = 120;
  const draws = LINES.map((line, i) => {
    const file = join(dir, `line-${i}.txt`);
    writeFileSync(file, line.text);
    const out = `drawtext=fontfile=${fontFile}:textfile=${file}:fontsize=${line.size}:x=40:y=${y}:fontcolor=0x202020`;
    y += line.size * 3;
    return out;
  });
  const still = join(dir, 'still.png');
  await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0xf4f4f4:s=${STILL.width}x${STILL.height}`, '-vf', draws.join(','), '-frames:v', '1', still]);
  const frames = [];
  for (const width of widths) {
    const path = join(dir, `frame-${width}.jpg`);
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', still, '-vf', `scale='min(${width},iw)':-2`, '-q:v', String(quality), '-frames:v', '1', path]);
    frames.push({ width, path });
  }
  return frames;
}

/**
 * Asks the model to read each frame and scores every line.
 * @param {{ frames: {width: number, path: string, data: Buffer}[], vision: { describe: Function }, prompt: string, schema: object }} opts
 * @returns {Promise<{ width: number, usage: object|null, lines: { size: number, recall: number }[], mean: number }[]>}
 */
export async function measure({ frames, vision, prompt, schema }) {
  const rows = [];
  for (const frame of frames) {
    const out = await vision.describe({ images: [{ data: frame.data, mime: 'image/jpeg', label: `Fotograma 1 [${frame.width} px]` }], prompt, schema });
    const answer = (out.json?.frames ?? []).map((f) => f.description).join(' ') || (typeof out.text === 'string' ? out.text : '');
    const lines = LINES.map((line) => ({ size: line.size, recall: recall(line.text, answer) ?? 0 }));
    rows.push({ width: frame.width, usage: out.usage ?? null, lines, mean: lines.reduce((a, l) => a + l.recall, 0) / lines.length });
  }
  return rows;
}
