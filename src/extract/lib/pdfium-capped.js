// PDFium with a hard cap on its WebAssembly heap (HALLAZGOS H-23).
// `resourceLimits` of the document worker thread only count the V8 heap. The WASM memory of
// PDFium is an external ArrayBuffer and does not enter that count: measured on 2026-10-20, a
// 3-page PDF of 47 KB whose content stream inflates to 19.2 MB grows the heap from 17.9 MiB to
// 201 MiB (docs/investigaciones/mediciones/2026-10-20-memoria-wasm-pdfium.md). @hyzyla/pdfium
// 3.0.0 has no memory option (its heap maximum is a constant 2 GiB), but it accepts
// `instantiateWasm`. The module imports a single memory function, `emscripten_resize_heap`; the
// wrapper below refuses a growth that would take the heap over the cap. The refused allocation
// makes PDFium fail, and the caller turns the failure into `document_too_heavy`.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PDFiumLibrary } from '@hyzyla/pdfium';

const MiB = 1024 * 1024;
// WebAssembly page size, fixed by the WebAssembly specification.
const WASM_PAGE = 65_536;
// Growth policy of the emscripten runtime inside @hyzyla/pdfium 3.0.0 (dist/index.esm.js,
// `_emscripten_resize_heap`): the heap grows by 20 % of its size, never more than 96 MiB past
// the requested size, aligned to the page size. The wrapper predicts the size the runtime would
// reach so the cap is on the real heap, not on the request. If the library changes this policy
// the cap test in document.test.js (heap never above the cap) fails.
const GROWTH_FACTOR = 1.2;
const GROWTH_EXTRA_MAX = 96 * MiB;

const wasmBinary = () => readFileSync(createRequire(import.meta.url).resolve('@hyzyla/pdfium/pdfium.wasm'));

const alignUp = (n) => Math.ceil(n / WASM_PAGE) * WASM_PAGE;

/** Size the library's `emscripten_resize_heap` would give the heap for a request. */
export function predictedHeapSize(currentBytes, requestedBytes) {
  const overgrown = Math.min(currentBytes * GROWTH_FACTOR, requestedBytes + GROWTH_EXTRA_MAX);
  return alignUp(Math.max(requestedBytes, overgrown));
}

/**
 * @param {number} maxBytes cap of the WASM heap
 * @returns {Promise<{library: PDFiumLibrary, guard: {exceeded: boolean, refusedBytes: number, heapBytes: () => number, peakBytes: number}}>}
 */
export async function initCappedPdfium(maxBytes) {
  let memory;
  const guard = {
    exceeded: false,
    refusedBytes: 0,
    peakBytes: 0,
    heapBytes: () => memory?.buffer.byteLength ?? 0,
  };
  const instantiateWasm = (imports, receive) => {
    const grow = imports.env.emscripten_resize_heap;
    imports.env.emscripten_resize_heap = (requested) => {
      const wanted = predictedHeapSize(memory.buffer.byteLength, requested >>> 0);
      if (wanted > maxBytes) {
        guard.exceeded = true;
        guard.refusedBytes = wanted;
        return false;
      }
      const grown = grow(requested);
      guard.peakBytes = Math.max(guard.peakBytes, memory.buffer.byteLength);
      return grown;
    };
    // Synchronous on purpose: the library has no path to reject from this callback, and an
    // exception thrown here does reach its `init` promise.
    const instance = new WebAssembly.Instance(new WebAssembly.Module(wasmBinary()), imports);
    memory = instance.exports.memory;
    guard.peakBytes = memory.buffer.byteLength;
    receive(instance);
    return instance.exports;
  };
  const library = await PDFiumLibrary.init({ instantiateWasm });
  return { library, guard };
}
