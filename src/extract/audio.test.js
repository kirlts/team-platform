import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { estimateAudioSeconds, extract } from './index.js';
import { fakeSpeech, makeAudio, makeTmp, makeVideo } from './test/helpers.js';

const tmp = await makeTmp('audio');
after(() => tmp.cleanup());

const att = async (path, mime = 'audio/mp4') => ({ id: 'au1', kind: 'audio', path, mime, size: (await stat(path)).size });

test('a short audio goes in a single FLAC 16 kHz mono chunk with language=es and mm:ss marks', async () => {
  const path = await makeAudio(tmp.join('nota.m4a'), 12);
  const speech = fakeSpeech({ every: 5 });
  const progress = [];
  const { text, meta } = await extract(await att(path), { providers: { speech }, onProgress: (p, f) => progress.push([p, f]) });

  assert.equal(speech.calls.length, 1);
  const call = speech.calls[0];
  assert.equal(call.codec, 'flac');
  assert.equal(call.sampleRate, 16000);
  assert.equal(call.channels, 1);
  assert.equal(call.language, 'es');
  assert.equal('prompt' in call && call.prompt !== undefined, false, 'without vocabulary no prompt is sent');
  assert.equal(text, '[00:00] segmento 0.\n[00:05] segmento 5.\n[00:10] segmento 10.');
  assert.equal(meta.chunks, 1);
  assert.ok(meta.durationSeconds > 11.9 && meta.durationSeconds < 12.2);
  assert.equal(meta.billableSeconds, meta.durationSeconds);
  assert.deepEqual(meta.calls[0].modality, 'speech');
  assert.equal(progress.at(-1)[0], 100);
});

test('the configured vocabulary travels as the prompt and nothing else', async () => {
  const path = await makeAudio(tmp.join('vocab.m4a'), 11);
  const speech = fakeSpeech();
  await extract(await att(path), { providers: { speech }, config: { audio: { vocabulary: 'Sidebar, ComposeBar, Ana' } } });
  assert.equal(speech.calls[0].prompt, 'Sidebar, ComposeBar, Ana');
});

test('a long audio is split into overlapping chunks and merged without repeating', async () => {
  const path = await makeAudio(tmp.join('largo.m4a'), 50);
  const speech = fakeSpeech({ every: 5 });
  const progress = [];
  const { text, meta } = await extract(await att(path), {
    providers: { speech },
    config: { audio: { chunkSeconds: 20, overlapSeconds: 5, minChunkSeconds: 10 } },
    onProgress: (p) => progress.push(p),
  });

  assert.equal(meta.chunks, 3);
  assert.equal(speech.calls.length, 3);
  const durations = speech.calls.map((c) => Math.round(c.duration)).sort((a, b) => a - b);
  assert.deepEqual(durations, [20, 20, 20]);
  const lines = text.split('\n');
  assert.deepEqual(lines.map((l) => l.slice(0, 7)), ['[00:00]', '[00:05]', '[00:10]', '[00:15]', '[00:20]', '[00:25]', '[00:30]', '[00:35]', '[00:40]', '[00:45]']);
  assert.equal(meta.segments, 10);
  // The budget counts the overlaps: 3 requests of 20 s.
  assert.equal(meta.billableSeconds, 60);
  // One step per chunk: the percentage comes from completed steps, 33, 66, 100.
  assert.deepEqual([...new Set(progress)], [0, 33, 66, 100]);
});

test('the queue asks how many seconds an audio will bill before claiming it', async () => {
  const path = await makeAudio(tmp.join('estimar.m4a'), 50);
  const seconds = await estimateAudioSeconds(await att(path), { config: { audio: { chunkSeconds: 20, overlapSeconds: 5, minChunkSeconds: 10 } } });
  assert.equal(seconds, 60);
  assert.equal(await estimateAudioSeconds({ kind: 'image', path }), 0);
});

test('an audio under 10 s is billed as 10 s', async () => {
  const path = await makeAudio(tmp.join('cortito.m4a'), 3);
  assert.equal(await estimateAudioSeconds(await att(path)), 10);
});

test('a file that is not audio is rejected', async () => {
  const path = tmp.join('texto.m4a');
  await import('node:fs/promises').then((fs) => fs.writeFile(path, 'no es audio'));
  await assert.rejects(extract(await att(path), { providers: { speech: fakeSpeech() } }), (e) => e.code === 'ffmpeg_failed');
});

test('a silent video sent as audio is rejected for having no track', async () => {
  const path = tmp.join('mudo.mp4');
  await makeVideo(path, { screens: 2, secondsPerScreen: 2, audio: false });
  await assert.rejects(extract(await att(path, 'video/mp4'), { providers: { speech: fakeSpeech() } }), (e) => e.code === 'audio_no_stream');
});

test('a failing provider propagates the error and leaves no working files', async () => {
  const path = await makeAudio(tmp.join('falla.m4a'), 11);
  const workDir = tmp.join('trabajo');
  const boom = new Error('provider down');
  await assert.rejects(extract(await att(path), { providers: { speech: fakeSpeech({ failWith: boom }) }, config: { workDir } }), /provider down/);
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(workDir), []);
});

test('a provider without segments contributes its text as a single segment of the chunk', async () => {
  const path = await makeAudio(tmp.join('sin-segmentos.m4a'), 11);
  const speech = { async transcribe() { return { text: ' hola equipo ', segments: [] }; } };
  const { text } = await extract(await att(path), { providers: { speech } });
  assert.equal(text, '[00:00] hola equipo');
});

test('an audio without speech ends up with a warning and empty text', async () => {
  const path = await makeAudio(tmp.join('silencio.m4a'), 11);
  const speech = { async transcribe() { return { text: '', segments: [] }; } };
  const { text, meta } = await extract(await att(path), { providers: { speech } });
  assert.equal(text, '');
  assert.equal(meta.warnings[0].code, 'no_speech');
});

test('an audio over the maximum size is rejected before reading it', async () => {
  const path = await makeAudio(tmp.join('pesado.m4a'), 11);
  await assert.rejects(extract(await att(path), { providers: { speech: fakeSpeech() }, config: { audio: { maxBytes: 100 } } }), (e) => e.code === 'audio_too_large');
});

test('the track of a WAV with the native rate of the provider is also normalized', async () => {
  const path = await makeAudio(tmp.join('estudio.wav'), 11, { codecArgs: ['-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le'] });
  const speech = fakeSpeech();
  await extract(await att(path, 'audio/wav'), { providers: { speech } });
  assert.equal(speech.calls[0].sampleRate, 16000);
  assert.equal(speech.calls[0].channels, 1);
});

test('phrase-sized segments from the provider come out as sentence lines, split at long pauses', async () => {
  const path = await makeAudio(tmp.join('frases.m4a'), 11);
  const segments = [
    { start: 0, end: 1.5, text: ' pues' },
    { start: 1.5, end: 3, text: ' cachai' },
    { start: 3, end: 4, text: ' que el menú no abre.' },
    { start: 4, end: 4.8, text: ' Eso.' },
    { start: 4.8, end: 6, text: ' dos cositas,' },
    { start: 6, end: 8, text: ' una sí y la otra no' },
    { start: 9.4, end: 10.5, text: ' y listo' },
  ];
  const speech = { async transcribe() { return { text: '', segments }; } };
  const { text, meta } = await extract(await att(path), { providers: { speech } });
  assert.equal(text, '[00:00] pues cachai que el menú no abre.\n[00:04] Eso.\n[00:04] dos cositas, una sí y la otra no\n[00:09] y listo');
  assert.equal(meta.segments, 4);
});

test('fragments are joined inside a chunk and never across the cut between two chunks', async () => {
  const path = await makeAudio(tmp.join('corrido.m4a'), 50);
  const speech = fakeSpeech({ every: 5, punctuate: false });
  const { text } = await extract(await att(path), {
    providers: { speech },
    config: { audio: { chunkSeconds: 20, overlapSeconds: 5, minChunkSeconds: 10 } },
  });
  // The cuts fall at 17.5 s and 32.5 s: three lines, one per chunk, each starting at its first kept fragment.
  assert.deepEqual(text.split('\n').map((l) => l.slice(0, 7)), ['[00:00]', '[00:20]', '[00:35]']);
});

test('the pause threshold and the word cap are knobs of the audio section', async () => {
  const path = await makeAudio(tmp.join('perillas.m4a'), 50);
  const run = async (audio) => (await extract(await att(path), { providers: { speech: fakeSpeech({ every: 5, punctuate: false }) }, config: { audio } })).text.split('\n').length;
  assert.equal(await run({ pauseSeconds: 0 }), 10, 'a zero threshold keeps one line per segment');
  assert.equal(await run({ maxUnitWords: 3 }), 10, 'a word cap of three words (each fake segment has two) keeps one line per segment');
});
