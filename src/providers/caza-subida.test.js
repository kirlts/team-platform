// Hunt for the failures of the transcription provider (2026-10-24): an answer that is not a transcription, and a call that outlives the job that asked for it.
// Each case was reproduced before it was fixed.
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ProviderHttpError } from './errors.js';
import { createGroqSpeechClient } from './groq-speech.js';
import { startLocalServer } from './local-server.js';

describe('the transcription provider', () => {
  let server;
  let audioPath;
  let dir;
  let reply;
  before(async () => {
    server = await startLocalServer((req) => reply(req));
    dir = await mkdtemp(join(tmpdir(), 'team-speech-'));
    audioPath = join(dir, 'nota.flac');
    await writeFile(audioPath, Buffer.from('audio-de-prueba'));
  });
  after(async () => { await server.close(); await rm(dir, { recursive: true, force: true }); });
  const client = (extra = {}) => createGroqSpeechClient({ apiKey: 'clave-de-prueba', baseUrl: server.url, ...extra });

  it('H-3805: a 200 that is not a transcription (an HTML page, an empty body, JSON with no text) is a failure to retry, not a silent recording', async () => {
    for (const body of ['<html><body>Sign in to the network</body></html>', '', '{}', '{"segments":[]}']) {
      reply = () => ({ status: 200, body });
      await assert.rejects(client().transcribe({ audioPath }), (e) => e instanceof ProviderHttpError && e.retryable === true, JSON.stringify(body));
    }
    reply = () => ({ body: { text: '', segments: [], duration: 4 } });
    assert.equal((await client().transcribe({ audioPath })).text, '', 'a real silence is still an empty text');
  });

  it('H-3804: a call in flight ends when the job is told to stop, instead of holding the worker until its own 15 minutes', async () => {
    reply = () => new Promise(() => {});
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort('shutdown'), 100);
    const gaveUp = new Promise((_, reject) => setTimeout(() => reject(new Error('the call was still running 3 s after the stop')), 3000));
    await assert.rejects(Promise.race([client().transcribe({ audioPath }, { signal: controller.signal }), gaveUp]), (e) => e instanceof ProviderHttpError && e.retryable === false);
    assert.ok(Date.now() - started < 3000);
  });
});

