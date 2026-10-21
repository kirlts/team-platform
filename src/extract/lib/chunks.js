// Splitting of audio into overlapping chunks and merging of their segments by timestamp.
// Rules from MASTER-SPEC §7.4 and report 06 §3.3. It is all arithmetic over times; no prose is read.

/**
 * Chunk plan. Each chunk starts `overlapSeconds` before where the previous one ended.
 * `cutStart` and `cutEnd` mark which segments each chunk keeps when merging: the cut between two
 * chunks is at the midpoint of their overlap.
 *
 * @returns {{index:number,start:number,length:number,cutStart:number,cutEnd:number}[]}
 */
export function planChunks(durationSeconds, { chunkSeconds, overlapSeconds, minChunkSeconds }) {
  const step = chunkSeconds - overlapSeconds;
  if (step <= 0) throw new Error('the overlap must be smaller than the chunk');
  const chunks = [];
  let start = 0;
  while (true) {
    const length = Math.min(chunkSeconds, durationSeconds - start);
    chunks.push({ start, length });
    // If this chunk already reaches the end of the audio there is no other.
    if (start + length >= durationSeconds) break;
    start += step;
  }
  // A last chunk shorter than the billable minimum is not emitted: the previous one absorbs it.
  if (chunks.length > 1 && chunks.at(-1).length < minChunkSeconds) {
    chunks.pop();
    const prev = chunks.at(-1);
    prev.length = durationSeconds - prev.start;
  }
  return chunks.map((c, index) => {
    const prev = chunks[index - 1];
    const next = chunks[index + 1];
    return {
      index,
      start: c.start,
      length: c.length,
      cutStart: prev ? (c.start + (prev.start + prev.length)) / 2 : 0,
      cutEnd: next ? (next.start + (c.start + c.length)) / 2 : Number.POSITIVE_INFINITY,
    };
  });
}

/** Seconds the provider bills for a plan: each request counts as at least `minBilledSeconds`. */
export function billableSeconds(plan, minBilledSeconds) {
  return plan.reduce((sum, c) => sum + Math.max(c.length, minBilledSeconds), 0);
}

/**
 * Merges the segments of each chunk. Those of chunk k that start before the cut are kept,
 * and those of chunk k+1 that start at the cut or after; times are added to the chunk's offset.
 * Each segment carries its chunk index (`chunk`): sentence joining (`sentences.js`) never crosses that boundary.
 *
 * @param {ReturnType<typeof planChunks>} plan
 * @param {{start:number,end:number,text:string}[][]} segmentsByChunk
 */
export function mergeSegments(plan, segmentsByChunk) {
  const merged = [];
  plan.forEach((chunk, i) => {
    for (const seg of segmentsByChunk[i] ?? []) {
      const start = chunk.start + seg.start;
      if (start < chunk.cutStart || start >= chunk.cutEnd) continue;
      merged.push({ start, end: chunk.start + seg.end, text: seg.text, chunk: chunk.index });
    }
  });
  return merged.sort((a, b) => a.start - b.start);
}
