import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { dhash, hammingDistance, selectFrames } from './lib/dhash.js';

async function pattern(seed) {
  const px = Buffer.alloc(64 * 64);
  let a = seed;
  for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
    a = (a * 1664525 + 1013904223) >>> 0;
    const v = a >>> 24;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px[(by * 8 + y) * 64 + bx * 8 + x] = v;
  }
  return sharp(px, { raw: { width: 64, height: 64, channels: 1 } }).png().toBuffer();
}

test('la misma imagen da el mismo hash y una distinta, distancia grande', async () => {
  const a = await dhash(await pattern(1));
  assert.equal(a, await dhash(await pattern(1)));
  assert.ok(hammingDistance(a, await dhash(await pattern(2))) > 6);
  assert.equal(hammingDistance(a, a), 0);
});

test('la distancia de Hamming cuenta bits distintos de 64', () => {
  assert.equal(hammingDistance(0n, 0xffff_ffff_ffff_ffffn), 64);
  assert.equal(hammingDistance(0b1011n, 0b0001n), 2);
});

const frame = (second, hash) => ({ second, hash });

test('se conserva un fotograma sólo si supera la distancia con el último conservado', () => {
  const frames = [frame(0, 0n), frame(1, 0b1111n), frame(2, 0b1111111n), frame(3, 0xffffn)];
  const { frames: kept } = selectFrames(frames, { distance: 6, maxFrames: 48 });
  // 1 difiere en 4 bits de 0 (no supera 6); 2 difiere en 7 (supera); 3 difiere en 9 del 2 (supera).
  assert.deepEqual(kept.map((f) => f.second), [0, 2, 3]);
});

test('sobre el tope quedan los de mayor cambio, el primero entra y salen en orden temporal', () => {
  const bits = (n) => (1n << BigInt(n)) - 1n;
  // Cada fotograma cambia respecto del anterior: 20, 30, 10, 40, 8 bits (alternando para no repetir).
  let h = 0n;
  const frames = [frame(0, h)];
  [20, 30, 10, 40, 8].forEach((n, i) => {
    h ^= bits(n);
    frames.push(frame(i + 1, h));
  });
  const { frames: kept, dedupedCount } = selectFrames(frames, { distance: 6, maxFrames: 3 });
  assert.equal(dedupedCount, 6);
  assert.deepEqual(kept.map((f) => f.second), [0, 2, 4]);
});

test('con empates en el cambio gana el fotograma más temprano', () => {
  const frames = [frame(0, 0n), frame(1, 0xffn), frame(2, 0n), frame(3, 0xffn)];
  const { frames: kept } = selectFrames(frames, { distance: 6, maxFrames: 2 });
  assert.deepEqual(kept.map((f) => f.second), [0, 1]);
});
