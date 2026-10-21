import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, writeFile } from 'node:fs/promises';
import { EXTRACTORS, extract, ExtractError } from './index.js';
import { makeImage, makeTmp } from './test/helpers.js';

const tmp = await makeTmp('index');
after(() => tmp.cleanup());

test('there is one extractor registered per attachment type', () => {
  assert.deepEqual(Object.keys(EXTRACTORS).sort(), ['audio', 'document', 'image', 'link', 'video']);
  for (const fn of Object.values(EXTRACTORS)) assert.equal(typeof fn, 'function');
});

test('an unknown attachment type is rejected', async () => {
  await assert.rejects(extract({ id: 1, kind: 'hologram', path: '/x' }), (e) => e instanceof ExtractError && e.code === 'kind_unsupported');
  await assert.rejects(extract(undefined), (e) => e.code === 'kind_unsupported');
});

test('a missing file is rejected with the reason', async () => {
  await assert.rejects(extract({ id: 1, kind: 'image', path: tmp.join('no-existe.png') }), (e) => e.code === 'file_missing');
});

test('a failing progress notifier does not kill the extraction', async () => {
  const path = await makeImage(tmp.join('p.png'));
  const vision = { async describe() { return { json: { description: 'ok' }, usage: {} }; } };
  const { text } = await extract({ id: 1, kind: 'image', path, mime: 'image/png', size: 1 }, {
    providers: { vision },
    onProgress: () => { throw new Error('SSE stream closed'); },
  });
  assert.equal(text, 'ok');
});

test('the working directory is also cleaned when the extraction fails', async () => {
  const path = tmp.join('malo.png');
  await writeFile(path, 'no es una imagen');
  const workDir = tmp.join('trabajo');
  await assert.rejects(extract({ id: 1, kind: 'image', path, mime: 'image/png', size: 1 }, { providers: { vision: {} }, config: { workDir } }));
  assert.deepEqual(await readdir(workDir), []);
});

test('progress always ends at 100 and never goes back', async () => {
  const path = await makeImage(tmp.join('q.png'));
  const seen = [];
  const vision = { async describe() { return { json: { description: 'x' }, usage: {} }; } };
  await extract({ id: 1, kind: 'image', path, mime: 'image/png', size: 1 }, { providers: { vision }, onProgress: (p, phrase) => seen.push([p, phrase]) });
  assert.equal(seen.at(-1)[0], 100);
  assert.ok(seen.every(([, phrase]) => typeof phrase === 'string' && phrase.length > 0));
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i][0] >= seen[i - 1][0]);
});
