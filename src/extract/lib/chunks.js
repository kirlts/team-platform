// Partición del audio en trozos con solapamiento y fusión de sus segmentos por marca de tiempo.
// Reglas de MASTER-SPEC §7.4 e informe 06 §3.3. Todo es aritmética sobre tiempos; no se lee prosa.

/**
 * Plan de trozos. Cada trozo empieza `overlapSeconds` antes de donde terminó el anterior.
 * `cutStart` y `cutEnd` marcan qué segmentos conserva cada trozo al fusionar: el corte entre dos
 * trozos está en el punto medio de su solapamiento.
 *
 * @returns {{index:number,start:number,length:number,cutStart:number,cutEnd:number}[]}
 */
export function planChunks(durationSeconds, { chunkSeconds, overlapSeconds, minChunkSeconds }) {
  const step = chunkSeconds - overlapSeconds;
  if (step <= 0) throw new Error('el solapamiento debe ser menor que el trozo');
  const chunks = [];
  let start = 0;
  while (true) {
    const length = Math.min(chunkSeconds, durationSeconds - start);
    chunks.push({ start, length });
    // Si este trozo ya llega al final del audio no hay otro.
    if (start + length >= durationSeconds) break;
    start += step;
  }
  // Un último trozo más corto que el mínimo facturable no se emite: lo absorbe el anterior.
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

/** Segundos que factura el proveedor por un plan: cada solicitud cuenta como mínimo `minBilledSeconds`. */
export function billableSeconds(plan, minBilledSeconds) {
  return plan.reduce((sum, c) => sum + Math.max(c.length, minBilledSeconds), 0);
}

/**
 * Fusiona los segmentos de cada trozo. Se conservan los del trozo k que empiezan antes del corte
 * y los del trozo k+1 que empiezan en el corte o después; los tiempos se suman al desfase del trozo.
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
      merged.push({ start, end: chunk.start + seg.end, text: seg.text });
    }
  });
  return merged.sort((a, b) => a.start - b.start);
}
