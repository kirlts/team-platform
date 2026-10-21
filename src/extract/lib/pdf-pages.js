// PDF pages for the provider's native mode (report 05 §5 and §8.3): only the pages
// without text travel as PDF; the rest were already extracted. Splitting with `pdf-lib` took 36 ms for
// 3 of 6 pages and 249 ms for 3 of 15 (report 05 §5).
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

/** Groups page numbers into batches of at most `perCall` (the provider's per-call limit). */
export function batchPages(pages, perCall) {
  const batches = [];
  for (let i = 0; i < pages.length; i += perCall) batches.push(pages.slice(i, i + perCall));
  return batches;
}

/**
 * Returns a new PDF with only the requested pages (numbered from 1), in the given order.
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
