// Tests of Groq transcription against a local HTTP server.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ProviderHttpError } from './errors.js';
import { createGroqSpeechClient } from './groq-speech.js';
import { startLocalServer } from './local-server.js';

describe('groq-speech', () => {
  let server;
  let dir;
  let audioPath;
  let reply;
  before(async () => {
    server = await startLocalServer(() => reply());
    dir = await mkdtemp(join(tmpdir(), 'team-speech-'));
    audioPath = join(dir, 'nota.flac');
    await writeFile(audioPath, Buffer.from('audio-de-prueba'));
  });
  after(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  const client = () => createGroqSpeechClient({ apiKey: 'clave-de-prueba', baseUrl: server.url });

  it('requests verbose_json with segments, language and prompt, and returns segments with times', async () => {
    reply = () => ({
      body: {
        text: ' Hola equipo. Hay un error en el login.',
        language: 'spanish',
        duration: 12.5,
        segments: [
          { id: 0, start: 0, end: 3.2, text: ' Hola equipo.', no_speech_prob: 0.01 },
          { id: 1, start: 3.2, end: 12.5, text: ' Hay un error en el login.', no_speech_prob: 0.02 },
        ],
      },
    });
    const out = await client().transcribe({ audioPath, language: 'es', prompt: 'Refine, Fastify' });
    const req = server.requests.at(-1);
    assert.equal(req.url, '/audio/transcriptions');
    assert.equal(req.headers.authorization, 'Bearer clave-de-prueba');
    assert.match(req.headers['content-type'], /^multipart\/form-data/);
    for (const needle of [
      'name="model"', 'whisper-large-v3-turbo', 'name="response_format"', 'verbose_json',
      'name="timestamp_granularities[]"', 'segment', 'name="language"', 'name="prompt"', 'Refine, Fastify', 'filename="nota.flac"', 'audio-de-prueba',
    ]) {
      assert.ok(req.body.includes(needle), `«${needle}» is missing from the form`);
    }
    assert.equal(out.text, 'Hola equipo. Hay un error en el login.');
    assert.deepEqual(out.segments.map((s) => [s.start, s.end, s.text]), [[0, 3.2, 'Hola equipo.'], [3.2, 12.5, 'Hay un error en el login.']]);
    assert.equal(out.usage.audio_seconds, 12.5);
    assert.equal(out.provider, 'groq-speech');
    assert.equal(out.model, 'whisper-large-v3-turbo');
  });

  it('the default language is Spanish', async () => {
    reply = () => ({ body: { text: 'x', segments: [], duration: 1 } });
    await client().transcribe({ audioPath });
    const req = server.requests.at(-1);
    assert.match(req.body, /name="language"\r\n\r\nes\r\n/);
  });

  it('a 429 is a retryable ProviderHttpError', async () => {
    reply = () => ({ status: 429, headers: { 'retry-after': '3' }, body: { error: { message: 'límite de audio por hora' } } });
    await assert.rejects(
      client().transcribe({ audioPath }),
      (err) => err instanceof ProviderHttpError && err.retryable && err.retryAfterMs === 3000,
    );
  });
});
