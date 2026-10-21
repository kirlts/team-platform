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

test('the same image gives the same hash and a different one, a large distance', async () => {
  const a = await dhash(await pattern(1));
  assert.equal(a, await dhash(await pattern(1)));
  assert.ok(hammingDistance(a, await dhash(await pattern(2))) > 6);
  assert.equal(hammingDistance(a, a), 0);
});

test('Hamming distance counts differing bits out of 64', () => {
  assert.equal(hammingDistance(0n, 0xffff_ffff_ffff_ffffn), 64);
  assert.equal(hammingDistance(0b1011n, 0b0001n), 2);
});

const frame = (second, hash) => ({ second, hash });

test('a frame is kept only if it exceeds the distance from the last kept one', () => {
  const frames = [frame(0, 0n), frame(1, 0b1111n), frame(2, 0b1111111n), frame(3, 0xffffn)];
  const { frames: kept } = selectFrames(frames, { distance: 6, maxFrames: 48 });
  // 1 differs by 4 bits from 0 (does not exceed 6); 2 differs by 7 (exceeds); 3 differs by 9 from 2 (exceeds).
  assert.deepEqual(kept.map((f) => f.second), [0, 2, 3]);
});

test('above the cap those with the greatest change remain, the first gets in and they come out in temporal order', () => {
  const bits = (n) => (1n << BigInt(n)) - 1n;
  // Each frame changes from the previous one by: 20, 30, 10, 40, 8 bits (alternating to avoid repeating).
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

test('with ties in change the earliest frame wins', () => {
  const frames = [frame(0, 0n), frame(1, 0xffn), frame(2, 0n), frame(3, 0xffn)];
  const { frames: kept } = selectFrames(frames, { distance: 6, maxFrames: 2 });
  assert.deepEqual(kept.map((f) => f.second), [0, 1]);
});
