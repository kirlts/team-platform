# Memoria WebAssembly de PDFium

Medición del 2026-10-20 (H-23). Equipo del desarrollo, Node 24, `@hyzyla/pdfium` 3.0.0 exacto.

## Pregunta

`resourceLimits.maxOldGenerationSizeMb` del hilo trabajador de documentos limita el montón de V8. La memoria de WebAssembly de PDFium es un `ArrayBuffer` externo y no entra en esa cuenta. Se mide cuánta memoria toma y si existe una forma de acotarla.

## Método

Un guion lee cada PDF con `PDFiumLibrary.init()`, `loadDocument` y `getText` por página, y registra después de cada paso el tamaño del montón de WebAssembly (`HEAPU8.length`) y `process.memoryUsage()`. Los PDF sintéticos salen de `makePdf` (texto digital) y `makeHeavyPdf` (páginas que comparten un flujo de contenido comprimido con deflate de nivel 9), ambos en `src/extract/test/helpers.js`.

## Resultados

| Archivo | En disco | Montón WASM al terminar | RSS |
|---|---|---|---|
| Sin documento (solo `init`) | 0 | 17,9 MiB | 75 MiB |
| 300 páginas de texto digital | 160 KB | 17,9 MiB | 86 MiB |
| 3 páginas, flujo de 19,2 MB inflado | 47 KB | 201 MiB | 268 MiB |
| 1 página, flujo de 38,4 MB inflado | 93 KB | 390 MiB | 461 MiB |
| 1 página, flujo de 112 MB inflado | 272 KB | 1.212 MiB | 1.205 MiB |

- Un PDF de 300 páginas con texto normal no hace crecer el montón. El riesgo es un flujo de contenido que se infla: cada MB inflado cuesta unos 10,8 MiB de montón. El montón no se encoge al cerrar la página.
- Un archivo de 272 KB pasa el tope de subida de 24 MiB y llena 1.212 MiB.
- Con `resourceLimits: { maxOldGenerationSizeMb: 700 }` el mismo archivo de 112 MB inflado se lee completo, sin error y con salida 0: el límite del hilo no ve esa memoria.
- La biblioteca no ofrece `maxMemory`: su máximo es la constante 2 GiB (`getHeapMax`) y `init` solo acepta `wasmBinary`, `wasmUrl` e `instantiateWasm`.
- `performance.memory` no existe en Node. `process.memoryUsage().arrayBuffers` no sirve para vigilar: marca 10 MiB al iniciar y baja a 0,3 MiB mientras el montón crece (la memoria WASM aparece en `external`, que mezcla otras cosas y solo se puede leer desde el mismo hilo después de la asignación).

## Decisión

`src/extract/lib/pdfium-capped.js` entrega `instantiateWasm` a la biblioteca y envuelve la única importación de memoria del módulo, `emscripten_resize_heap`. Antes de cada crecimiento calcula el tamaño que la biblioteca daría al montón (20 % de crecimiento, hasta 96 MiB sobre lo pedido, alineado a páginas de 64 KiB) y lo rechaza si supera `document.wasmMemoryMb` (700, el mismo tope del informe 05 §8.3). PDFium recibe un `bad_alloc`; `readPdf` lo traduce a `document_too_heavy` con `wasmMemoryMb` y el tamaño rechazado en los detalles. El tope es sobre el montón real, no sobre la petición: el montón nunca pasa de 700 MiB.

## Comprobación

Tres pruebas en `src/extract/document.test.js`:

- 3 páginas de 19,2 MB inflados se leen con el tope por omisión y se rechazan con `wasmMemoryMb: 64`.
- 300 páginas que comparten un flujo de 112 MB inflados (272 KB en disco) se rechazan con el tope por omisión en unos 2 s.
- Con un tope de 128 MiB, el montón al terminar es menor o igual al tope y el tamaño que el envoltorio predice coincide con el que la biblioteca calcula; si una versión nueva cambia su política de crecimiento, esa prueba falla.

## Sin medir

- Otras versiones de `@hyzyla/pdfium`: el envoltorio depende de la política de crecimiento de la 3.0.0, fijada con versión exacta en `package.json`.
- PDF reales de clientes con imágenes grandes: `getText` no decodifica imágenes, así que no se espera crecimiento, pero no hay un PDF real que lo confirme (H-22).
