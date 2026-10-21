// Document extractor (MASTER-SPEC §7.4, UD-009): PDF with PDFium, Office with officeparser,
// plain text directly. Reading runs in a worker thread with a deadline and memory limit
// (report 05 §8.3).
import { stat } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { ExtractError } from './errors.js';
import { createProgress } from './lib/progress.js';
import { annotate, withSpan } from '../telemetry/api.js';

const WORKER_URL = new URL('./document-worker.js', import.meta.url);

function runInWorker(workerData, cfg, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ExtractError('aborted', 'La extracción se canceló.'));
    const worker = new Worker(WORKER_URL, {
      workerData,
      resourceLimits: { maxOldGenerationSizeMb: cfg.memoryMb },
    });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      fn(value);
    };
    const timer = setTimeout(
      () => finish(reject, new ExtractError('document_timeout', 'El documento tardó demasiado en leerse.', { timeoutMs: cfg.timeoutMs })),
      cfg.timeoutMs,
    );
    const onAbort = () => finish(reject, new ExtractError('aborted', 'La extracción se canceló.'));
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.on('message', (msg) => {
      if (msg.ok) return finish(resolve, msg.result);
      finish(reject, new ExtractError(msg.error.code, msg.error.message, msg.error.details));
    });
    worker.on('error', (error) => {
      if (error.code === 'ERR_WORKER_OUT_OF_MEMORY') {
        return finish(reject, new ExtractError('document_too_heavy', 'El documento es demasiado grande para leerse.', { memoryMb: cfg.memoryMb }));
      }
      finish(reject, new ExtractError('document_unreadable', 'No se pudo leer el documento.', { cause: String(error?.message ?? error) }));
    });
    worker.on('exit', () => {
      finish(reject, new ExtractError('document_unreadable', 'La lectura del documento terminó sin resultado.'));
    });
  });
}

export async function extractDocument(attachment, ctx) {
  const { config, onProgress, signal } = ctx;
  const cfg = config.document;
  const { size } = await stat(attachment.path);
  if (size > cfg.maxBytes) {
    throw new ExtractError('document_too_large', 'El documento supera el tamaño máximo permitido.', { size, max: cfg.maxBytes });
  }
  const startedAt = performance.now();
  const progress = createProgress(onProgress, 2);
  progress.report('Lectura del documento');
  // The tool is only known once the thread returns the format: the span is renamed then.
  const { text, meta } = await withSpan('extract.document', { 'team.step': 'extract.document', 'team.input_bytes': size }, async (span) => {
    const out = await runInWorker({ path: attachment.path, mime: attachment.mime, config }, cfg, signal);
    const tool = out.meta.format === 'pdf' ? 'pdfium' : (out.meta.format === 'text' ? 'text' : 'officeparser');
    span.updateName(`extract.${tool}`);
    annotate({
      'team.step': `extract.${tool}`,
      'team.tool': tool,
      'team.format': out.meta.format,
      'team.output_chars': out.text.length,
      'team.pages': out.meta.pageCount,
      'team.scanned_pages': out.meta.scannedPages?.length,
    });
    return out;
  });
  progress.advance('Documento leído');
  const warnings = [];
  if (meta.scanned) {
    warnings.push({
      code: 'scanned_pages',
      message: `${meta.scannedPages.length} de ${meta.pageCount} páginas no tienen texto extraíble.`,
    });
  }
  progress.advance('Documento convertido');
  return { text, meta: { ...meta, warnings, elapsedMs: Math.round(performance.now() - startedAt) } };
}
