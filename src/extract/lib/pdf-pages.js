// Páginas de un PDF para el modo nativo del proveedor (informe 05 §5 y §8.3): sólo las páginas
// sin texto viajan como PDF; el resto ya se extrajo. La partición con `pdf-lib` tomó 36 ms para
// 3 de 6 páginas y 249 ms para 3 de 15 (informe 05 §5).
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

/** Agrupa números de página en lotes de a lo sumo `perCall` (límite por llamada del proveedor). */
export function batchPages(pages, perCall) {
  const batches = [];
  for (let i = 0; i < pages.length; i += perCall) batches.push(pages.slice(i, i + perCall));
  return batches;
}

/**
 * Devuelve un PDF nuevo con sólo las páginas pedidas (numeradas desde 1), en el orden dado.
 * @param {string} path
 * @param {number[]} pages
 * @returns {Promise<Uint8Array>}
 */
export async function selectPdfPages(path, pages) {
  const source = await PDFDocument.load(await readFile(path), { ignoreEncryption: true });
  const target = await PDFDocument.create();
  const copied = await target.copyPages(source, pages.map((p) => p - 1));
  for (const page of copied) target.addPage(page);
  return target.save();
}
