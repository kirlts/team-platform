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

// Seis pantallas distintas de 4 s con pista de audio: 24 s.
const SCREENS = 6;
const SECONDS = 4;
const video = tmp.join('grabacion.mp4');
await makeVideo(video, { screens: SCREENS, secondsPerScreen: SECONDS });

test('un video queda como línea de tiempo con un fotograma por pantalla distinta y la voz intercalada', async () => {
  const vision = fakeVision();
  const speech = fakeSpeech({ every: 5 });
  const progress = [];
  const { text, meta } = await extract(await att(video), { providers: { vision, speech }, onProgress: (p) => progress.push(p) });

  // Una sola llamada de visión con las seis pantallas, en orden temporal y rotuladas.
  assert.equal(vision.calls.length, 1);
  const images = vision.calls[0].images;
  assert.equal(images.length, SCREENS);
  assert.deepEqual(images.map((i) => i.label), [0, 4, 8, 12, 16, 20].map((s, i) => `Fotograma ${i + 1} [${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}]`));
  for (const image of images) {
    assert.equal(image.mime, 'image/jpeg');
    assert.equal((await sharp(image.data).metadata()).width, 640, 'el video es de 640 px: no se agranda a 720');
  }
  assert.deepEqual(meta.frames, [0, 4, 8, 12, 16, 20].map((second, i) => ({ number: i + 1, second })));
  assert.equal(meta.sampledFrames >= 23, true);

  // El audio pasó por el extractor de audio.
  assert.equal(speech.calls.length, 1);
  assert.equal(speech.calls[0].codec, 'flac');
  assert.equal(meta.audioChunks, 1);

  const lines = text.split('\n');
  assert.equal(lines[0], '[00:00] Fotograma 1: pantalla distinta 1');
  assert.match(lines[1], /^\[00:00-00:05\] Voz: segmento 0\.$/);
  // Fotogramas y voz en orden cronológico estricto.
  const stamps = lines.map((l) => l.slice(1, 6));
  assert.deepEqual([...stamps].sort(), stamps);
  assert.equal(lines.filter((l) => l.includes('Fotograma')).length, SCREENS);
  assert.deepEqual(meta.calls.map((c) => c.modality), ['vision', 'speech']);
  assert.equal(progress.at(-1), 100);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] >= progress[i - 1]);
});

test('es repetible: el mismo video da los mismos fotogramas', async () => {
  const run = async () => (await extract(await att(video), { providers: { vision: fakeVision(), speech: fakeSpeech() } })).meta.frames;
  assert.deepEqual(await run(), await run());
});

test('el tope de fotogramas deja los de mayor cambio, el primero incluido, en orden temporal', async () => {
  const vision = fakeVision();
  const { meta } = await extract(await att(video), { providers: { vision, speech: fakeSpeech() }, config: { video: { maxFrames: 3 } } });
  assert.equal(vision.calls[0].images.length, 3);
  assert.equal(meta.frames.length, 3);
  assert.equal(meta.frames[0].second, 0);
  const seconds = meta.frames.map((f) => f.second);
  assert.deepEqual([...seconds].sort((a, b) => a - b), seconds);
});

test('un video mudo sólo llama a la visión y avisa que no hay pista', async () => {
  const mute = tmp.join('mudo.mp4');
  await makeVideo(mute, { screens: 3, secondsPerScreen: 3, audio: false });
  const speech = fakeSpeech();
  const { text, meta } = await extract(await att(mute), { providers: { vision: fakeVision(), speech } });
  assert.equal(speech.calls.length, 0);
  assert.equal(meta.warnings.some((w) => w.code === 'no_audio_track'), true);
  assert.equal(text.split('\n').length, 3);
  assert.equal(meta.audioChunks, 0);
});

test('un video más largo que el tope se rechaza antes de procesarlo', async () => {
  const vision = fakeVision();
  await assert.rejects(
    extract(await att(video), { providers: { vision, speech: fakeSpeech() }, config: { video: { maxSeconds: 10 } } }),
    (e) => e.code === 'video_too_long' && e.details.max === 10,
  );
  assert.equal(vision.calls.length, 0);
});

test('un video más pesado que el tope se rechaza antes de procesarlo', async () => {
  await assert.rejects(
    extract(await att(video), { providers: { vision: fakeVision(), speech: fakeSpeech() }, config: { video: { maxBytes: 1000 } } }),
    (e) => e.code === 'video_too_large',
  );
});

test('un archivo que no es video se rechaza', async () => {
  const bad = tmp.join('falso.mp4');
  await import('node:fs/promises').then((fs) => fs.writeFile(bad, 'nada'));
  await assert.rejects(extract(await att(bad), { providers: { vision: fakeVision(), speech: fakeSpeech() } }), (e) => e.code === 'ffmpeg_failed');
});

test('un fotograma sin descripción del proveedor queda con aviso', async () => {
  const vision = { async describe({ images }) { return { json: { frames: [{ index: 1, description: 'sólo la primera' }] }, usage: {} }; } };
  const { meta, text } = await extract(await att(video), { providers: { vision, speech: fakeSpeech() } });
  assert.equal(meta.warnings.some((w) => w.code === 'frames_without_description'), true);
  assert.ok(text.includes('Fotograma 1: sólo la primera'));
});

test('no quedan archivos de trabajo después de extraer', async () => {
  const workDir = tmp.join('trabajo-video');
  await extract(await att(video), { providers: { vision: fakeVision(), speech: fakeSpeech() }, config: { workDir } });
  assert.deepEqual(await readdir(workDir), []);
});

test('el presupuesto de audio de un video cuenta sólo la pista de audio', async () => {
  const seconds = await estimateAudioSeconds(await att(video));
  assert.ok(Math.abs(seconds - 24) < 1);
});

test('la línea de tiempo pone el fotograma antes de la voz que empieza en el mismo segundo', () => {
  const text = buildTimeline(
    [{ number: 1, second: 0, description: 'login' }, { number: 2, second: 8, description: 'error' }],
    [{ start: 0, end: 7, text: 'abro la app' }, { start: 8, end: 15, text: 'sale un error' }],
  );
  assert.equal(text, ['[00:00] Fotograma 1: login', '[00:00-00:07] Voz: abro la app', '[00:08] Fotograma 2: error', '[00:08-00:15] Voz: sale un error'].join('\n'));
});
