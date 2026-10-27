// The image ships a minimal static ffmpeg (Dockerfile, stage `ffmpeg`; report
// docs/investigaciones/mediciones/2026-10-20-ffmpeg-minimo.md). These tests keep three things true:
//   1. the component lists of the Dockerfile and of scripts/check-ffmpeg.sh are the same;
//   2. inside the image (TEAM_FFMPEG_MINIMAL=1, set by the `extract-test` target) the binaries have every
//      decoder, demuxer, encoder, muxer, filter and protocol the extractors use (the check script);
//   3. every input codec and container the product accepts goes through the real extractors.
// Test inputs are generated with FIXTURE_FFMPEG, a full ffmpeg; the code under test uses `ffmpeg` on PATH.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { extract } from './index.js';
import { FIXTURE_FFMPEG, ffprobeJson, fakeSpeech, fakeVision, makeAudio, makeTmp, makeVideo } from './test/helpers.js';

const exec = promisify(execFile);
const root = new URL('../../', import.meta.url);
// The Dockerfile is not part of the image's build context (.dockerignore): the static checks run from the repository.
const HAS_SOURCES = existsSync(new URL('Dockerfile', root));
const dockerfile = HAS_SOURCES ? readFileSync(new URL('Dockerfile', root), 'utf8') : '';
const checkScript = existsSync(new URL('scripts/check-ffmpeg.sh', root)) ? readFileSync(new URL('scripts/check-ffmpeg.sh', root), 'utf8') : '';
const STATIC = { skip: !HAS_SOURCES && 'the Dockerfile is not in the image' };
const IN_IMAGE = process.env.TEAM_FFMPEG_MINIMAL === '1';

const FLAGS = { demuxer: 'DEMUXERS', parser: null, decoder: 'DECODERS', encoder: 'ENCODERS', muxer: 'MUXERS', filter: 'FILTERS', protocol: 'PROTOCOLS' };

function dockerfileList(kind) {
  const m = new RegExp(`--enable-${kind}=(\\S+)`).exec(dockerfile);
  assert.ok(m, `the Dockerfile has no --enable-${kind}=`);
  return m[1].split(',').sort();
}
function scriptList(variable) {
  const m = new RegExp(`^${variable}="([^"]+)"`, 'm').exec(checkScript);
  assert.ok(m, `check-ffmpeg.sh has no ${variable}`);
  return m[1].split(/\s+/).sort();
}

test('the Dockerfile and scripts/check-ffmpeg.sh list the same components', STATIC, () => {
  for (const [kind, variable] of Object.entries(FLAGS)) {
    if (!variable) continue;
    assert.deepEqual(scriptList(variable), dockerfileList(kind), `${kind} lists differ`);
  }
});

test('the ffmpeg stage pins the version and verifies the tarball checksums', STATIC, () => {
  assert.match(dockerfile, /^ARG FFMPEG_VERSION=\d+\.\d+(\.\d+)?$/m);
  assert.match(dockerfile, /^ARG FFMPEG_SHA256=[0-9a-f]{64}$/m);
  assert.match(dockerfile, /^ARG DAV1D_SHA256=[0-9a-f]{64}$/m);
  assert.equal((dockerfile.match(/sha256sum -c -/g) ?? []).length, 2);
});

test('the shipped image carries the two static binaries and not the Alpine ffmpeg package', STATIC, () => {
  const base = /FROM alpine:[\d.]+(?:@sha256:[0-9a-f]{64})? AS base\n([\s\S]*?)\n\n/.exec(dockerfile)?.[1] ?? '';
  assert.ok(base.includes('COPY --from=ffmpeg /out/bin/ffmpeg /out/bin/ffprobe /usr/local/bin/'));
  assert.ok(!/apk add[^\n]*\bffmpeg\b/.test(base), 'the base stage installs the full ffmpeg package');
  const finalStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM base\n'));
  assert.ok(!/apk add[^\n]*\bffmpeg\b/.test(finalStage));
});

test('inside the image: every component the extractors need is present (scripts/check-ffmpeg.sh)', { skip: !IN_IMAGE && 'only runs in the extract-test image (TEAM_FFMPEG_MINIMAL=1)' }, async () => {
  const { stdout } = await exec('sh', [new URL('scripts/check-ffmpeg.sh', root).pathname]);
  assert.match(stdout, /^check-ffmpeg: ok/);
});

// ---- every accepted codec and container through the real extractors ---------------------------

const tmp = await makeTmp('ffmpeg-image');
after(() => tmp.cleanup());

let encoders = new Set();
try {
  const { stdout } = await exec(FIXTURE_FFMPEG, ['-hide_banner', '-encoders']);
  encoders = new Set(stdout.split('\n').map((l) => l.trim().split(/\s+/)[1]));
} catch {}
/** Inside the image a missing fixture encoder is a failure, not a skip: otherwise the matrix could pass empty. */
const needs = (...names) => {
  const missing = names.filter((n) => !encoders.has(n));
  if (missing.length === 0) return false;
  assert.ok(!IN_IMAGE, `the fixture ffmpeg lacks the encoder ${missing.join(', ')}`);
  return `the fixture ffmpeg lacks ${missing.join(', ')}`;
};

const AUDIO = [
  { name: 'ogg opus (voice note)', file: 'a.ogg', codec: 'opus', args: ['-c:a', 'libopus', '-b:a', '24k'], encoders: ['libopus'], mime: 'audio/ogg' },
  { name: 'ogg vorbis', file: 'b.ogg', codec: 'vorbis', args: ['-c:a', 'libvorbis'], encoders: ['libvorbis'], mime: 'audio/ogg' },
  { name: 'm4a aac', file: 'c.m4a', codec: 'aac', args: ['-c:a', 'aac'], encoders: ['aac'], mime: 'audio/mp4' },
  { name: 'm4a alac', file: 'd.m4a', codec: 'alac', args: ['-c:a', 'alac'], encoders: ['alac'], mime: 'audio/mp4' },
  { name: 'aac ADTS', file: 'e.aac', codec: 'aac', args: ['-c:a', 'aac'], encoders: ['aac'], mime: 'audio/aac' },
  { name: 'mp3', file: 'f.mp3', codec: 'mp3', args: ['-c:a', 'libmp3lame'], encoders: ['libmp3lame'], mime: 'audio/mpeg' },
  { name: 'wav pcm_s16le', file: 'g.wav', codec: 'pcm_s16le', args: ['-c:a', 'pcm_s16le'], encoders: ['pcm_s16le'], mime: 'audio/wav' },
  { name: 'wav pcm_s24le', file: 'h.wav', codec: 'pcm_s24le', args: ['-c:a', 'pcm_s24le'], encoders: ['pcm_s24le'], mime: 'audio/wav' },
  { name: 'wav pcm_s32le', file: 'i.wav', codec: 'pcm_s32le', args: ['-c:a', 'pcm_s32le'], encoders: ['pcm_s32le'], mime: 'audio/wav' },
  { name: 'wav pcm_f32le', file: 'j.wav', codec: 'pcm_f32le', args: ['-c:a', 'pcm_f32le'], encoders: ['pcm_f32le'], mime: 'audio/wav' },
  { name: 'wav pcm_u8', file: 'k.wav', codec: 'pcm_u8', args: ['-c:a', 'pcm_u8'], encoders: ['pcm_u8'], mime: 'audio/wav' },
  { name: 'wav pcm_alaw', file: 'l.wav', codec: 'pcm_alaw', args: ['-c:a', 'pcm_alaw', '-ar', '8000'], encoders: ['pcm_alaw'], mime: 'audio/wav' },
  { name: 'wav pcm_mulaw', file: 'm.wav', codec: 'pcm_mulaw', args: ['-c:a', 'pcm_mulaw', '-ar', '8000'], encoders: ['pcm_mulaw'], mime: 'audio/wav' },
  { name: 'flac', file: 'n.flac', codec: 'flac', args: ['-c:a', 'flac'], encoders: ['flac'], mime: 'audio/flac' },
  { name: 'webm opus (browser recording)', file: 'o.webm', codec: 'opus', args: ['-c:a', 'libopus'], encoders: ['libopus'], mime: 'audio/webm' },
];

for (const v of AUDIO) {
  test(`audio ${v.name}: probed, cut to FLAC 16 kHz mono and passed to the transcription`, { skip: needs(...v.encoders) }, async () => {
    const path = tmp.join(v.file);
    await makeAudio(path, 6, { codecArgs: v.args });
    const probed = await ffprobeJson(path);
    assert.equal(probed.streams.find((s) => s.codec_type === 'audio').codec_name, v.codec, 'the fixture does not have the intended codec');
    const speech = fakeSpeech({ every: 5 });
    const att = { id: 'a', kind: 'audio', path, mime: v.mime, size: (await stat(path)).size };
    const { meta } = await extract(att, { providers: { speech } });
    assert.equal(speech.calls.length, 1);
    assert.deepEqual([speech.calls[0].codec, speech.calls[0].sampleRate, speech.calls[0].channels], ['flac', 16000, 1]);
    assert.ok(Math.abs(speech.calls[0].duration - 6) < 0.6, `the chunk lasts ${speech.calls[0].duration} s`);
    assert.ok(Math.abs(meta.durationSeconds - 6) < 0.6);
  });
}

// Six distinct screens of 4 s, 640x360, with audio: the same source in every container and video codec.
const source = tmp.join('source.mp4');
await makeVideo(source, { screens: 6, secondsPerScreen: 4 });

const VIDEO = [
  { name: 'mp4 h264 + aac (Android, WhatsApp)', file: 'v1.mp4', vcodec: 'h264', acodec: 'aac', args: ['-c', 'copy'], encoders: [] },
  { name: 'mov hevc + aac (iPhone)', file: 'v2.mov', vcodec: 'hevc', acodec: 'aac', args: ['-c:v', 'libx265', '-tag:v', 'hvc1', '-x265-params', 'log-level=error', '-c:a', 'aac'], encoders: ['libx265', 'aac'] },
  { name: 'webm vp8 + opus', file: 'v3.webm', vcodec: 'vp8', acodec: 'opus', args: ['-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libopus'], encoders: ['libvpx', 'libopus'] },
  { name: 'webm vp9 + opus', file: 'v4.webm', vcodec: 'vp9', acodec: 'opus', args: ['-c:v', 'libvpx-vp9', '-b:v', '1M', '-c:a', 'libopus'], encoders: ['libvpx-vp9', 'libopus'] },
  { name: 'mkv av1 + vorbis', file: 'v5.mkv', vcodec: 'av1', acodec: 'vorbis', args: ['-c:v', process.env.AV1_ENCODER ?? 'libsvtav1', '-c:a', 'libvorbis'], encoders: [process.env.AV1_ENCODER ?? 'libsvtav1', 'libvorbis'] },
  { name: 'mp4 h264 + mp3', file: 'v6.mp4', vcodec: 'h264', acodec: 'mp3', args: ['-c:v', 'copy', '-c:a', 'libmp3lame'], encoders: ['libmp3lame'] },
  { name: 'mp4 h264 without audio track', file: 'v7.mp4', vcodec: 'h264', acodec: null, args: ['-c:v', 'copy', '-an'], encoders: [] },
];

for (const v of VIDEO) {
  test(`video ${v.name}: probed, sampled at 1 fps to 720 px JPEG, audio track cut and transcribed`, { skip: needs(...v.encoders) }, async () => {
    const path = tmp.join(v.file);
    await exec(FIXTURE_FFMPEG, ['-v', 'error', '-y', '-i', source, ...v.args, path]);
    const streams = (await ffprobeJson(path)).streams;
    assert.equal(streams.find((s) => s.codec_type === 'video').codec_name, v.vcodec, 'the fixture does not have the intended video codec');
    assert.equal(streams.find((s) => s.codec_type === 'audio')?.codec_name ?? null, v.acodec, 'the fixture does not have the intended audio codec');
    const vision = fakeVision();
    const speech = fakeSpeech({ every: 5 });
    const att = { id: 'v', kind: 'video', path, mime: 'video/mp4', size: (await stat(path)).size };
    const { meta } = await extract(att, { providers: { vision, speech } });
    assert.ok(meta.sampledFrames >= 23 && meta.sampledFrames <= 25, `${meta.sampledFrames} frames sampled out of 24 s`);
    assert.equal(meta.frames.length, 6, 'six distinct screens');
    assert.equal(vision.calls[0].images[0].mime, 'image/jpeg');
    if (v.acodec) {
      assert.equal(speech.calls.length, 1);
      assert.deepEqual([speech.calls[0].codec, speech.calls[0].sampleRate, speech.calls[0].channels], ['flac', 16000, 1]);
    } else {
      assert.equal(speech.calls.length, 0);
    }
  });
}

test('a file that is not media fails with ffmpeg_failed, not with a crash', async () => {
  const path = tmp.join('not-media.mp3');
  await writeFile(path, 'this is plain text, not audio');
  await assert.rejects(
    extract({ id: 'x', kind: 'audio', path, mime: 'audio/mpeg', size: 30 }, { providers: { speech: fakeSpeech() } }),
    (e) => e.code === 'ffmpeg_failed' || e.code === 'audio_no_stream',
  );
});
