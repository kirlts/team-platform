// Hunt for the failures of the extraction (2026-10-24): files that arrive in a format or a state nobody tested, tools that die or hang,
// a job that stops while its halves are still running. Each case was reproduced before it was fixed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { after, before, describe, it } from 'node:test';
import { ProviderHttpError } from '../providers/errors.js';
import { extract } from './index.js';
import { run } from './lib/ffmpeg.js';
import { fakeSpeech, fakeVision, makeAudio, makeTmp, makeVideo } from './test/helpers.js';

const tmp = await makeTmp('caza-subida');
after(() => tmp.cleanup());

const att = async (kind, path, mime) => ({ id: 'a1', kind, path, mime, size: (await stat(path)).size });
const textAtt = async (name, bytes, mime = 'text/plain') => { const path = tmp.join(name); await writeFile(path, bytes); return att('document', path, mime); };

describe('text documents in the encodings people really save', () => {
  it('H-3811: a text file saved as UTF-16 (the «Unicode» option of the Windows editor) is read, not turned into text with null bytes', async () => {
    const original = 'Reunión del lunes\nRevisar la pantalla de pagos y el módulo número 3.';
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(original, 'utf16le')]);
    const { text } = await extract(await textAtt('utf16.txt', bytes));
    assert.equal(text, original);
    const big = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(original, 'utf16le').swap16()]);
    assert.equal((await extract(await textAtt('utf16be.txt', big))).text, original);
  });

  it('H-3811: a text file in Windows-1252 keeps its accents instead of replacement characters', async () => {
    const { text } = await extract(await textAtt('ansi.txt', Buffer.from('Reunión: revisar el camión y el año', 'latin1')));
    assert.equal(text, 'Reunión: revisar el camión y el año');
  });

  it('H-3811: a binary file that declares itself text fails with a reason instead of sending garbage to the analysis', async () => {
    const bytes = Buffer.concat([Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff, 0x00]), Buffer.alloc(200, 0)]);
    await assert.rejects(extract(await textAtt('binario.txt', bytes)), (e) => e.name === 'ExtractError' && e.code === 'document_unsupported');
  });
});

describe('the tools of the extraction', () => {
  it('H-3806: a tool that the system killed (out of memory) is told apart from a file it could not read, so the job is retried', async () => {
    await assert.rejects(run('sh', ['-c', 'kill -9 $$']), (e) => e.code === 'ffmpeg_killed');
    await assert.rejects(run('sh', ['-c', 'exit 3']), (e) => e.code === 'ffmpeg_failed');
  });

  it('H-3807: a tool that hangs is stopped at its own limit with a reason, and the job does not wait for the limit of the whole job', async () => {
    const started = Date.now();
    await assert.rejects(run('sleep', ['30'], { timeoutMs: 150 }), (e) => e.code === 'ffmpeg_timeout');
    assert.ok(Date.now() - started < 3000);
  });

  it('H-3812: the working directories that a killed worker left behind are removed on the next extraction; a recent one and an unrelated one stay', async () => {
    const work = tmp.join('work');
    await mkdir(work, { recursive: true });
    const old = new Date(Date.now() - 6 * 3600 * 1000);
    for (const name of ['tp-extract-stale', 'otro-directorio']) { await mkdir(`${work}/${name}`); await utimes(`${work}/${name}`, old, old); }
    await mkdir(`${work}/tp-extract-fresh`);
    await extract(await textAtt('x.txt', 'hola'), { config: { workDir: work } });
    assert.deepEqual((await readdir(work)).sort(), ['otro-directorio', 'tp-extract-fresh']);
  });

  it('H-3809: an audio-only file sent as video (an .mp4 with no picture) is transcribed instead of refused as «no video»', async () => {
    const path = tmp.join('solo-audio.mp4');
    await makeAudio(path, 3);
    const speech = fakeSpeech({ every: 5 });
    const { text, meta } = await extract(await att('video', path, 'video/mp4'), { providers: { vision: fakeVision(), speech } });
    assert.equal(speech.calls.length, 1);
    assert.match(text, /segmento 0/);
    assert.ok(meta.warnings.some((w) => w.code === 'audio_only'));
  });
});

describe('links', () => {
  let server;
  let base;
  before(async () => {
    server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

  it('H-3810: a name server that does not answer for a moment (EAI_AGAIN, timeout) is a failure that clears up, not «no se encontró el sitio»', async () => {
    const lookupFailing = (code) => async () => { throw Object.assign(new Error(code), { code }); };
    const a = { id: 'l1', kind: 'link', path: 'http://sitio-de-prueba.example/pagina' };
    await assert.rejects(extract(a, { deps: { lookup: lookupFailing('EAI_AGAIN') } }), (e) => e.code === 'link_fetch_failed');
    await assert.rejects(extract(a, { deps: { lookup: lookupFailing('ETIMEOUT') } }), (e) => e.code === 'link_fetch_failed');
    await assert.rejects(extract(a, { deps: { lookup: lookupFailing('ENOTFOUND') } }), (e) => e.code === 'link_unresolved');
    void base;
  });
});

describe('recordings made in the browser', () => {
  it('H-3808: a WebM voice note from the panel recorder, which carries no duration in its header, is measured and transcribed', async () => {
    const { execFile } = await import('node:child_process');
    const bytes = await new Promise((resolve, reject) => execFile('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:a', 'libopus', '-f', 'webm', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 24 }, (e, out) => (e ? reject(e) : resolve(out))));
    const path = tmp.join('grabacion.webm');
    await writeFile(path, bytes);
    const speech = fakeSpeech({ every: 5 });
    const { text, meta } = await extract(await att('audio', path, 'audio/webm'), { providers: { speech } });
    assert.ok(meta.durationSeconds > 11.5 && meta.durationSeconds < 12.5, `${meta.durationSeconds} s`);
    assert.equal(speech.calls.length, 1);
    assert.match(text, /segmento 0/);
    const { estimateAudioSeconds } = await import('./index.js');
    const billable = await estimateAudioSeconds(await att('audio', path, 'audio/webm'));
    assert.ok(billable >= 11.5 && billable < 13, `${billable} s billable`);
  });
});

describe('images', () => {
  it('H-3818: a photo cut short (a header that reads, a body that does not) fails as unreadable instead of reaching the provider', async () => {
    const sharp = (await import('sharp')).default;
    const raw = Buffer.from(Array.from({ length: 300 * 300 * 3 }, (_, i) => (i * 7919) % 251));
    for (const [name, format] of [['cortada.png', 'png'], ['cortada.jpg', 'jpeg']]) {
      const whole = await sharp(raw, { raw: { width: 300, height: 300, channels: 3 } }).toFormat(format).toBuffer();
      const path = tmp.join(name);
      await writeFile(path, whole.subarray(0, Math.floor(whole.length * 0.5)));
      const vision = fakeVision();
      await assert.rejects(extract(await att('image', path, `image/${format}`), { providers: { vision } }), (e) => e.code === 'image_unreadable', name);
      assert.equal(vision.calls.length, 0, 'the provider is never asked to describe it');
    }
  });
});

describe('a video whose two halves run at once', () => {
  it('H-3823: when the transcription fails, the frame extraction still running is stopped instead of being left to run for minutes', async () => {
    // A stand-in `ffmpeg` on the PATH: the audio cut fails at once, the frame extraction hangs for 31.37 s.
    const bin = tmp.join('fake-bin');
    await mkdir(bin, { recursive: true });
    await writeFile(`${bin}/ffmpeg`, '#!/bin/sh\ncase "$*" in\n  *flac*) echo "fallo de prueba" >&2; exit 1;;\n  *) exec sleep 31.37;;\nesac\n');
    await chmod(`${bin}/ffmpeg`, 0o755);
    const video = tmp.join('dos-mitades.mp4');
    await makeVideo(video, { screens: 2, secondsPerScreen: 2 });
    const running = () => execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n').filter((l) => /sleep 31\.37/.test(l)).map((l) => Number.parseInt(l.trim(), 10));
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath}`;
    try {
      await assert.rejects(extract(await att('video', video, 'video/mp4'), { providers: { vision: fakeVision(), speech: fakeSpeech() } }), (e) => e.code === 'ffmpeg_failed');
    } finally {
      process.env.PATH = oldPath;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    const left = running();
    for (const pid of left) process.kill(pid);
    assert.deepEqual(left, [], 'the frame extraction was left running');
  });
});

describe('an audio of several chunks', () => {
  it('H-3824: when one chunk fails the chunks still in flight are stopped, so they do not go on spending the provider hour for a job that failed', async () => {
    const path = tmp.join('larga.m4a');
    await makeAudio(path, 14); // three chunks of 5 s with their overlap (the knobs below)
    const stopped = [];
    const speech = {
      async transcribe({ audioPath }, { signal } = {}) {
        if (audioPath.endsWith('chunk-0000.flac')) throw new ProviderHttpError('groq-speech: HTTP 400', { status: 400, retryable: false });
        await new Promise((resolve) => { if (signal?.aborted) return resolve(); signal?.addEventListener('abort', resolve, { once: true }); setTimeout(resolve, 2500); });
        stopped.push({ audioPath, aborted: Boolean(signal?.aborted) });
        return { text: '', segments: [] };
      },
    };
    await assert.rejects(extract(await att('audio', path, 'audio/mp4'), { providers: { speech }, config: { audio: { chunkSeconds: 5, overlapSeconds: 1, minChunkSeconds: 2 } } }), (e) => e instanceof ProviderHttpError);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(stopped.length >= 1, 'another chunk was in flight');
    assert.ok(stopped.every((c) => c.aborted), `a chunk ran to its end: ${JSON.stringify(stopped)}`);
  });
});
