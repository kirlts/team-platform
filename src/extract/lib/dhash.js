// dHash de 64 bits (informe 06 §2.5): imagen reducida a 9×8 en grises; cada bit compara un
// píxel con su vecino de la derecha. Se conserva un fotograma si su distancia de Hamming con el
// último conservado supera el umbral.
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
 * Elige fotogramas: conserva los que cambian más que `distance` respecto del último conservado y,
 * si quedan más de `maxFrames`, los de mayor cambio (el primero siempre entra), devueltos en
 * orden temporal.
 * @param {{second:number, hash:bigint}[]} frames en orden temporal
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
