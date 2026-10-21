import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stat, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { extract, ExtractError, selectPdfPages } from './index.js';
import { makeDocx, makePdf, makeTmp } from './test/helpers.js';
import { makePptx, makeXlsx } from './test/office-fixtures.js';

const tmp = await makeTmp('document');
after(() => tmp.cleanup());

const att = async (path, mime) => ({ id: 'd1', kind: 'document', path, mime, size: (await stat(path)).size });
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

test('un DOCX de 40 puntos conserva todas las cadenas, la estructura y no lleva metadatos', async () => {
  const path = tmp.join('minuta.docx');
  const expected = await makeDocx(path, 40);
  const { text, meta } = await extract(await att(path, DOCX));
  const missing = expected.filter((s) => !text.includes(s));
  assert.deepEqual(missing, [], 'cadenas perdidas');
  assert.match(text, /^# Minuta de la reunión/);
  assert.match(text, /^- Criterio 1\.a$/m);
  assert.match(text, /^ {4}- Subcriterio 1\.a\.1$/m, 'la subviñeta queda anidada');
  assert.match(text, /\| Responsable \| Plazo \|/);
  assert.equal(text.includes('author:'), false);
  assert.equal(text.includes('{#'), false, 'sin anclas de encabezado');
  assert.equal(meta.format, 'docx');
  assert.equal(meta.kind, 'document');
});

test('un PDF digital de 20 páginas sale con una sección por página en orden', async () => {
  const path = tmp.join('informe.pdf');
  await makePdf(path, 20);
  const progress = [];
  const { text, meta } = await extract(await att(path, 'application/pdf'), { onProgress: (p) => progress.push(p) });
  assert.equal(meta.pageCount, 20);
  assert.equal(meta.scanned, false);
  assert.deepEqual(meta.scannedPages, []);
  for (let n = 1; n <= 20; n++) assert.ok(text.includes(`## Página ${n}\n\nContenido de la página ${n}`), `página ${n}`);
  assert.ok(text.indexOf('## Página 2\n') < text.indexOf('## Página 10\n'));
  assert.ok(text.includes('Línea 12 de la página 20'));
  assert.equal(progress.at(-1), 100);
});

test('un PDF con páginas escaneadas marca meta.scanned y lista esas páginas en lotes', async () => {
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

test('los lotes del modo nativo respetan las páginas por llamada', async () => {
  const path = tmp.join('todo-escaneado.pdf');
  await makePdf(path, 7, { scanned: [1, 2, 3, 4, 5, 6, 7] });
  const { meta } = await extract(await att(path, 'application/pdf'), { config: { document: { nativePagesPerCall: 3 } } });
  assert.deepEqual(meta.nativePageBatches, [[1, 2, 3], [4, 5, 6], [7]]);
});

test('selectPdfPages parte el PDF y deja sólo las páginas pedidas', async () => {
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

test('un XLSX rotula cada hoja con su nombre', async () => {
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

test('un PPTX entrega el título y las viñetas de cada diapositiva', async () => {
  const path = tmp.join('plan.pptx');
  await writeFile(path, makePptx([{ title: 'Plan', bullets: ['uno', 'dos'] }, { title: 'Riesgos', bullets: ['tres'] }]));
  const { text, meta } = await extract(await att(path, 'application/vnd.openxmlformats-officedocument.presentationml.presentation'));
  assert.equal(meta.format, 'pptx');
  for (const s of ['Plan', 'uno', 'dos', 'Riesgos', 'tres']) assert.ok(text.includes(s), s);
});

test('un texto plano y un markdown pasan sin cambios, y sin tipo útil se detecta UTF-8', async () => {
  const path = tmp.join('notas.md');
  await writeFile(path, '# Notas\n\n- revisar el módulo de pagos\n');
  assert.equal((await extract(await att(path, 'text/markdown'))).text, '# Notas\n\n- revisar el módulo de pagos');
  assert.equal((await extract(await att(path, 'application/octet-stream'))).text, '# Notas\n\n- revisar el módulo de pagos');
});

test('un binario desconocido se rechaza con el motivo', async () => {
  const path = tmp.join('raro.bin');
  await writeFile(path, Buffer.from([0, 1, 2, 3, 255, 254]));
  await assert.rejects(extract(await att(path, 'application/octet-stream')), (e) => e instanceof ExtractError && e.code === 'document_unsupported');
});

test('un PDF dañado se rechaza con el motivo', async () => {
  const path = tmp.join('danado.pdf');
  await writeFile(path, '%PDF-1.7\nesto no es un pdf de verdad');
  await assert.rejects(extract(await att(path, 'application/pdf')), (e) => e.code === 'document_unreadable');
});

test('un documento sobre el tamaño máximo se rechaza antes de leerlo', async () => {
  const path = tmp.join('pesado.docx');
  await makeDocx(path, 5);
  await assert.rejects(extract(await att(path, DOCX), { config: { document: { maxBytes: 100 } } }), (e) => e.code === 'document_too_large');
});

test('el plazo de la lectura corta el hilo trabajador', async () => {
  const path = tmp.join('lento.pdf');
  await makePdf(path, 20);
  const t = performance.now();
  await assert.rejects(extract(await att(path, 'application/pdf'), { config: { document: { timeoutMs: 1 } } }), (e) => e.code === 'document_timeout');
  assert.ok(performance.now() - t < 2000);
});

test('el límite de memoria del hilo trabajador corta una lectura que lo supera', async () => {
  const path = tmp.join('memoria.docx');
  await makeDocx(path, 300);
  await assert.rejects(
    extract(await att(path, DOCX), { config: { document: { memoryMb: 4 } } }),
    (e) => e.code === 'document_too_heavy',
  );
});

test('cancelar con la señal corta la lectura', async () => {
  const path = tmp.join('cancelar.pdf');
  await makePdf(path, 20);
  const controller = new AbortController();
  const pending = extract(await att(path, 'application/pdf'), { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e) => e.code === 'aborted');
});

test('el texto extraído sobre el tope se corta en un salto de línea y avisa', async () => {
  const path = tmp.join('largo.docx');
  await makeDocx(path, 40);
  const { text, meta } = await extract(await att(path, DOCX), { config: { text: { maxChars: 1000 } } });
  assert.ok(text.length <= 1000);
  assert.equal(meta.truncated, true);
  assert.ok(meta.originalChars > 1000);
  assert.equal(meta.warnings.at(-1).code, 'text_truncated');
});
