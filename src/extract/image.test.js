import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import sharp from 'sharp';
import { extract, ExtractError } from './index.js';
import { fakeVision, makeHeicLike, makeImage, makeRotatedJpeg, makeTmp } from './test/helpers.js';

const tmp = await makeTmp('image');
after(() => tmp.cleanup());

const att = async (path, extra = {}) => ({ id: 'a1', kind: 'image', path, mime: 'image/png', size: (await stat(path)).size, ...extra });

test('una captura PNG llega al proveedor tal cual con el prompt accionable', async () => {
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
  assert.equal(call.prompt.includes('accionable'), true);
  assert.equal(call.prompt.includes('textualmente'), true);
  assert.equal(meta.converted, false);
  assert.equal(meta.kind, 'image');
  assert.deepEqual(meta.calls[0].usage, { input_tokens: 1456, output_tokens: 50 });
  // Progreso por paso real: sube sin bajar y termina en 100.
  assert.ok(progress.length >= 3);
  assert.equal(progress.at(-1)[0], 100);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i][0] >= progress[i - 1][0]);
});

test('un formato que el proveedor no acepta se convierte a PNG', async () => {
  const path = await makeImage(tmp.join('foto.tiff'), { format: 'tiff' });
  const vision = fakeVision();
  const { meta } = await extract(await att(path, { mime: 'image/tiff' }), { providers: { vision } });
  assert.equal(meta.converted, true);
  assert.equal(vision.calls[0].images[0].mime, 'image/png');
});

test('una imagen más grande que el lado máximo se reduce', async () => {
  const path = await makeImage(tmp.join('grande.png'), { width: 3000, height: 1000 });
  const vision = fakeVision();
  const { meta } = await extract(await att(path), { providers: { vision }, config: { image: { maxSide: 1200 } } });
  assert.equal(meta.converted, true);
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 400);
});

test('un JPEG de teléfono con orientación EXIF se gira antes de describirlo', async () => {
  const path = await makeRotatedJpeg(tmp.join('telefono.jpg'));
  const vision = fakeVision();
  const { meta } = await extract(await att(path, { mime: 'image/jpeg' }), { providers: { vision } });
  assert.equal(meta.converted, true);
  const sent = await sharp(vision.calls[0].images[0].data).metadata();
  assert.equal(sent.width, 100, 'el ancho y el alto se intercambian al girar');
  assert.equal(sent.height, 300);
});

test('una foto HEIC se rechaza con el motivo y sin llamar al proveedor', async () => {
  const path = await makeHeicLike(tmp.join('iphone.heic'));
  const vision = fakeVision();
  await assert.rejects(
    extract(await att(path, { mime: 'image/heic' }), { providers: { vision } }),
    (e) => e instanceof ExtractError && e.code === 'image_heic_unsupported' && e.message.includes('HEIC') && e.message.includes('JPEG'),
  );
  assert.equal(vision.calls.length, 0);
});

test('un archivo que no es imagen se rechaza', async () => {
  const path = tmp.join('no-es-imagen.png');
  await import('node:fs/promises').then((fs) => fs.writeFile(path, 'esto no es una imagen'));
  await assert.rejects(extract(await att(path), { providers: { vision: fakeVision() } }), (e) => e.code === 'image_unreadable');
});

test('una imagen sobre el tamaño máximo se rechaza antes de leerla', async () => {
  const path = await makeImage(tmp.join('pesada.png'));
  await assert.rejects(
    extract(await att(path), { providers: { vision: fakeVision() }, config: { image: { maxBytes: 100 } } }),
    (e) => e.code === 'image_too_large',
  );
});

test('sin proveedor de visión el error lo dice', async () => {
  const path = await makeImage(tmp.join('sin-proveedor.png'));
  await assert.rejects(extract(await att(path), { providers: {} }), (e) => e.code === 'provider_missing');
});

test('una descripción vacía del proveedor queda como aviso', async () => {
  const path = await makeImage(tmp.join('vacia.png'));
  const vision = { async describe() { return { json: { description: '  ' }, usage: {} }; } };
  const { text, meta } = await extract(await att(path), { providers: { vision } });
  assert.equal(text, '');
  assert.equal(meta.warnings[0].code, 'empty_description');
});

test('una foto grande de teléfono se reduce a JPEG y cabe en el tope del proveedor, no a un PNG enorme', async () => {
  const path = tmp.join('foto-grande.jpg');
  const raw = Buffer.alloc(3000 * 2000 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24; // ruido: el peor caso para PNG
  await sharp(raw, { raw: { width: 3000, height: 2000, channels: 3 } }).jpeg({ quality: 90 }).toFile(path);
  const vision = fakeVision();
  const { meta } = await extract(await att(path, { mime: 'image/jpeg' }), { providers: { vision }, config: { image: { maxBytes: 7 * 1024 * 1024 } } });
  const sent = vision.calls[0].images[0];
  assert.equal(meta.converted, true);
  assert.equal(sent.mime, 'image/jpeg');
  assert.ok(sent.data.length <= 7 * 1024 * 1024, `pesa ${sent.data.length} bytes`);
});
