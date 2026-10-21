import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stat, readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { estimateAudioSeconds, extract } from './index.js';
import { buildTimeline } from './video.js';
import { fakeSpeech, fakeVision, makeTmp, makeVideo } from './test/helpers.js';

const tmp = await makeTmp('video');
after(() => tmp.cleanup());

const att = async (path) => ({ id: 'v1', kind: 'video', path, mime: 'video/mp4', size: (await stat(path)).size });

// Six distinct screens of 4 s with an audio track: 24 s.
const SCREENS = 6;
const SECONDS = 4;
const video = tmp.join('grabacion.mp4');
await makeVideo(video, { screens: SCREENS, secondsPerScreen: SECONDS });

test('a video becomes a timeline with one frame per distinct screen and the speech interleaved', async () => {
  const vision = fakeVision();
  const speech = fakeSpeech({ every: 5 });
  const progress = [];
  const { text, meta } = await extract(await att(video), { providers: { vision, speech }, onProgress: (p) => progress.push(p) });

  // A single vision call with the six screens, in temporal order and labeled.
  assert.equal(vision.calls.length, 1);
  const images = vision.calls[0].images;
  assert.equal(images.length, SCREENS);
  assert.deepEqual(images.map((i) => i.label), [0, 4, 8, 12, 16, 20].map((s, i) => `Fotograma ${i + 1} [${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}]`));
  for (const image of images) {
    assert.equal(image.mime, 'image/jpeg');
    assert.equal((await sharp(image.data).metadata()).width, 640, 'the video is 640 px: it is not enlarged to 720');
  }
  assert.deepEqual(meta.frames, [0, 4, 8, 12, 16, 20].map((second, i) => ({ number: i + 1, second })));
  assert.equal(meta.sampledFrames >= 23, true);

  // The audio went through the audio extractor.
  assert.equal(speech.calls.length, 1);
  assert.equal(speech.calls[0].codec, 'flac');
  assert.equal(meta.audioChunks, 1);

  const lines = text.split('\n');
  assert.equal(lines[0], '[00:00] Fotograma 1: pantalla distinta 1');
  assert.match(lines[1], /^\[00:00-00:05\] Voz: segmento 0$/);
  // Frames and speech in strict chronological order.
  const stamps = lines.map((l) => l.slice(1, 6));
  assert.deepEqual([...stamps].sort(), stamps);
  assert.equal(lines.filter((l) => l.includes('Fotograma')).length, SCREENS);
  assert.deepEqual(meta.calls.map((c) => c.modality), ['vision', 'speech']);
  assert.equal(progress.at(-1), 100);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] >= progress[i - 1]);
});

test('it is repeatable: the same video gives the same frames', async () => {
  const run = async () => (await extract(await att(video), { providers: { vision: fakeVision(), speech: fakeSpeech() } })).meta.frames;
  assert.deepEqual(await run(), await run());
});

test('the frame cap keeps those with the greatest change, the first included, in temporal order', async () => {
  const vision = fakeVision();
  const { meta } = await extract(await att(video), { providers: { vision, speech: fakeSpeech() }, config: { video: { maxFrames: 3 } } });
  assert.equal(vision.calls[0].images.length, 3);
  assert.equal(meta.frames.length, 3);
  assert.equal(meta.frames[0].second, 0);
  const seconds = meta.frames.map((f) => f.second);
  assert.deepEqual([...seconds].sort((a, b) => a - b), seconds);
});

test('a silent video only calls vision and warns that there is no track', async () => {
  const mute = tmp.join('mudo.mp4');
  await makeVideo(mute, { screens: 3, secondsPerScreen: 3, audio: false });
  const speech = fakeSpeech();
  const { text, meta } = await extract(await att(mute), { providers: { vision: fakeVision(), speech } });
  assert.equal(speech.calls.length, 0);
  assert.equal(meta.warnings.some((w) => w.code === 'no_audio_track'), true);
  assert.equal(text.split('\n').length, 3);
  assert.equal(meta.audioChunks, 0);
});

test('a video longer than the cap is rejected before processing it', async () => {
  const vision = fakeVision();
  await assert.rejects(
    extract(await att(video), { providers: { vision, speech: fakeSpeech() }, config: { video: { maxSeconds: 10 } } }),
    (e) => e.code === 'video_too_long' && e.details.max === 10,
  );
  assert.equal(vision.calls.length, 0);
});

test('a video heavier than the cap is rejected before processing it', async () => {
  await assert.rejects(
    extract(await att(video), { providers: { vision: fakeVision(), speech: fakeSpeech() }, config: { video: { maxBytes: 1000 } } }),
    (e) => e.code === 'video_too_large',
  );
});

test('a file that is not a video is rejected', async () => {
  const bad = tmp.join('falso.mp4');
  await import('node:fs/promises').then((fs) => fs.writeFile(bad, 'nada'));
  await assert.rejects(extract(await att(bad), { providers: { vision: fakeVision(), speech: fakeSpeech() } }), (e) => e.code === 'ffmpeg_failed');
});

test('a frame without a description from the provider ends up with a warning', async () => {
  const vision = { async describe({ images }) { return { json: { frames: [{ index: 1, description: 'sólo la primera' }] }, usage: {} }; } };
  const { meta, text } = await extract(await att(video), { providers: { vision, speech: fakeSpeech() } });
  assert.equal(meta.warnings.some((w) => w.code === 'frames_without_description'), true);
  assert.ok(text.includes('Fotograma 1: sólo la primera'));
});

test('no working files remain after extracting', async () => {
  const workDir = tmp.join('trabajo-video');
  await extract(await att(video), { providers: { vision: fakeVision(), speech: fakeSpeech() }, config: { workDir } });
  assert.deepEqual(await readdir(workDir), []);
});

test('the audio budget of a video counts only the audio track', async () => {
  const seconds = await estimateAudioSeconds(await att(video));
  assert.ok(Math.abs(seconds - 24) < 1);
});

test('the timeline puts the frame before the speech that starts in the same second', () => {
  const text = buildTimeline(
    [{ number: 1, second: 0, description: 'login' }, { number: 2, second: 8, description: 'error' }],
    [{ start: 0, end: 7, text: 'abro la app' }, { start: 8, end: 15, text: 'sale un error' }],
  );
  assert.equal(text, ['[00:00] Fotograma 1: login', '[00:00-00:07] Voz: abro la app', '[00:08] Fotograma 2: error', '[00:08-00:15] Voz: sale un error'].join('\n'));
});
