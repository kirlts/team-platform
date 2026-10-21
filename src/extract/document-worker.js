// Entry point of the worker thread: reads `workerData`, extracts and returns the result.
import { parentPort, workerData } from 'node:worker_threads';
import { extractDocumentContent } from './document-core.js';

try {
  parentPort.postMessage({ ok: true, result: await extractDocumentContent(workerData) });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: { code: error.code ?? 'document_failed', message: error.message, details: error.details ?? {} },
  });
}
