# Medición de la imagen Docker, 2026-10-20

Resultado: la imagen baja de 819 MB a 466 MB según `docker images`, 352,6 MB menos (43,1 %). Las 387 pruebas de `npm test` pasan, las 95 de `src/extract/` incluidas. El banco de extracción no cambia de comportamiento ni de tiempos. El arranque hasta `/health` mide lo mismo antes y después. No se cambió ninguna dependencia ni el extractor: se podó lo que no se carga en ejecución.

## Método

- Antes: `team-platform:dev`, construida desde main (`8a2b489`). Después: `team-platform:slim`, construida con el `Dockerfile` de esta rama (`docker build -t team-platform:slim .`).
- Tamaño: columna SIZE de `docker images` (motor de contenedores con almacén containerd). Se midió también el contenido del sistema de archivos con `du -xsk /` dentro de cada contenedor, porque `docker images` incluye metadatos y no coincide con la suma de capas.
- Peso por paquete: `du -sk` de cada directorio de `/app/node_modules` y `/app/node_modules/@*/*` dentro de cada imagen.
- Pruebas y banco: contenedor `node:24-alpine` (musl, la misma libc de la imagen) con `ffmpeg` instalado, `npm ci` completo, y el guion de poda del `Dockerfile` extraído tal cual. Dos corridas del banco sin poda, la poda, y dos corridas con poda, todo en el mismo contenedor.
- Arranque: `docker run -d` con `DATA_DIR=/data`, tiempo hasta el primer 200 de `GET /health`, tres corridas por imagen, alternadas.

## Tamaño

| Medida | Antes (`dev`) | Después (`slim`) | Diferencia |
|---|---|---|---|
| `docker images` SIZE | 819.017.139 B | 466.368.032 B | −352.649.107 B (−43,1 %) |
| Contenido, `du -xsk /` | 607.520 KiB | 335.992 KiB | −271.528 KiB (−44,7 %) |
| `/app/node_modules` | 300.140 KiB, 204 paquetes | 62.036 KiB, 187 paquetes | −238.104 KiB (−79,3 %) |
| Extras de la imagen oficial de Node | `npm` 17,0 MiB, `yarn` 5,1 MiB, encabezados 6,5 MiB | ninguno (el binario de Node, 126,3 MiB, se conserva) | −28,6 MiB |

La suma de la fila de `node_modules` incluye los directorios de paquete con su alcance (`@img/sharp-...`); los directorios de alcance se cuentan una sola vez.

## Peso por paquete dentro de la imagen

Orden por ahorro. Medido con `du -sk` en las dos imágenes (MiB, un decimal).

| Paquete | Antes | Después | Ahorro | Qué se quitó |
|---|---|---|---|---|
| `tesseract.js-core` | 43,2 | 0 | 43,2 | Paquete completo (OCR) |
| `pdfjs-dist` | 34,5 | 0 | 34,5 | Paquete completo (lector de PDF de officeparser) |
| `@napi-rs/canvas-linux-x64-musl` | 31,6 | 0 | 31,6 | Paquete completo (dependencia opcional de pdfjs-dist) |
| `officeparser` | 30,6 | 2,9 | 27,7 | `dist/officeparser.browser*` (cinco paquetes para navegador de 5,3 MiB cada uno) |
| `pdf-lib` | 22,7 | 1,1 | 21,5 | `es/`, `dist/` (paquetes UMD y mapas), `ts3.4/`, `src/` |
| `@opentelemetry/semantic-conventions` | 11,8 | 1,3 | 10,5 | `build/esm/`, `build/esnext/` y tipos |
| `@hyzyla/pdfium` | 13,6 | 5,3 | 8,2 | Variantes `base64`, `browser`, `cdn`, `worker` y `index.cjs`, y el trozo `pdfium.wasm.base64-*.js` de 6,7 MiB |
| `@mixmark-io/domino` | 8,6 | 0,7 | 7,9 | `test/` (6,9 MiB) y `.yarn/` |
| `zlibjs` | 3,6 | 0 | 3,6 | Paquete completo (sólo lo usa tesseract.js) |
| `fastify` | 3,7 | 0,4 | 3,3 | `test/`, `docs/`, `examples/`, tipos |
| `lru-cache` | 3,5 | 0,7 | 2,8 | Tipos y mapas |
| `@types/node` | 2,6 | 0 | 2,6 | Paquete completo (sólo tipos) |
| `protobufjs` | 3,1 | 1,3 | 1,8 | Tipos, mapas y documentación |
| `@grpc/grpc-js` | 4,3 | 2,6 | 1,8 | Tipos y mapas |
| `tesseract.js` | 1,6 | 0 | 1,6 | Paquete completo |
| Otros 189 paquetes | | | 29,9 | Once paquetes completos (1,6 MiB, las dependencias de `tesseract.js` de abajo) y, en el resto, tipos (`*.d.ts`), mapas (`*.map`), `*.md`, `test/` y `docs/` de la raíz del paquete |
| Paquetes sin cambio de peso significativo | | | | `@img/sharp-libvips-linuxmusl-x64` 19,0 MiB (necesario), `@opentelemetry/*` restante 7 MiB, `@grpc` y `protobufjs` (los carga `sdk-node`) |

Además salen, por ser dependencias exclusivas de `tesseract.js`: `idb-keyval`, `is-url`, `node-fetch`, `whatwg-url`, `tr46`, `webidl-conversions`, `bmp-js`, `regenerator-runtime`, `wasm-feature-detect`, `opencollective-postinstall`. `npm ls` los muestra colgando sólo de `officeparser > tesseract.js`.

## Por qué cada poda es segura

1. `tesseract.js` y `tesseract.js-core`. `officeparser` trae `ocr: false` por omisión (`dist/defaults.js`, línea 93). El único `import('tesseract.js')` está en `createAndRunWorker` de `dist/utils/ocrUtils.js`, que sólo se alcanza desde `ocrDuringParse`, y todos los analizadores lo llaman tras `if (config.ocr && ...)`. `src/extract/document-core.js` llama `OfficeParser.parseOffice(buffer, { generateIds: false })` y no activa OCR. Aunque se activara, `ocrDuringParse` captura el error y devuelve `undefined`.
2. `pdfjs-dist` y `@napi-rs/canvas`. `pdfjs-dist` se carga sólo desde `loadPdfJs` (`dist/utils/moduleLoader.js`), invocada una vez, en `dist/parsers/PdfParser.js`. En `document-core.js`, `detectFormat` manda todo PDF a `@hyzyla/pdfium` y sólo entrega a `officeparser` los buffers que empiezan con `PK` (zip). `@napi-rs/canvas` es dependencia opcional de `pdfjs-dist`.
3. Variantes para navegador. `officeparser` declara `exports["."].import = dist/index.mjs`; las variantes `browser` quedan bajo la condición `browser`, que Node no usa. `pdf-lib` declara `main: cjs/index.js` y no tiene `exports`, así que Node resuelve `cjs/`. `@hyzyla/pdfium` resuelve `dist/index.esm.js`, que carga `pdfium.wasm` por `import.meta.url`; las demás variantes y el trozo base64 no se importan. `semantic-conventions` resuelve `build/src/index.js` por la condición `default`.
4. Tipos, mapas, `*.md`, `test/`, `docs/`, `examples/`. No tienen efecto en ejecución. Se conservan los archivos `LICENSE*` por la atribución. El borrado de directorios apunta sólo a la raíz de cada paquete (`./*/test`, `./@*/*/test`), no a subdirectorios que puedan ser código.
5. `npm`, `yarn` y los encabezados de Node del final. El servidor no los ejecuta, y la etapa final pasa a `alpine:3.24` (misma versión de Alpine que `node:24-alpine`) con el binario de Node copiado de la etapa `deps`.

El respaldo es la ejecución. Las 387 pruebas pasan con la poda aplicada, y la imagen final lee los cuatro formatos y carga `sharp` (sección siguiente). `src/image-prune.test.js` agrega tres prohibiciones. Ningún módulo del servidor importa un paquete podado. `document-core.js` no menciona OCR y desvía el PDF antes del camino Office. El `Dockerfile` sigue podando esos tres nombres.

## Pruebas

| Comprobación | Resultado |
|---|---|
| `npm test` en el repositorio, sin poda (línea base) | 387 pruebas, 387 pasan, 0 fallan, 12,7 s |
| `npm test` en `node:24-alpine` (musl) con la poda aplicada | 387 pruebas, 387 pasan, 0 fallan, 0 canceladas, 16,1 s |
| `node --test src/image-prune.test.js` | 3 pruebas, 3 pasan |
| Imagen `slim`: DOCX, PDF, XLSX y PPTX por `extract()` con el hilo trabajador | Los cuatro extraen: 3.443, 16.112, 6.384 y 158 caracteres |
| Imagen `slim`: `sharp` (redimensiona y codifica un PNG de 1080x2340 a JPEG) y `ffmpeg -version` | 1.109 B de JPEG; ffmpeg 8.1.2 |
| Imagen `slim`: `import('tesseract.js')`, `import('pdfjs-dist')`, `import('@napi-rs/canvas')` | Los tres ausentes, como se espera |
| Imagen `slim`: `HEALTHCHECK` | `healthy`; el usuario es `node` (uid 1000) y `/data` es escribible |

Las 95 pruebas de `src/extract/` forman parte de las 387.

## Banco de extracción

`node src/extract/test/bench.js` en el mismo contenedor, dos corridas por condición, medianas de tres iteraciones en ms. Los valores absolutos son más altos que los del informe de extractores (equipo propio, sin contenedor); la comparación válida es entre columnas.

| Caso (hilo trabajador) | Sin poda, corrida 1 | Sin poda, corrida 2 | Con poda, corrida 1 | Con poda, corrida 2 |
|---|---|---|---|---|
| DOCX 40 puntos | 335 | 332 | 297 | 280 |
| PDF 20 páginas | 329 | 243 | 298 | 276 |
| PDF 300 páginas | 374 | 448 | 393 | 361 |
| XLSX 2.000 filas | 388 | 326 | 343 | 365 |
| PPTX 20 diapositivas | 246 | 242 | 257 | 249 |
| Audio 20 min | 685 | 754 | 641 | 684 |
| Video 19:59 | 10.134 | 9.601 | 9.422 | 10.421 |
| Enlace 6 KB | 15 | 10 | 6 | 7 |

El rango de cada caso se solapa entre condiciones: ningún caso es peor de forma distinguible del ruido de una corrida a otra. Los caracteres extraídos son idénticos en todas las corridas (3.443, 16.112, 246.286, 69.450 y 768).

## Arranque hasta `/health`

Segundos desde `docker run -d` hasta el primer 200, corridas alternadas.

| Corrida | `dev` | `slim` |
|---|---|---|
| 1 | 2,42 | 2,27 |
| 2 | 1,60 | 1,68 |
| 3 | 1,53 | 1,65 |

La primera corrida incluye el arranque en frío de la capa; de la segunda en adelante, 1,5 a 1,7 s en ambas. La poda no cambia el arranque.

## Lo que se evaluó y no se hizo

- `npm ci --omit=optional`. Se probó en un directorio aparte: `import('sharp')` falla con «Could not load the "sharp" module using the linux-x64 runtime», porque `sharp` entrega su binario como dependencia opcional (`@img/sharp-*`). Se mantiene `npm ci --omit=dev`.
- `sharp` sólo con linux-x64 y linux-arm64 musl. Ya ocurre sin tocar nada. `npm` filtra las dependencias opcionales por sistema, CPU y libc, y la imagen trae un solo par (`@img/sharp-linuxmusl-x64` y `@img/sharp-libvips-linuxmusl-x64`, 19,0 MiB, necesarios). El `package-lock.json` incluye las variantes `linuxmusl-arm64`, así que una construcción en arm64 instala ese par.
- Reemplazar `officeparser`. Tras la poda, `officeparser` y las dependencias que sólo él usa pesan 4,1 MiB (0,9 % de la imagen). Un reemplazo (`mammoth` con `turndown`, `xlsx`, `node-pptx-parser`) no puede ahorrar más de eso, cambiaría el Markdown de salida y obligaría a repetir el banco por formato. No se justifica.
- Reemplazar `@opentelemetry/sdk-node` por `sdk-trace-node`, que evitaría cargar `@grpc/grpc-js`, `protobufjs` y los exportadores de métricas y registros (unos 10 MiB). El registro de npm publica `sdk-trace-node` sólo hasta 2.12.0. El proyecto usa `core`, `resources` y `sdk-trace` 3.0.0. Mezclar mayores no se probó y cambiaría el comportamiento de `src/telemetry/index.js`. Queda como la siguiente mejora de tamaño, con su propia prueba de telemetría.
- `ffmpeg`. Las bibliotecas del paquete de Alpine (`libx265` 20,8 MiB, `libavcodec` 19,9 MiB, `libaom` 8,2 MiB, entre otras) son 136 MB de la imagen. Alpine no ofrece una compilación mínima y el informe 06 eligió ese paquete; recortarlo exige compilar `ffmpeg` propio y queda fuera de este encargo.
