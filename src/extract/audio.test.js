import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { estimateAudioSeconds, extract } from './index.js';
import { fakeSpeech, makeAudio, makeTmp, makeVideo } from './test/helpers.js';

const tmp = await makeTmp('audio');
after(() => tmp.cleanup());

const att = async (path, mime = 'audio/mp4') => ({ id: 'au1', kind: 'audio', path, mime, size: (await stat(path)).size });

test('un audio corto va en un solo trozo FLAC 16 kHz mono con language=es y marcas mm:ss', async () => {
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
  assert.equal('prompt' in call && call.prompt !== undefined, false, 'sin vocabulario no se envía prompt');
  assert.equal(text, '[00:00] segmento 0\n[00:05] segmento 5\n[00:10] segmento 10');
  assert.equal(meta.chunks, 1);
  assert.ok(meta.durationSeconds > 11.9 && meta.durationSeconds < 12.2);
  assert.equal(meta.billableSeconds, meta.durationSeconds);
  assert.deepEqual(meta.calls[0].modality, 'speech');
  assert.equal(progress.at(-1)[0], 100);
});

test('el vocabulario configurado viaja como prompt y nada más', async () => {
  const path = await makeAudio(tmp.join('vocab.m4a'), 11);
  const speech = fakeSpeech();
  await extract(await att(path), { providers: { speech }, config: { audio: { vocabulary: 'Sidebar, ComposeBar, Ana' } } });
  assert.equal(speech.calls[0].prompt, 'Sidebar, ComposeBar, Ana');
});

test('un audio largo se parte en trozos con solapamiento y se fusiona sin repetir', async () => {
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
  // El presupuesto cuenta los solapamientos: 3 solicitudes de 20 s.
  assert.equal(meta.billableSeconds, 60);
  // Un paso por trozo: el porcentaje sale de pasos completados, 33, 66, 100.
  assert.deepEqual([...new Set(progress)], [0, 33, 66, 100]);
});

test('la cola consulta cuántos segundos facturará un audio antes de reclamarlo', async () => {
  const path = await makeAudio(tmp.join('estimar.m4a'), 50);
  const seconds = await estimateAudioSeconds(await att(path), { config: { audio: { chunkSeconds: 20, overlapSeconds: 5, minChunkSeconds: 10 } } });
  assert.equal(seconds, 60);
  assert.equal(await estimateAudioSeconds({ kind: 'image', path }), 0);
});

test('un audio de menos de 10 s se factura como 10 s', async () => {
  const path = await makeAudio(tmp.join('cortito.m4a'), 3);
  assert.equal(await estimateAudioSeconds(await att(path)), 10);
});

test('un archivo que no es audio se rechaza', async () => {
  const path = tmp.join('texto.m4a');
  await import('node:fs/promises').then((fs) => fs.writeFile(path, 'no es audio'));
  await assert.rejects(extract(await att(path), { providers: { speech: fakeSpeech() } }), (e) => e.code === 'ffmpeg_failed');
});

test('un video mudo enviado como audio se rechaza por no tener pista', async () => {
  const path = tmp.join('mudo.mp4');
  await makeVideo(path, { screens: 2, secondsPerScreen: 2, audio: false });
  await assert.rejects(extract(await att(path, 'video/mp4'), { providers: { speech: fakeSpeech() } }), (e) => e.code === 'audio_no_stream');
});

test('un proveedor que falla propaga el error y no deja archivos de trabajo', async () => {
  const path = await makeAudio(tmp.join('falla.m4a'), 11);
  const workDir = tmp.join('trabajo');
  const boom = new Error('proveedor caído');
  await assert.rejects(extract(await att(path), { providers: { speech: fakeSpeech({ failWith: boom }) }, config: { workDir } }), /proveedor caído/);
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(workDir), []);
});

test('un proveedor sin segmentos aporta su texto como un único segmento del trozo', async () => {
  const path = await makeAudio(tmp.join('sin-segmentos.m4a'), 11);
  const speech = { async transcribe() { return { text: ' hola equipo ', segments: [] }; } };
  const { text } = await extract(await att(path), { providers: { speech } });
  assert.equal(text, '[00:00] hola equipo');
});

test('un audio sin voz queda con aviso y texto vacío', async () => {
  const path = await makeAudio(tmp.join('silencio.m4a'), 11);
  const speech = { async transcribe() { return { text: '', segments: [] }; } };
  const { text, meta } = await extract(await att(path), { providers: { speech } });
  assert.equal(text, '');
  assert.equal(meta.warnings[0].code, 'no_speech');
});

test('un audio sobre el tamaño máximo se rechaza antes de leerlo', async () => {
  const path = await makeAudio(tmp.join('pesado.m4a'), 11);
  await assert.rejects(extract(await att(path), { providers: { speech: fakeSpeech() }, config: { audio: { maxBytes: 100 } } }), (e) => e.code === 'audio_too_large');
});

test('la pista de un WAV con la tasa nativa del proveedor también se normaliza', async () => {
  const path = await makeAudio(tmp.join('estudio.wav'), 11, { codecArgs: ['-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le'] });
  const speech = fakeSpeech();
  await extract(await att(path, 'audio/wav'), { providers: { speech } });
  assert.equal(speech.calls[0].sampleRate, 16000);
  assert.equal(speech.calls[0].channels, 1);
});
