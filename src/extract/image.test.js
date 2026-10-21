import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import sharp from 'sharp';
import { extract, ExtractError } from './index.js';
import { fakeVision, makeHeicLike, makeImage, makeRotatedJpeg, makeTmp } from './test/helpers.js';

const tmp = await makeTmp('image');
after(() => tmp.cleanup());

const att = async (path, extra = {}) => ({ id: 'a1', kind: 'image', path, mime: 'image/png', size: (await stat(path)).size, ...extra });

test('a PNG screenshot reaches the provider as is with the actionable prompt', async () => {
  const path = await makeImage(tmp.join('captura.png'));
  const vision = fakeVision();
  const progress = [];
  const { text, meta } = await extract(await att(path), { providers: { vision }, onProgress: (p, f) => progress.push([p, f]) });

  assert.match(text, /^descripción doble de Imagen$/);
  assert.equal(vision.calls.length, 1);
  const call = vision.calls[0];
  assert.equal(call.images.length, 1);
  assert.equal(call.images[0].mime, 'image/png');
  assert.ok(Buffer.isBuffer(call.images[0].data));
  assert.equal(call.prompt.includes('actionable'), true);
  assert.equal(call.prompt.includes('verbatim'), true);
  assert.equal(meta.converted, false);
  assert.equal(meta.kind, 'image');
  assert.deepEqual(meta.calls[0].usage, { input_tokens: 1456, output_tokens: 50 });
  // Progress per real step: it rises without falling and ends at 100.
  assert.ok(progress.length >= 3);
  assert.equal(progress.at(-1)[0], 100);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i][0] >= progress[i - 1][0]);
});

test('a format the provider does not accept is converted to PNG', async () => {
  const path = await makeImage(tmp.join('foto.tiff'), { format: 'tiff' });
  const vision = fakeVision();
  const { meta } = await extract(await att(path, { mime: 'image/tiff' }), { providers: { vision } });
  assert.equal(meta.converted, true);
  assert.equal(vision.calls[0].images[0].mime, 'image/png');
});

test('an image larger than the maximum side is shrunk', async () => {
  const path = await makeImage(tmp.join('grande.png'), { width: 3000, height: 1000 });
  const vision = fakeVision();
  const { meta } = await extract(await att(path), { providers: { vision }, config: { image: { maxSide: 1200 } } });
  assert.equal(meta.converted, true);
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 400);
});

test('a phone JPEG with EXIF orientation is rotated before describing it', async () => {
  const path = await makeRotatedJpeg(tmp.join('telefono.jpg'));
  const vision = fakeVision();
  const { meta } = await extract(await att(path, { mime: 'image/jpeg' }), { providers: { vision } });
  assert.equal(meta.converted, true);
  const sent = await sharp(vision.calls[0].images[0].data).metadata();
  assert.equal(sent.width, 100, 'width and height swap on rotation');
  assert.equal(sent.height, 300);
});

test('a HEIC photo is rejected with the reason and without calling the provider', async () => {
  const path = await makeHeicLike(tmp.join('iphone.heic'));
  const vision = fakeVision();
  await assert.rejects(
    extract(await att(path, { mime: 'image/heic' }), { providers: { vision } }),
    (e) => e instanceof ExtractError && e.code === 'image_heic_unsupported' && e.message.includes('HEIC') && e.message.includes('JPEG'),
  );
  assert.equal(vision.calls.length, 0);
});

test('a file that is not an image is rejected', async () => {
  const path = tmp.join('no-es-imagen.png');
  await import('node:fs/promises').then((fs) => fs.writeFile(path, 'esto no es una imagen'));
  await assert.rejects(extract(await att(path), { providers: { vision: fakeVision() } }), (e) => e.code === 'image_unreadable');
});

test('an image over the maximum size is rejected before reading it', async () => {
  const path = await makeImage(tmp.join('pesada.png'));
  await assert.rejects(
    extract(await att(path), { providers: { vision: fakeVision() }, config: { image: { maxBytes: 100 } } }),
    (e) => e.code === 'image_too_large',
  );
});

test('without a vision provider the error says so', async () => {
  const path = await makeImage(tmp.join('sin-proveedor.png'));
  await assert.rejects(extract(await att(path), { providers: {} }), (e) => e.code === 'provider_missing');
});

test('an empty description from the provider ends up as a warning', async () => {
  const path = await makeImage(tmp.join('vacia.png'));
  const vision = { async describe() { return { json: { description: '  ' }, usage: {} }; } };
  const { text, meta } = await extract(await att(path), { providers: { vision } });
  assert.equal(text, '');
  assert.equal(meta.warnings[0].code, 'empty_description');
});
