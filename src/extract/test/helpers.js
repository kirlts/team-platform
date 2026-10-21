// Test utilities: temporary directory inside the worktree (never in /tmp), synthetic file
// generators and fake providers that use neither keys nor network.
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';

const exec = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.tmp');

/** A test's own temporary directory; `after(() => dir.cleanup())`. */
export async function makeTmp(name = 'x') {
  await mkdir(ROOT, { recursive: true });
  const path = await mkdtemp(join(ROOT, `${name}-`));
  return { path, join: (...p) => join(path, ...p), cleanup: () => rm(path, { recursive: true, force: true }) };
}

export async function ffprobeJson(path) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels,codec_type', '-of', 'json', path]);
  return JSON.parse(stdout);
}

// ---- images ------------------------------------------------------------------------------

export async function makeImage(path, { width = 320, height = 200, format = 'png', color = '#3366cc' } = {}) {
  await sharp({ create: { width, height, channels: 3, background: color } }).toFormat(format).toFile(path);
  return path;
}

/** JPEG with EXIF orientation 6 (rotated 90 degrees), as it comes out of a phone. */
export async function makeRotatedJpeg(path, { width = 300, height = 100 } = {}) {
  await sharp({ create: { width, height, channels: 3, background: '#aa3333' } }).jpeg().withMetadata({ orientation: 6 }).toFile(path);
  return path;
}

/** Minimal header of an iPhone HEIC photo: `ftyp` box with the `heic` brand. */
export async function makeHeicLike(path) {
  const head = Buffer.alloc(32);
  head.writeUInt32BE(24, 0);
  head.write('ftypheic', 4, 'latin1');
  await writeFile(path, head);
  return path;
}

// ---- documents ----------------------------------------------------------------------------

/** DOCX with `points` points (paragraph with bold, bullet and sub-bullet) and a table; returns the expected strings. */
export async function makeDocx(path, points = 40) {
  const children = [new Paragraph({ text: 'Minuta de la reunión', heading: HeadingLevel.HEADING_1 })];
  const expected = [];
  for (let i = 1; i <= points; i++) {
    children.push(new Paragraph({ children: [new TextRun({ text: `Punto ${i}: `, bold: true }), new TextRun(`revisar el módulo número ${i}`)] }));
    children.push(new Paragraph({ text: `Criterio ${i}.a`, bullet: { level: 0 } }));
    children.push(new Paragraph({ text: `Subcriterio ${i}.a.1`, bullet: { level: 1 } }));
    expected.push(`Punto ${i}:`, `revisar el módulo número ${i}`, `Criterio ${i}.a`, `Subcriterio ${i}.a.1`);
  }
  const cell = (t) => new TableCell({ children: [new Paragraph(t)] });
  children.push(new Table({ rows: [new TableRow({ children: [cell('Responsable'), cell('Plazo')] }), new TableRow({ children: [cell('Ana'), cell('viernes')] })] }));
  expected.push('Responsable', 'viernes');
  await writeFile(path, await Packer.toBuffer(new Document({ sections: [{ children }] })));
  return expected;
}

/**
 * PDF of `pages` pages. Those in `scanned` carry no text: only an image, like a scan.
 * Each page with text has a line with its number to check the order.
 */
export async function makePdf(path, pages = 20, { scanned = [] } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const noise = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#dddddd' } }).png().toBuffer();
  const image = await doc.embedPng(noise);
  for (let n = 1; n <= pages; n++) {
    const page = doc.addPage([595, 842]);
    if (scanned.includes(n)) {
      page.drawImage(image, { x: 50, y: 600, width: 400, height: 200 });
      continue;
    }
    page.drawText(`Contenido de la página ${n}`, { x: 50, y: 780, size: 16, font });
    for (let line = 1; line <= 12; line++) {
      page.drawText(`Línea ${line} de la página ${n}: el equipo revisa la pantalla de pagos.`, { x: 50, y: 780 - line * 22, size: 11, font });
    }
  }
  await writeFile(path, await doc.save());
}

// ---- audio and video -------------------------------------------------------------------------

/** Tone of `seconds` seconds in AAC inside an m4a, like a phone voice note. */
export async function makeAudio(path, seconds, { codecArgs = ['-c:a', 'aac', '-b:a', '96k'] } = {}) {
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, ...codecArgs, path]);
  return path;
}

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Video of `screens` distinct screens of `secondsPerScreen` seconds each (seeded gray
 * blocks), with an optional audio track. Returns the duration.
 */
export async function makeVideo(path, { screens = 6, secondsPerScreen = 4, audio = true, width = 640, height = 360 } = {}) {
  const dir = `${path}.frames`;
  await mkdir(dir, { recursive: true });
  let n = 0;
  for (let s = 0; s < screens; s++) {
    const rand = prng(1000 + s * 7919);
    const cols = 16;
    const rows = 9;
    const gray = Array.from({ length: cols * rows }, () => Math.floor(rand() * 256));
    const raw = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = gray[Math.floor((y / height) * rows) * cols + Math.floor((x / width) * cols)];
        const i = (y * width + x) * 3;
        raw[i] = raw[i + 1] = raw[i + 2] = v;
      }
    }
    const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
    for (let k = 0; k < secondsPerScreen; k++) await writeFile(join(dir, `f${String(n++).padStart(4, '0')}.png`), png);
  }
  const seconds = screens * secondsPerScreen;
  const args = ['-v', 'error', '-y', '-framerate', '1', '-i', join(dir, 'f%04d.png')];
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`);
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '5');
  if (audio) args.push('-c:a', 'aac', '-shortest');
  args.push(path);
  await exec('ffmpeg', args);
  await rm(dir, { recursive: true, force: true });
  return seconds;
}

// ---- fake providers --------------------------------------------------------------------

/** Fake vision: describes each image by its label; records the calls. */
export function fakeVision({ failWith } = {}) {
  const calls = [];
  return {
    calls,
    async describe({ images, prompt, schema }) {
      calls.push({ images, prompt, schema });
      if (failWith) throw failWith;
      const usage = { input_tokens: images.length * 1456, output_tokens: 50 };
      if (schema?.properties?.frames) {
        return { json: { frames: images.map((_, i) => ({ index: i + 1, description: `pantalla distinta ${i + 1}` })) }, usage };
      }
      return { json: { description: `descripción doble de ${images.map((i) => i.label).join(', ')}` }, usage };
    },
  };
}

/**
 * Fake speech: returns one segment every `every` seconds of the received chunk's length (each one
 * ends its sentence with a period, so that joining segments does not merge them) and records the
 * shape of the file (codec, sample rate, channels, duration).
 * With `punctuate: false` the segments carry no final period: the running speech of a real provider.
 */
export function fakeSpeech({ every = 5, failWith, punctuate = true } = {}) {
  const calls = [];
  return {
    calls,
    async transcribe({ audioPath, language, prompt }) {
      const info = await ffprobeJson(audioPath);
      const stream = info.streams.find((s) => s.codec_type === 'audio');
      const duration = Number.parseFloat(info.format.duration);
      calls.push({ audioPath, language, prompt, codec: stream.codec_name, sampleRate: Number(stream.sample_rate), channels: stream.channels, duration });
      if (failWith) throw failWith;
      const segments = [];
      for (let t = 0; t < duration - 0.5; t += every) segments.push({ start: t, end: Math.min(t + every, duration), text: ` segmento ${t}${punctuate ? '.' : ''}` });
      return { text: segments.map((s) => s.text).join(' '), segments };
    },
  };
}
