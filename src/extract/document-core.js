// Lectura de documentos a markdown. Corre dentro de un hilo trabajador (document.js) para que
// un archivo patológico no congele el proceso de la API: PDFium y officeparser ocupan el bucle
// de eventos mientras trabajan (informe 05 §4, README de unpdf).
import { readFile } from 'node:fs/promises';
import { OfficeParser } from 'officeparser';
import { ExtractError } from './errors.js';
import { batchPages } from './lib/pdf-pages.js';
import { initCappedPdfium } from './lib/pdfium-capped.js';

const PDF_SIGNATURE = '%PDF-';

/** Formato por firma binaria; el tipo MIME sólo decide entre texto y lo desconocido. */
export function detectFormat(buffer, mime) {
  if (buffer.subarray(0, 1024).toString('latin1').includes(PDF_SIGNATURE)) return 'pdf';
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'office'; // zip: docx, pptx, xlsx, odt…
  if (typeof mime === 'string' && mime.startsWith('text/')) return 'text';
  // Sin tipo útil (p. ej. `application/octet-stream`): texto si no tiene bytes nulos y es UTF-8 válido.
  if (!mime || mime === 'application/octet-stream') return isUtf8Text(buffer) ? 'text' : null;
  return null;
}

function isUtf8Text(buffer) {
  if (buffer.subarray(0, 8192).includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

const countVisibleChars = (text) => [...text].filter((ch) => ch.trim() !== '').length;

const MiB = 1024 * 1024;

const tooHeavy = (cfg, guard) =>
  new ExtractError('document_too_heavy', 'El documento es demasiado grande para leerse.', {
    wasmMemoryMb: cfg.wasmMemoryMb,
    wantedMb: Math.round(guard.refusedBytes / MiB),
  });

async function readPdf(buffer, cfg) {
  // PDFium's WASM heap is outside `resourceLimits` of the thread: it has its own cap (H-23).
  const { library, guard } = await initCappedPdfium(cfg.wasmMemoryMb * MiB);
  let doc;
  try {
    doc = await library.loadDocument(buffer);
    const pageCount = doc.getPageCount();
    const blocks = [];
    const scannedPages = [];
    for (let i = 0; i < pageCount; i++) {
      const page = doc.getPage(i);
      const text = page.getText().replaceAll('\r\n', '\n').trim();
      page.close();
      // A refused allocation can leave PDFium returning a truncated page instead of failing.
      if (guard.exceeded) throw tooHeavy(cfg, guard);
      const number = i + 1;
      if (countVisibleChars(text) < cfg.scannedPageMaxChars) scannedPages.push(number);
      const body = text === '' ? '_(página sin texto extraíble)_' : text;
      blocks.push(`## Página ${number}\n\n${body}`);
    }
    return {
      text: blocks.join('\n\n'),
      meta: {
        format: 'pdf',
        pageCount,
        // `scanned`: al menos una página bajo el umbral. El analizador manda al proveedor sólo
        // `scannedPages`, en lotes de `nativePageBatches` (informe 05 §8.3).
        scanned: scannedPages.length > 0,
        scannedPages,
        nativePageBatches: batchPages(scannedPages, cfg.nativePagesPerCall),
      },
    };
  } catch (cause) {
    // Whatever PDFium raised after a refused growth, the cause is the memory cap.
    if (guard.exceeded) throw tooHeavy(cfg, guard);
    throw cause;
  } finally {
    try { doc?.destroy(); } catch { /* the document may be half-loaded after a refused allocation */ }
    try { library.destroy(); } catch { /* same */ }
  }
}

async function readOffice(buffer) {
  const ast = await OfficeParser.parseOffice(buffer, { generateIds: false });
  // Sin el bloque de autor y fechas que officeparser antepone como YAML (informe 05 §8.1).
  ast.metadata = {};
  const options = { generateIds: false };
  const nodes = ast.content;
  let text;
  if (ast.type === 'xlsx' && nodes.length > 0 && nodes.every((n) => n.type === 'sheet')) {
    // officeparser separa las hojas sin nombrarlas; el nombre está en el AST (informe 05 §2.3).
    const parts = [];
    for (const sheet of nodes) {
      ast.content = [sheet];
      const { value } = await ast.to('md', options);
      parts.push(`## Hoja: ${sheet.metadata?.sheetName ?? parts.length + 1}\n\n${value.trim()}`);
    }
    text = parts.join('\n\n');
  } else {
    text = (await ast.to('md', options)).value.trim();
  }
  return { text, meta: { format: ast.type, sections: nodes.length } };
}

/** @returns {Promise<{text:string, meta:object}>} */
export async function extractDocumentContent({ path, mime, config }) {
  const buffer = await readFile(path);
  const format = detectFormat(buffer, mime);
  try {
    if (format === 'pdf') return await readPdf(buffer, config.document);
    if (format === 'office') return await readOffice(buffer);
    if (format === 'text') return { text: new TextDecoder('utf-8').decode(buffer).trim(), meta: { format: 'text' } };
  } catch (cause) {
    if (cause instanceof ExtractError) throw cause;
    throw new ExtractError('document_unreadable', 'No se pudo leer el documento. Puede estar dañado o protegido con contraseña.', {
      cause: String(cause?.message ?? cause),
    });
  }
  throw new ExtractError('document_unsupported', 'Este tipo de documento no se puede leer. Se admiten PDF, DOCX, PPTX, XLSX, TXT y MD.', { mime });
}
