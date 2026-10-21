import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { extract, ExtractError } from './index.js';
import { fakeVision, makeHeicLike, makeImage, makeRotatedJpeg, makeTmp } from './test/helpers.js';

const tmp = await makeTmp('image');
const FIX = (name) => new URL(`./test/fixtures/${name}`, import.meta.url).pathname;
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

test('a HEIC photo is decoded to JPEG and reaches the provider', async () => {
  const vision = fakeVision();
  const { meta } = await extract(await att(FIX('libheif.heic'), { mime: 'image/heic' }), { providers: { vision } });
  assert.equal(vision.calls.length, 1);
  assert.equal(vision.calls[0].images[0].mime, 'image/jpeg');
  assert.equal(meta.converted, true);
  assert.equal(meta.width, 320);
  assert.equal(meta.height, 240);
  // The bytes are a JPEG that sharp can read, not the HEIC container.
  assert.equal((await sharp(vision.calls[0].images[0].data).metadata()).format, 'jpeg');
});

for (const [file, angle, w, h] of [['rotated-6.heic', 270, 100, 300], ['rotated-3.heic', 180, 300, 100], ['tiled-rotated.heic', 270, 770, 1030]]) {
  test(`a HEIC photo with a ${angle} degree rotation (${file}) arrives upright`, async () => {
    const vision = fakeVision();
    const { meta } = await extract(await att(FIX(file), { mime: 'image/heic' }), { providers: { vision } });
    assert.equal(meta.width, w);
    assert.equal(meta.height, h);
    const sent = await sharp(vision.calls[0].images[0].data).metadata();
    assert.equal(sent.width, w);
    assert.equal(sent.height, h);
  });
}

test('a rotated HEIC keeps its content upright, not only its dimensions (180 degrees: the red block ends at the bottom right)', async () => {
  const vision = fakeVision();
  await extract(await att(FIX('rotated-3.heic'), { mime: 'image/heic' }), { providers: { vision } });
  const { data, info } = await sharp(vision.calls[0].images[0].data).raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  const [r1, g1] = px(10, 10);
  const [r2, g2] = px(info.width - 10, info.height - 10);
  assert.ok(r2 > 150 && g2 < 100, `bottom right should be red, got ${r2},${g2}`);
  assert.ok(!(r1 > 150 && g1 < 100), 'top left should not be red');
});

test('a HEIC file with several images decodes the primary one', async () => {
  const vision = fakeVision();
  const { meta } = await extract(await att(FIX('two-images.heic'), { mime: 'image/heic' }), { providers: { vision } });
  assert.equal(vision.calls[0].images.length, 1);
  // Primary: 300x100 rotated to 100x300. The second image (200x100) is not the one sent.
  assert.deepEqual([meta.width, meta.height], [100, 300]);
});

test('a HEIC photo over the pixel cap is refused from its headers, before decoding it', async () => {
  const vision = fakeVision();
  await assert.rejects(
    extract(await att(FIX('rotated-6.heic'), { mime: 'image/heic' }), { providers: { vision }, config: { image: { heicMaxPixels: 29_999 } } }),
    (e) => e instanceof ExtractError && e.code === 'image_too_many_pixels' && e.details.pixels === 30_000,
  );
  assert.equal(vision.calls.length, 0);
  // Exactly at the cap it passes.
  await extract(await att(FIX('rotated-6.heic'), { mime: 'image/heic' }), { providers: { vision }, config: { image: { heicMaxPixels: 30_000 } } });
  assert.equal(vision.calls.length, 1);
});

test('a corrupt, truncated or header-only HEIC fails with image_heic_unreadable and a clear message, without calling the provider', async () => {
  const path = tmp.join('roto.heic');
  const whole = await readFile(FIX('libheif.heic'));
  await makeHeicLike(tmp.join('cabecera.heic'));
  for (const bytes of [whole.subarray(0, 700), await readFile(tmp.join('cabecera.heic'))]) {
    await writeFile(path, bytes);
    const vision = fakeVision();
    await assert.rejects(
      extract(await att(path, { mime: 'image/heic' }), { providers: { vision } }),
      (e) => e instanceof ExtractError && e.code === 'image_heic_unreadable' && e.message.includes('HEIC'),
    );
    assert.equal(vision.calls.length, 0);
  }
});

// Real phone photos (tiles composed as a grid, 12 MP): not versioned (1 to 3 MB each). Point TEAM_HEIC_SAMPLES at a directory with them.
const SAMPLES = process.env.TEAM_HEIC_SAMPLES;
test('real iPhone HEIC photos (TEAM_HEIC_SAMPLES) are decoded and fit the provider limit', { skip: !SAMPLES && 'set TEAM_HEIC_SAMPLES to a directory with .heic photos' }, async () => {
  const names = (await readdir(SAMPLES)).filter((n) => n.toLowerCase().endsWith('.heic'));
  assert.ok(names.length > 0);
  for (const name of names) {
    const vision = fakeVision();
    const { meta } = await extract(await att(join(SAMPLES, name), { mime: 'image/heic' }), { providers: { vision } });
    assert.equal(vision.calls[0].images[0].mime, 'image/jpeg', name);
    assert.ok(vision.calls[0].images[0].data.length <= 7 * 1024 * 1024, name);
    assert.ok(Math.max(meta.width, meta.height) <= 2576, name);
  }
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

test('a large phone photo is reduced to JPEG and fits the provider limit, not to a huge PNG', async () => {
  const path = tmp.join('foto-grande.jpg');
  const raw = Buffer.alloc(3000 * 2000 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24; // noise: the worst case for PNG
  await sharp(raw, { raw: { width: 3000, height: 2000, channels: 3 } }).jpeg({ quality: 90 }).toFile(path);
  const vision = fakeVision();
  const { meta } = await extract(await att(path, { mime: 'image/jpeg' }), { providers: { vision }, config: { image: { maxBytes: 7 * 1024 * 1024 } } });
  const sent = vision.calls[0].images[0];
  assert.equal(meta.converted, true);
  assert.equal(sent.mime, 'image/jpeg');
  assert.ok(sent.data.length <= 7 * 1024 * 1024, `pesa ${sent.data.length} bytes`);
});

