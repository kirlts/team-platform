import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import { EXTRACTORS, extract, ExtractError } from './index.js';
import { makeImage, makeTmp } from './test/helpers.js';

const tmp = await makeTmp('index');
after(() => tmp.cleanup());

test('hay un extractor registrado por cada tipo de adjunto', () => {
  assert.deepEqual(Object.keys(EXTRACTORS).sort(), ['audio', 'document', 'image', 'link', 'video']);
  for (const fn of Object.values(EXTRACTORS)) assert.equal(typeof fn, 'function');
});

test('un tipo de adjunto desconocido se rechaza', async () => {
  await assert.rejects(extract({ id: 1, kind: 'hologram', path: '/x' }), (e) => e instanceof ExtractError && e.code === 'kind_unsupported');
  await assert.rejects(extract(undefined), (e) => e.code === 'kind_unsupported');
});

test('un archivo ausente se rechaza con el motivo', async () => {
  await assert.rejects(extract({ id: 1, kind: 'image', path: tmp.join('no-existe.png') }), (e) => e.code === 'file_missing');
});

test('el avisador de progreso que falla no mata la extracción', async () => {
  const path = await makeImage(tmp.join('p.png'));
  const vision = { async describe() { return { json: { description: 'ok' }, usage: {} }; } };
  const { text } = await extract({ id: 1, kind: 'image', path, mime: 'image/png', size: 1 }, {
    providers: { vision },
    onProgress: () => { throw new Error('flujo SSE cerrado'); },
  });
  assert.equal(text, 'ok');
});

test('el directorio de trabajo se limpia también cuando la extracción falla', async () => {
  const path = tmp.join('malo.png');
  await writeFile(path, 'no es una imagen');
  const workDir = tmp.join('trabajo');
  await assert.rejects(extract({ id: 1, kind: 'image', path, mime: 'image/png', size: 1 }, { providers: { vision: {} }, config: { workDir } }));
  assert.deepEqual(await readdir(workDir), []);
});

test('el progreso siempre termina en 100 y nunca retrocede', async () => {
  const path = await makeImage(tmp.join('q.png'));
  const seen = [];
  const vision = { async describe() { return { json: { description: 'x' }, usage: {} }; } };
  await extract({ id: 1, kind: 'image', path, mime: 'image/png', size: 1 }, { providers: { vision }, onProgress: (p, phrase) => seen.push([p, phrase]) });
  assert.equal(seen.at(-1)[0], 100);
  assert.ok(seen.every(([, phrase]) => typeof phrase === 'string' && phrase.length > 0));
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i][0] >= seen[i - 1][0]);
});
