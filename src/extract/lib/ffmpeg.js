// ffmpeg and ffprobe via `spawn` (MASTER-SPEC §3, report 06 §1): no `fluent-ffmpeg`, no WASM.
import { spawn } from 'node:child_process';
import { ExtractError } from '../errors.js';
import { annotate, withSpan } from '../../telemetry/api.js';

const STDERR_TAIL = 2000;

// ffprobe reads the container header: seconds on a healthy file, even a 2 GB one on a mounted volume. One that takes longer is stuck.
const PROBE_TIMEOUT_MS = 60_000; // declared courtesy: no measurement; the job limit is 15 minutes and a stuck read would hold all of it
const PACKETS_TIMEOUT_MS = 120_000; // declared courtesy: reads every packet header of a file of up to 2 GB; twice the limit of the header read

/**
 * Runs a binary and returns stdout. Rejects with ExtractError if it exits with an error, is aborted, is killed by a signal
 * (`ffmpeg_killed`: the system's out-of-memory killer, a restart; it can clear up on retry) or outlives `timeoutMs` (`ffmpeg_timeout`).
 */
export function run(binary, args, { signal, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ExtractError('aborted', 'La extracción se canceló.'));
    const limit = timeoutMs ? AbortSignal.timeout(timeoutMs) : null;
    const both = limit ? (signal ? AbortSignal.any([signal, limit]) : limit) : signal;
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], signal: both });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      err = (err + d).slice(-STDERR_TAIL);
    });
    child.on('error', (e) => {
      if (e.name === 'AbortError') {
        if (limit?.aborted && !signal?.aborted) return reject(new ExtractError('ffmpeg_timeout', `${binary} tardó demasiado en responder y se detuvo.`, { timeoutMs }));
        return reject(new ExtractError('aborted', 'La extracción se canceló.'));
      }
      if (e.code === 'ENOENT') {
        return reject(new ExtractError('ffmpeg_missing', `No se encontró el programa ${binary} en el sistema.`));
      }
      reject(e);
    });
    child.on('close', (code, killedBy) => {
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      if (code === null && killedBy) return reject(new ExtractError('ffmpeg_killed', `${binary} se detuvo antes de terminar (${killedBy}).`, { signal: killedBy, stderr: err.trim() }));
      reject(new ExtractError('ffmpeg_failed', `${binary} no pudo procesar el archivo.`, { code, stderr: err.trim() }));
    });
  });
}

/**
 * Duration of a file whose container does not declare it, from the packets themselves: end of the last packet. A recording made in the
 * browser (MediaRecorder writes WebM to a stream that cannot seek back) has no duration in its header, and `ffprobe` answers «N/A».
 * It reads the packet headers, not the sound: seconds for the 25 MB of a long voice note.
 */
async function durationFromPackets(path, signal) {
  const raw = await run('ffprobe', ['-v', 'error', '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', path], { signal, timeoutMs: PACKETS_TIMEOUT_MS });
  let end = 0;
  for (const line of raw.split('\n')) {
    const [pts, duration] = line.split(',').map((v) => Number.parseFloat(v));
    if (Number.isFinite(pts)) end = Math.max(end, pts + (Number.isFinite(duration) ? duration : 0));
  }
  return end;
}

/** Duration in seconds and whether it has an audio or video track. */
export function probe(path, { signal } = {}) {
  return withSpan('extract.ffprobe', { 'team.step': 'extract.ffprobe', 'team.tool': 'ffprobe' }, async () => {
    const raw = await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path],
      { signal, timeoutMs: PROBE_TIMEOUT_MS },
    );
    const info = JSON.parse(raw);
    let duration = Number.parseFloat(info.format?.duration);
    const types = new Set((info.streams ?? []).map((s) => s.codec_type));
    if (!Number.isFinite(duration) && (types.has('audio') || types.has('video'))) duration = await durationFromPackets(path, signal);
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
