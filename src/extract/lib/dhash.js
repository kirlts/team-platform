// 64-bit dHash (report 06 §2.5): image shrunk to 9×8 in grayscale; each bit compares a
// pixel with its right-hand neighbour. A frame is kept if its Hamming distance from the
// last kept one exceeds the threshold.
import sharp from 'sharp';

export async function dhash(input) {
  const px = await sharp(input).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      hash = (hash << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return hash;
}

export function hammingDistance(a, b) {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/**
 * Picks frames: keeps those that change more than `distance` from the last kept one and,
 * if more than `maxFrames` remain, those with the greatest change (the first always gets in), returned in
 * temporal order.
 * @param {{second:number, hash:bigint}[]} frames in temporal order
 */
export function selectFrames(frames, { distance, maxFrames }) {
  const kept = [];
  for (const frame of frames) {
    const last = kept.at(-1);
    if (!last) {
      kept.push({ ...frame, change: Number.POSITIVE_INFINITY });
      continue;
    }
    const change = hammingDistance(frame.hash, last.hash);
    if (change > distance) kept.push({ ...frame, change });
  }
  const dedupedCount = kept.length;
  const chosen =
    kept.length <= maxFrames
      ? kept
      : [...kept].sort((a, b) => b.change - a.change || a.second - b.second).slice(0, maxFrames);
  chosen.sort((a, b) => a.second - b.second);
  return { frames: chosen, dedupedCount };
}
