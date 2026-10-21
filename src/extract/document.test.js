import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { extract, ExtractError, selectPdfPages } from './index.js';
import { makeDocx, makeHeavyPdf, makePdf, makeTmp } from './test/helpers.js';
import { makePptx, makeXlsx } from './test/office-fixtures.js';
import { initCappedPdfium, predictedHeapSize } from './lib/pdfium-capped.js';
import { readFile } from 'node:fs/promises';

const tmp = await makeTmp('document');
after(() => tmp.cleanup());

const att = async (path, mime) => ({ id: 'd1', kind: 'document', path, mime, size: (await stat(path)).size });
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

test('a 40-point DOCX keeps all strings and the structure and carries no metadata', async () => {
  const path = tmp.join('minuta.docx');
  const expected = await makeDocx(path, 40);
  const { text, meta } = await extract(await att(path, DOCX));
  const missing = expected.filter((s) => !text.includes(s));
  assert.deepEqual(missing, [], 'lost strings');
  assert.match(text, /^# Minuta de la reunión/);
  assert.match(text, /^- Criterio 1\.a$/m);
  assert.match(text, /^ {4}- Subcriterio 1\.a\.1$/m, 'the sub-bullet stays nested');
  assert.match(text, /\| Responsable \| Plazo \|/);
  assert.equal(text.includes('author:'), false);
  assert.equal(text.includes('{#'), false, 'no heading anchors');
  assert.equal(meta.format, 'docx');
  assert.equal(meta.kind, 'document');
});

test('a 20-page digital PDF comes out with one section per page in order', async () => {
  const path = tmp.join('informe.pdf');
  await makePdf(path, 20);
  const progress = [];
  const { text, meta } = await extract(await att(path, 'application/pdf'), { onProgress: (p) => progress.push(p) });
  assert.equal(meta.pageCount, 20);
  assert.equal(meta.scanned, false);
  assert.deepEqual(meta.scannedPages, []);
  for (let n = 1; n <= 20; n++) assert.ok(text.includes(`## Página ${n}\n\nContenido de la página ${n}`), `page ${n}`);
  assert.ok(text.indexOf('## Página 2\n') < text.indexOf('## Página 10\n'));
  assert.ok(text.includes('Línea 12 de la página 20'));
  assert.equal(progress.at(-1), 100);
});

test('a PDF with scanned pages sets meta.scanned and lists those pages in batches', async () => {
  const path = tmp.join('mixto.pdf');
  await makePdf(path, 6, { scanned: [2, 4, 6] });
  const { text, meta } = await extract(await att(path, 'application/pdf'));
  assert.equal(meta.scanned, true);
  assert.deepEqual(meta.scannedPages, [2, 4, 6]);
  assert.deepEqual(meta.nativePageBatches, [[2, 4, 6]]);
  assert.equal(meta.warnings[0].code, 'scanned_pages');
  assert.ok(text.includes('## Página 2\n\n_(página sin texto extraíble)_'));
  assert.ok(text.includes('Contenido de la página 1'));
});

test('native-mode batches respect the pages per call', async () => {
  const path = tmp.join('todo-escaneado.pdf');
  await makePdf(path, 7, { scanned: [1, 2, 3, 4, 5, 6, 7] });
  const { meta } = await extract(await att(path, 'application/pdf'), { config: { document: { nativePagesPerCall: 3 } } });
  assert.deepEqual(meta.nativePageBatches, [[1, 2, 3], [4, 5, 6], [7]]);
});

test('selectPdfPages splits the PDF and leaves only the requested pages', async () => {
  const path = tmp.join('para-partir.pdf');
  await makePdf(path, 6, { scanned: [2, 4, 6] });
  const part = await selectPdfPages(path, [2, 6]);
  const doc = await PDFDocument.load(part);
  assert.equal(doc.getPageCount(), 2);
  const out = tmp.join('parte.pdf');
  await writeFile(out, part);
  const { meta } = await extract(await att(out, 'application/pdf'));
  assert.equal(meta.pageCount, 2);
  assert.deepEqual(meta.scannedPages, [1, 2]);
});

test('an XLSX labels each sheet with its name', async () => {
  const path = tmp.join('pedidos.xlsx');
  await writeFile(path, makeXlsx([
    { name: 'Pedidos', rows: [['cliente', 'monto'], ['Ana', 1200]] },
    { name: 'Notas', rows: [['nota uno']] },
  ]));
  const { text, meta } = await extract(await att(path, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  assert.equal(meta.format, 'xlsx');
  assert.ok(text.includes('## Hoja: Pedidos'));
  assert.ok(text.includes('## Hoja: Notas'));
  assert.match(text, /\| Ana \| 1200 \|/);
  assert.ok(text.indexOf('Hoja: Pedidos') < text.indexOf('Hoja: Notas'));
});

test('a PPTX delivers the title and bullets of each slide', async () => {
  const path = tmp.join('plan.pptx');
  await writeFile(path, makePptx([{ title: 'Plan', bullets: ['uno', 'dos'] }, { title: 'Riesgos', bullets: ['tres'] }]));
  const { text, meta } = await extract(await att(path, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
  assert.equal(meta.format, 'pptx');
  for (const s of ['Plan', 'uno', 'dos', 'Riesgos', 'tres']) assert.ok(text.includes(s), s);
});

test('plain text and markdown pass unchanged, and with no useful type UTF-8 is detected', async () => {
  const path = tmp.join('notas.md');
  await writeFile(path, '# Notas\n\n- revisar el módulo de pagos\n');
  assert.equal((await extract(await att(path, 'text/markdown'))).text, '# Notas\n\n- revisar el módulo de pagos');
  assert.equal((await extract(await att(path, 'application/octet-stream'))).text, '# Notas\n\n- revisar el módulo de pagos');
});

test('an unknown binary is rejected with the reason', async () => {
  const path = tmp.join('raro.bin');
  await writeFile(path, Buffer.from([0, 1, 2, 3, 255, 254]));
  await assert.rejects(extract(await att(path, 'application/octet-stream')), (e) => e instanceof ExtractError && e.code === 'document_unsupported');
});

test('a damaged PDF is rejected with the reason', async () => {
  const path = tmp.join('danado.pdf');
  await writeFile(path, '%PDF-1.7\nesto no es un pdf de verdad');
  await assert.rejects(extract(await att(path, 'application/pdf')), (e) => e.code === 'document_unreadable');
});

test('a document over the maximum size is rejected before reading it', async () => {
  const path = tmp.join('pesado.docx');
  await makeDocx(path, 5);
  await assert.rejects(extract(await att(path, DOCX), { config: { document: { maxBytes: 100 } } }), (e) => e.code === 'document_too_large');
});

test('the read deadline cuts the worker thread', async () => {
  const path = tmp.join('lento.pdf');
  await makePdf(path, 20);
  const t = performance.now();
  await assert.rejects(extract(await att(path, 'application/pdf'), { config: { document: { timeoutMs: 1 } } }), (e) => e.code === 'document_timeout');
  assert.ok(performance.now() - t < 2000);
});

test('the memory limit of the worker thread cuts a read that exceeds it', async () => {
  const path = tmp.join('memoria.docx');
  await makeDocx(path, 300);
  await assert.rejects(
    extract(await att(path, DOCX), { config: { document: { memoryMb: 4 } } }),
    (e) => e.code === 'document_too_heavy',
  );
});

// H-23: PDFium's WASM heap is external memory; `resourceLimits` of the thread does not count it.
const MiB = 1024 * 1024;

test('H-23: a PDF whose pages inflate past the WASM cap is refused with document_too_heavy', async () => {
  const path = tmp.join('wasm-chico.pdf');
  const { inflatedBytes, fileBytes } = await makeHeavyPdf(path, { pages: 3, reps: 600_000 });
  assert.ok(inflatedBytes > 100 * (fileBytes), 'small on disk, large once parsed');
  // The same file reads whole under the default cap (peak about 201 MiB measured).
  const ok = await extract(await att(path, 'application/pdf'));
  assert.equal(ok.meta.pageCount, 3);
  await assert.rejects(
    extract(await att(path, 'application/pdf'), { config: { document: { wasmMemoryMb: 64 } } }),
    (e) => e.code === 'document_too_heavy' && e.details.wasmMemoryMb === 64,
  );
});

test('H-23: with the default cap, a PDF bomb of 112 MB inflated is refused (about 1 GiB of heap uncapped)', async () => {
  const path = tmp.join('wasm-bomba.pdf');
  const { inflatedBytes, fileBytes } = await makeHeavyPdf(path, { pages: 300, reps: 3_500_000 });
  assert.ok(inflatedBytes >= 100 * MiB);
  assert.ok(fileBytes < 24 * MiB, 'it passes the upload cap of documents');
  const started = performance.now();
  await assert.rejects(extract(await att(path, 'application/pdf')), (e) => e.code === 'document_too_heavy' && e.details.wasmMemoryMb === 700);
  assert.ok(performance.now() - started < 30_000);
});

test('H-23: the WASM heap never goes over the cap, and the growth the cap predicts is the one the library does', async () => {
  const path = tmp.join('wasm-tope.pdf');
  await makeHeavyPdf(path, { pages: 1, reps: 1_500_000 });
  const cap = 128 * MiB;
  const { library, guard } = await initCappedPdfium(cap);
  try {
    const doc = await library.loadDocument(await readFile(path));
    const page = doc.getPage(0);
    page.getText();
    page.close();
  } catch {
    // PDFium aborts on the refused allocation; the guard is what is asserted.
  }
  assert.ok(guard.exceeded, 'the heap would have gone past the cap');
  assert.ok(guard.heapBytes() <= cap, `heap ${guard.heapBytes()} over cap ${cap}`);
  assert.ok(guard.refusedBytes > cap);
  assert.equal(predictedHeapSize(16 * MiB, 17 * MiB), Math.ceil(16 * MiB * 1.2 / 65_536) * 65_536);
});

test('cancelling with the signal cuts the read short', async () => {
  const path = tmp.join('cancelar.pdf');
  await makePdf(path, 20);
  const controller = new AbortController();
  const pending = extract(await att(path, 'application/pdf'), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e) => e.code === 'aborted');
});

test('extracted text over the cap is cut at a line break and warns', async () => {
  const path = tmp.join('largo.docx');
  await makeDocx(path, 40);
  const { text, meta } = await extract(await att(path, DOCX), { config: { text: { maxChars: 1000 } } });
  assert.ok(text.length <= 1000);
  assert.equal(meta.truncated, true);
  assert.ok(meta.originalChars > 1000);
  assert.equal(meta.warnings.at(-1).code, 'text_truncated');
});
