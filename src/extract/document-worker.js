// Punto de entrada del hilo trabajador: lee `workerData`, extrae y devuelve el resultado.
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
