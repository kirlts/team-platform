// ffmpeg and ffprobe via `spawn` (MASTER-SPEC §3, report 06 §1): no `fluent-ffmpeg`, no WASM.
import { spawn } from 'node:child_process';
import { ExtractError } from '../errors.js';
import { annotate, withSpan } from '../../telemetry/api.js';

const STDERR_TAIL = 2000;

/** Runs a binary and returns stdout. Rejects with ExtractError if it exits with an error or is aborted. */
export function run(binary, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ExtractError('aborted', 'La extracción se canceló.'));
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], signal });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      err = (err + d).slice(-STDERR_TAIL);
    });
    child.on('error', (e) => {
      if (e.name === 'AbortError') return reject(new ExtractError('aborted', 'La extracción se canceló.'));
      if (e.code === 'ENOENT') {
        return reject(new ExtractError('ffmpeg_missing', `No se encontró el programa ${binary} en el sistema.`));
      }
      reject(e);
    });
    child.on('close', (code) => {
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      reject(new ExtractError('ffmpeg_failed', `${binary} no pudo procesar el archivo.`, { code, stderr: err.trim() }));
    });
  });
}

/** Duration in seconds and whether it has an audio or video track. */
export function probe(path, { signal } = {}) {
  return withSpan('extract.ffprobe', { 'team.step': 'extract.ffprobe', 'team.tool': 'ffprobe' }, async () => {
    const raw = await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path],
      { signal },
    );
    const info = JSON.parse(raw);
    const duration = Number.parseFloat(info.format?.duration);
    const types = new Set((info.streams ?? []).map((s) => s.codec_type));
    const result = {
      durationSeconds: Number.isFinite(duration) ? duration : 0,
      hasAudio: types.has('audio'),
      hasVideo: types.has('video'),
    };
    annotate({
      'team.output_bytes': raw.length,
      'team.duration_seconds': result.durationSeconds,
      'team.has_audio': result.hasAudio,
      'team.has_video': result.hasVideo,
    });
    return result;
  });
}
