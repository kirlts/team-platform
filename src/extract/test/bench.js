// Timing measurement per attachment type with synthetic files and zero-latency fake providers:
// what is measured is the local work (ffmpeg, hash, PDFium, officeparser, download), not the
// providers'. Usage: node src/extract/test/bench.js   (3 runs per case; the median is reported).
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { extract } from '../index.js';
import { extractDocumentContent } from '../document-core.js';
import { FIXTURE_FFMPEG, fakeSpeech, fakeVision, makeAudio, makeDocx, makeImage, makePdf, makeTmp, makeVideo } from './helpers.js';
import { makePptx, makeXlsx } from './office-fixtures.js';

const exec = promisify(execFile);
const RUNS = 3;
const tmp = await makeTmp('bench');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const rows = [];

async function bench(name, fn, detail = () => '') {
  const times = [];
  let last;
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    last = await fn();
    times.push(performance.now() - t);
  }
  rows.push({ name, ms: Math.round(median(times)), detail: detail(last) });
}

const att = async (kind, path, mime) => ({ id: 'b', kind, path, mime, size: (await stat(path)).size });
const providers = () => ({ vision: fakeVision(), speech: fakeSpeech({ every: 20 }) });

// Image
await makeImage(tmp.join('captura.png'), { width: 1080, height: 2340 });
await bench('PNG image 1080x2340', async () => extract(await att('image', tmp.join('captura.png'), 'image/png'), { providers: providers() }), (r) => `converted: ${r.meta.converted}`);

// Documents
await makeDocx(tmp.join('m40.docx'), 40);
await makePdf(tmp.join('p20.pdf'), 20);
await makePdf(tmp.join('p300.pdf'), 300);
await writeFile(tmp.join('x.xlsx'), makeXlsx([{ name: 'Pedidos', rows: Array.from({ length: 2000 }, (_, i) => [`cliente ${i}`, i * 3, `nota ${i}`]) }]));
await writeFile(tmp.join('d.pptx'), makePptx(Array.from({ length: 20 }, (_, i) => ({ title: `Diapositiva ${i}`, bullets: ['uno', 'dos', 'tres'] }))));
for (const [label, file, mime] of [
  ['DOCX 40 points', 'm40.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['PDF 20 pages', 'p20.pdf', 'application/pdf'],
  ['PDF 300 pages', 'p300.pdf', 'application/pdf'],
  ['XLSX 2,000 rows', 'x.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['PPTX 20 slides', 'd.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
]) {
  const a = await att('document', tmp.join(file), mime);
  await bench(`${label} (worker thread)`, () => extract(a), (r) => `${r.text.length} characters`);
  await bench(`${label} (no thread, reference)`, () => extractDocumentContent({ path: a.path, mime, config: { document: { scannedPageMaxChars: 30, nativePagesPerCall: 100 } } }));
}

// 20-minute audio (3 chunks) with fake speech
await makeAudio(tmp.join('a20.m4a'), 1200);
await bench('audio 20 min (3 FLAC chunks)', async () => extract(await att('audio', tmp.join('a20.m4a'), 'audio/mp4'), { providers: providers() }), (r) => `${r.meta.chunks} chunks, ${r.meta.billableSeconds} billable s`);

// 20-minute video, vertical 1080x2340 like a phone: 6 screens repeated in a loop
const base = tmp.join('base.mp4');
await makeVideo(base, { screens: 6, secondsPerScreen: 4, width: 1080, height: 2340 });
await exec(FIXTURE_FFMPEG, ['-v', 'error', '-y', '-stream_loop', '49', '-i', base, '-c', 'copy', '-t', '1199', tmp.join('v20.mp4')]);
await bench('video 19:59 1080x2340', async () => extract(await att('video', tmp.join('v20.mp4'), 'video/mp4'), { providers: providers() }), (r) => `${r.meta.sampledFrames} muestreados, ${r.meta.dedupedFrames} tras dHash, ${r.meta.frames.length} enviados; ${JSON.stringify(r.meta.timings)}`);

// Link on a local server
const html = `<html><head><title>Página</title></head><body><article>${'<p>Un párrafo de la página con texto suficiente para que se reconozca como contenido principal. </p>'.repeat(60)}</article></body></html>`;
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;
await bench(`link ${Math.round(html.length / 1024)} KB`, () => extract({ id: 'b', kind: 'link', path: url }, { config: { link: { allowedPrivateHosts: ['127.0.0.1'] } } }), (r) => `${r.text.length} characters`);
server.close();

console.log('| Case | Median (ms) | Detail |\n|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${r.ms} | ${r.detail} |`);
await tmp.cleanup();
