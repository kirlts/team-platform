# Extracción rápida de documentos a texto en un contenedor Node 24

Consultado el 2026-10-20. Cada fuente lleva URL y fecha de consulta. Los números marcados «medido» salen de corridas propias, descritas en la sección 1. Lo marcado «sin verificar» no tiene fuente primaria ni medición. La decisión que esto alimenta es UD-009 (la extracción más rápida con calidad suficiente) y las filas de MASTER-SPEC §3 «Extracción de documentos», §7.4 y §7.11. La sección 2 de la investigación 01 (tabla de MarkItDown, Docling y Marker) no se repite. Se la usa como punto de partida y se la corrige donde las mediciones la contradicen.

## 1. Método y corpus

Máquina de las mediciones: Linux, 16 hilos, 30 GB de RAM, Node 24.20.0, Python 3.14.7, Docker 29.8.1. Otras sesiones usaban la misma máquina: la carga media fue de 5 a 9 durante las corridas. Los tiempos absolutos son pesimistas y los relativos son comparables. Cada par herramienta-documento corre en un proceso Node nuevo. «Importación» es el tiempo de cargar el módulo. «Primera» es la primera conversión tras importar. «Caliente» es la mediana de cinco conversiones seguidas en el mismo proceso. En la tabla de finalistas cada celda es la mediana de tres procesos independientes. Los tokens se estiman como caracteres divididos por cuatro.

Los instalables se pusieron cada uno en su directorio propio dentro de `/home/kirlts/.cache/claude-tmp/extr/` (fuera del repositorio) y el tamaño es el de `node_modules` según `du`. Documentos de muestra, todos generados o descargados para la ocasión:

| Documento | Contenido |
|---|---|
| `minuta40.docx` | 40 puntos con encabezado, párrafo con negrita y cursiva, lista con subnivel, lista numerada y 4 tablas de 6 filas; 11 KB (generado con `docx` de npm) |
| `informe20.docx` | lo mismo con 140 puntos y 11 tablas; 14 KB, 19 páginas al exportar |
| `informe20.pdf` | exportación a PDF del anterior con LibreOffice: 19 páginas, texto y 11 tablas; 593 KB |
| `attn.pdf` | «Attention Is All You Need» (arXiv 1706.03762): 15 páginas a dos columnas, tablas, ecuaciones; 2,2 MB |
| `escaneado5.pdf` | 5 páginas de `attn.pdf` rasterizadas a 150 ppp, sin capa de texto; 1,3 MB |
| `mixto6.pdf` | 3 páginas digitales y 3 escaneadas intercaladas |
| `deck20.pptx` y `deck20.pdf` | 20 diapositivas con viñetas, notas del orador y 4 tablas; 184 KB |
| `pedidos2000.xlsx` | 2 hojas, 2.001 filas en la primera y una hoja con fórmulas; 65 KB |
| `big304.pdf`, `grande3000.docx`, `grande50k.xlsx` | 304 páginas (2,5 MB), 3.000 puntos (36 KB) y 50.000 filas (1,6 MB) para ver la escala |

La calidad se midió de dos maneras. Cobertura: el DOCX y el PDF de 40 y 140 puntos traen 224 y 766 cadenas conocidas (título de cada punto, criterios, subcriterios, pasos, filas de tabla). Se cuenta cuántas aparecen intactas en la salida y no pegadas a otra palabra. Estructura: lectura de la salida para listas anidadas, tablas, encabezados, notas y nombres de hoja. No se corrió una descomposición con un modelo. El efecto de cada formato de salida sobre el puntaje MECE queda para el banco de §7.11 y figura como sin verificar.

## 2. Candidatas Node

### 2.1 Inventario

Versiones, licencias y fechas salen del registro de npm y de la API de GitHub, consultados el 2026-10-20 (`registry.npmjs.org/<paquete>`, `api.github.com/repos/<repo>`). «Nativo» indica un binario `.node` precompilado o un ejecutable por plataforma.

| Paquete | Versión | Última publicación | Licencia | Instalado | Nativo | Qué entrega |
|---|---|---|---|---|---|---|
| `markitdown-node` | 1.5.2 | 2025-11-16 | MIT | 193 MB, 460 paquetes | `sharp` | Markdown de PDF, DOCX, PPTX, XLSX; usa `pdf-ts`, `mammoth`, `exceljs`, `jsdom`, `tesseract.js` |
| `markitdown-ts` | 0.0.10 | 2026-02-07 | MIT | 159 MB | `@napi-rs/canvas` (Skia) | PDF, DOCX, XLSX; sin PPTX; usa `pdf-parse`, `mammoth`, `xlsx` |
| `unpdf` | 1.9.1 | 2026-10-19 | MIT | 3 MB | no | texto de PDF con PDF.js 6.4.299 empaquetado |
| `pdf-ts` | 0.0.2 | 2023-08-08 | MIT | 48 MB | no | texto de PDF sobre PDF.js |
| `pdfjs-dist` | 6.4.299 | 2026-10-03 | Apache-2.0 | 71 MB | `@napi-rs/canvas` (Skia) | PDF.js completo |
| `@hyzyla/pdfium` | 3.0.0 | 2026-10-10 | MIT | 14 MB | no (WASM) | PDFium compilado a WASM: texto por página y render |
| `mupdf` | 1.28.1 | 2026-09-06 | AGPL-3.0-or-later | 14 MB | no (WASM) | texto estructurado, render |
| `mammoth` | 1.13.0 | 2026-09-26 | BSD-2-Clause | 8 MB | no | DOCX a HTML; la salida Markdown está deprecada |
| `turndown` | 7.2.4 | 2026-04-03 | MIT | 9 MB | no | HTML a Markdown |
| `officeparser` | 8.2.0 | 2026-10-20 | MIT | 153 MB | `@napi-rs/canvas` (Skia, 36 MB) por `pdfjs-dist`; `tesseract.js` y su WASM de 44 MB | DOCX, PPTX, XLSX, ODF, PDF y otros a un AST y de ahí a Markdown, texto o fragmentos |
| `docx4js` | 3.3.0 | 2024-09-09 | MIT | 8 MB | no | árbol de renderizado de DOCX; no genera texto ni Markdown |
| `@mdgate/converters` | 0.6.25 | 2026-08-27 | MIT | 3 MB | no | 150 formatos en TypeScript puro |
| `@giraffesyo/downmark` | 0.10.0 | 2026-08-24 | MIT en npm, Apache-2.0 en GitHub | 19 MB | binario Go por plataforma o WASM de 12 MB | PDF, DOCX, PPTX, XLSX, HTML, CSV |
| `@kreuzberg/node` | 4.10.2 | 2026-07-12 | MIT | 87 MB | `.node` Rust | más de 70 formatos |
| `@llamaindex/liteparse` | 2.15.1 | 2026-10-01 | Apache-2.0 | 65 MB | `.node` Rust | texto de PDF con disposición espacial |
| `@sylphx/anymd` | 8.5.5 | 2026-10-19 | MIT (según su README) | 26 MB | ejecutable Rust | PDF, DOCX, PPTX, XLSX, EPUB, HTML |
| `pandoc-wasm` | 1.1.0 | 2026-06-11 | GPL-2.0-or-later | 57 MB | no (WASM) | pandoc 3.9; DOCX a Markdown, sin PDF |

Tres hechos del inventario cambian lo que dice MASTER-SPEC §3. Primero, `markitdown-node` tiene una estrella en GitHub, un mantenedor y once meses sin publicar. Su motor de PDF es `pdf-ts`, sin cambios desde 2023-08-08. Segundo, `mupdf` es AGPL-3.0. Enlazarlo en un servicio que otros usan por red obliga a publicar el código del servicio, así que no es compatible con una licencia MIT. Artifex ofrece una licencia comercial (`mupdf.readthedocs.io/en/latest/license.html`, consultada 2026-10-20). Tercero, `pandoc-wasm` es GPL-2.0-or-later y queda fuera por la misma razón de copyleft. Contradicción declarada sobre `downmark`: el registro de npm dice MIT y la API de GitHub dice Apache-2.0. Ambas son compatibles con un proyecto MIT, pero no se leyó el archivo de licencia del repositorio.

### 2.2 Tiempos medidos, PDF

Tiempo caliente en milisegundos. Los finalistas (marcados con tres puntos) son la mediana de tres procesos; el resto, de una corrida. Entre paréntesis va el pico de memoria residente del proceso Node. Para `downmark` y `anymd`, que lanzan un subproceso, se omite: el proceso hijo midió de 59 a 104 MB en las corridas que lo reportan.

| Herramienta | `informe20.pdf` (19 págs) | `attn.pdf` (15 págs, dos columnas) | Importación | Nota |
|---|---|---|---|---|
| `@hyzyla/pdfium` ... | 29 (89 MB) | 67 (124 MB) | 43 a 52 ms | texto plano, una línea por línea visual |
| `mupdf` (AGPL) ... | 32 (133 MB) | 58 (164 MB) | 47 a 59 ms | cada celda de tabla en su propia línea |
| `downmark` nativo ... | 44 | 47 | 4 ms | filas de tabla en una línea; sin Markdown de tabla |
| `pdf-ts` | 34 (161 MB) | 113 (243 MB) | 28 a 34 ms | 831 de 1.863 líneas tienen 3 caracteres o menos |
| `liteparse` | 49 (91 MB) | 81 (89 MB) | 6 a 26 ms | rellena con espacios para reproducir columnas |
| `markitdown-node` ... | 51 (293 MB) | 102 (387 MB) | 458 a 593 ms | usa `pdf-ts`; separa las palabras en líneas |
| `markitdown-ts` ... | 60 (390 MB) | 154 (461 MB) | 459 a 773 ms | usa `pdf-parse`; texto continuo |
| `unpdf` ... | 66 (208 MB) | 223 (337 MB) | 1 ms | texto continuo, filas de tabla en una línea |
| `pdfjs-dist` | 69 (240 MB) | 223 (382 MB) | 100 a 684 ms | idéntico a `unpdf` en contenido |
| `anymd` ... | 82 | 159 | 0 ms | tablas en Markdown, advierte si no hay capa de texto |
| `kreuzberg` (Markdown) ... | 228 (117 MB) | 277 (152 MB) | 1 a 2 ms | fusiona párrafos; la Tabla 2 sale como un párrafo |
| `@mdgate/converters` | 1.639 (271 MB) | 592 (382 MB) | 46 a 124 ms | encabezados asignados a rótulos de figura |
| `officeparser` (Markdown) ... | 543 (356 MB) | 971 (348 MB) | 99 a 115 ms | párrafos, encabezados y tablas en Markdown; con ruido en enlaces |
| MarkItDown Python ... | 1.778 | 2.015 | 427 a 526 ms por proceso | pega palabras en `attn.pdf` (ver 2.5) |

Tablas en `attn.pdf` (Tabla 2 del artículo, fila «ConvS2S [9] 25,16 40,46 ...»). La fila queda en una sola línea en `downmark`, `kreuzberg`, `liteparse`, `markitdown-ts`, `mdgate`, `pdfium`, `pdfjs-dist` y `unpdf`. `officeparser` y `anymd` la entregan como tabla Markdown con la fila intacta, aunque `officeparser` deja celdas mal ubicadas en varias filas. Se pierde en `markitdown-node` y `pdf-ts` (la fila se parte en líneas sueltas), en `mupdf` (una celda por línea) y en MarkItDown Python. Cobertura de contenido en `minuta40.pdf` e `informe20.pdf`: 100 % en todas las herramientas de la tabla (224 de 224 y 766 de 766 cadenas).

### 2.3 Tiempos medidos, DOCX, PPTX y XLSX

Misma convención. Las celdas con tres puntos son medianas de tres procesos.

| Herramienta | `informe20.docx` (140 puntos) | `deck20.pptx` | `pedidos2000.xlsx` | Importación |
|---|---|---|---|---|
| `kreuzberg` ... | 11 | 5 | 25 | 1 a 2 ms |
| `anymd` ... | 16 | 14 | 20 | 0 ms |
| `@mdgate/converters` | 32 | 15 | 42 | 46 a 63 ms |
| `downmark` nativo ... | 45 | 31 | 168 | 3 a 10 ms |
| `officeparser` ... | 74 | 17 | 91 | 72 a 89 ms |
| `mammoth` + `turndown` ... | 93 | no aplica | no aplica | 102 ms |
| `markitdown-node` ... | 131 | 21 | 51 | 419 a 507 ms |
| `markitdown-ts` ... | 199 | no existe | 1.091 (RSS 1.374 MB) | 459 a 773 ms |
| MarkItDown Python ... | 463 | 31 | 695 | 419 a 669 ms por proceso |
| `pandoc-wasm` (GPL) | 520 (una sola corrida) | no aplica | no aplica | 1.187 ms la primera |
| `pandoc` nativo (referencia) | 250 ms de reloj incluyendo el arranque | no aplica | no aplica | |
| `docx4js` | 99 a 135 ms, sin salida de texto | no probado | no probado | |

Cobertura en DOCX (224 cadenas en `minuta40.docx`, 766 en `informe20.docx`): 100 % en `downmark`, `kreuzberg`, `anymd`, `mammoth` + `turndown`, `markitdown-ts`, `officeparser`, `mdgate` y MarkItDown Python; 64,3 % y 63,4 % en `markitdown-node`. La causa se ve en la salida. Los elementos de una lista con subnivel salen pegados («- Criterio de aceptación 1.bSubcriterio 1.b.1»). Además, un párrafo con texto normal, negrita y cursiva sale entero como `***...***` en el DOCX generado con `docx`. Esa segunda falla puede depender de cómo escribe los tramos esa librería; con un Word real no se probó.

Estructura en DOCX de las demás. `mammoth` + `turndown` y `officeparser` conservan listas anidadas y tablas; `mammoth` + `turndown` agrega una fila de encabezado vacía antes de cada tabla porque `mammoth` no emite `thead`. `downmark` conserva listas y tablas con bordes alineados, une negrita y cursiva en un solo tramo y deja el comentario `<!--THE END-->` entre una lista con viñetas y una numerada. `kreuzberg` en modo Markdown aplana el subnivel y entrega bien las tablas. `officeparser` antepone un bloque de metadatos YAML y agrega `{#ancla}` a cada encabezado. La opción `generateIds: false` quita las anclas (de 16.146 a 14.162 caracteres en `minuta40.docx`).

PPTX: `downmark` marca cada diapositiva con un comentario HTML y conserva las notas del orador. `officeparser` entrega título en negrita, viñetas, notas con «Note:» y tablas. `anymd`, `kreuzberg` y `markitdown-node` entregan el texto con títulos de diapositiva. XLSX: `downmark`, `kreuzberg`, `anymd`, `markitdown-node` y `markitdown-ts` rotulan cada hoja con su nombre. `officeparser` separa las hojas con una línea `---` y no pone el nombre en el Markdown, aunque el AST lo trae (`metadata.sheetName`); un `onNode` de cinco líneas lo recupera. Las fórmulas sin valor guardado salen vacías o como `NaN`. Con el valor guardado por LibreOffice todas imprimen el número (912.879,5 en la celda comprobada). Una primera lectura había dado `[object Object]` en `markitdown-node`. Se descartó al recalcular el libro: era un artefacto de generar el XLSX con `exceljs` sin valores calculados.

### 2.4 Escala

| Caso | `@hyzyla/pdfium` | `downmark` | `anymd` | `unpdf` | `kreuzberg` | `markitdown-node` | `officeparser` | Otros |
|---|---|---|---|---|---|---|---|---|
| PDF de 304 páginas, 742.000 caracteres | 337 ms (128 MB) | 208 ms | 810 ms | 905 ms (383 MB) | 2.204 ms | 522 ms | 6.760 ms (496 MB) | |
| DOCX de 3.000 puntos, 430.000 caracteres | no aplica | 175 ms | 79 ms | no aplica | 56 ms | 1.499 ms | 359 ms (384 MB) | `mammoth` + `turndown` 3.023 ms (422 MB); MarkItDown Python 2.040 ms |
| XLSX de 50.000 filas, 1,6 MB de archivo, 3,79 millones de caracteres | no aplica | 930 ms (104 MB) | 112 ms, salida cortada a 123.752 caracteres por su tope propio de tokens | no aplica | 554 ms (326 MB) | 817 ms (839 MB) | 1.791 ms (664 MB) | `markitdown-ts` abortó con volcado de memoria; MarkItDown Python 15.937 ms (una corrida) |

Dos lecciones. Primera: la extracción nunca es el cuello. La peor celda sana de la tabla es 6,8 s para 304 páginas con `officeparser`, y una llamada al modelo con ese contenido dura decenas de segundos. Segunda: el límite real es el tamaño del texto producido. Un XLSX de 1,6 MB produce 3,79 millones de caracteres (unos 950.000 tokens) y un PDF de 2,5 MB produce 186.000 tokens. Un tope en megabytes del archivo no protege al modelo. Hace falta un tope en caracteres extraídos (sección 8.3).

### 2.5 Lo que las fuentes independientes dicen de la calidad

El único banco independiente y reciente que compara estas familias es AgentDocBench. Corrió en un corredor de GitHub de 4 CPU y se fusionó el 2026-09-25 en el repositorio de `anymd` (`github.com/SylphxAI/anymd/pull/758`, consultado 2026-10-20). Resultados con 38 documentos de 12 categorías:

| Herramienta (versión) | Puntaje total | Celdas de tabla F1 | Orden de lectura | Tiempo total |
|---|---|---|---|---|
| Docling 2.130.0 | 93,0 | 89,9 | 94,4 | 2.432 s |
| `anymd` 7.0.0 | 90,4 | 75,5 | 96,2 | 30,0 s |
| Kreuzberg 4.10.4 | 81,7 | 38,4 | 96,8 | 16,0 s |
| Unstructured 0.27.8 | 81,2 | 38,4 | 93,9 | 347 s |
| MarkItDown 0.1.8 | 76,8 | 57,2 | 85,5 | 75,6 s |
| pdftotext 24.02 | 42,2 | sin dato | sin dato | sin dato |

El banco lo propuso el autor de `anymd`, así que su posición es de parte interesada. El corredor y los documentos son públicos. Un segundo registro es la evaluación OpenDataLoader citada por `yage.ai` (2026-04-12, `yage.ai/share/markitdown-survey-en-20260412.html`). Puntúa a MarkItDown en 0,589 sobre 1 contra 0,882 de Docling, con fidelidad de tablas de 0,273 y jerarquía de encabezados de 0,000. Dice que su motor por omisión (`pdfminer.six`) «only does text stream extraction» y no hace análisis de disposición, OCR ni reconocimiento de tablas. Contradicción declarada: el comparativo de Firecrawl reproducido por Pondero (2026-08-28, `pondero.ai/agents/guides/anydoc-vs-unstructured-vs-docling-vs-markitdown-august-2026/`) pone a MarkItDown en 65, por encima de Docling con 57. La diferencia viene de quién diseñó el banco (el vendedor de AnyDoc, que gana con 81), de que el juez es un modelo y de que el corpus no está publicado. Esa fuente declara además una comisión de afiliado. Para este contexto vale el banco con corpus público.

Las mediciones propias concuerdan con el orden de AgentDocBench en un punto y lo matizan en otro. Coinciden en que MarkItDown es lento y de tablas débiles. Lo matizan en `kreuzberg`: en mis documentos su Markdown de DOCX y XLSX es completo y su PDF pierde filas de tabla, como indica su F1 de 38,4.

Sobre MarkItDown en Python hay una falla medida que ninguna fuente menciona. En `attn.pdf` (PDF generado con LaTeX) la versión 0.1.8 con `pdfminer.six` 20260107 devuelve 2.802 palabras contra unas 6.100 de las demás. Trae 343 «palabras» de 25 letras o más («Providedproperattributionisprovided,Googleherebygrantspermissionto»): pierde los espacios. En `informe20.pdf`, exportado por LibreOffice, el texto sale correcto. Una búsqueda de incidencias no devolvió un reporte que coincida en el repositorio de MarkItDown. El síntoma coincide con el que describe el proyecto `pdfannots` para `pdfminer` en PDF sin etiquetas (`pypi.org/project/pdfannots`, consultado 2026-10-20). La causa es probable pero sin verificar.

## 3. MarkItDown en Python como proceso

Instalado con `uv` en un entorno virtual: `markitdown[pdf,docx,pptx,xlsx]` 0.1.8 (PyPI, subido el 2026-09-21, licencia MIT según el repositorio `github.com/microsoft/markitdown`, 191.300 estrellas, consultado 2026-10-20). Pide Python 3.10 a 3.14. El entorno ocupa 268 MB en disco.

Costo de arranque medido. `python -c pass` toma 0,01 s. Importar `markitdown` toma de 0,4 a 0,7 s en la mayoría de las corridas y llegó a 3,2 s en la primera, con la máquina cargada. Una conversión de DOCX en un proceso nuevo toma de 0,80 a 0,90 s de reloj con 168 MB de memoria. `markitdown --help` toma 0,75 s. Un proceso Node vacío toma 0,04 s. Si el servicio mantiene un intérprete vivo y le envía trabajos, la importación se paga una vez. Los tiempos calientes siguen siendo los peores de la lista: PDF de 15 a 19 páginas en 1,8 a 2,0 s, DOCX de 140 puntos en 0,46 s, XLSX de 2.000 filas en 0,70 s y de 50.000 filas en 15,9 s.

Imagen Docker construida sobre `node:24-slim` (328 MB sin nada agregado, medido con `docker images`): con Python 3 y `markitdown[pdf,docx,pptx,xlsx]` queda en 911 MB (más 583 MB); sin el extra `xlsx`, que arrastra `pandas`, `numpy` y `openpyxl`, 807 MB (más 479 MB). Para comparar, `markitdown-node` da 579 MB (más 251 MB), `officeparser` más `@hyzyla/pdfium` 564 MB (más 236 MB), `kreuzberg` 459 MB (más 131 MB) y `downmark` 358 MB (más 30 MB). Los valores de `npm` incluyen la limpieza de la caché de npm en la misma capa; sin ella, `markitdown-node` pasaba de 755 MB.

`markitdown-mcp` 0.0.1a7 (PyPI, 2026-09-14, MIT, `pypi.org/project/markitdown-mcp/`, consultado 2026-10-20) es un servidor MCP por STDIO, HTTP o SSE. La propia página lo declara pre-lanzamiento, «meant for local use, with local trusted agents», sin autenticación, con una herramienta que lee cualquier archivo al que el usuario del proceso tenga acceso. Para un servicio que recibe archivos de personas no resuelve nada que la biblioteca no resuelva mejor y agrega un servidor sin autenticación; queda descartado.

## 4. Opciones WASM

`@hyzyla/pdfium` 3.0.0 es PDFium en WASM, con licencia MIT sobre el envoltorio. PDFium es Apache-2.0 y BSD-3 según la tabla del benchmark `py-pdf/benchmarks`, que lista `pypdfium2` bajo esas licencias (consultada 2026-10-20). Instalado ocupa 14 MB, no tiene dependencias nativas y se importa en 43 a 62 ms. Es la más rápida de las entradas en proceso: 29 ms en 19 páginas, 67 ms en 15 páginas de dos columnas y 337 ms en 304 páginas con 128 MB de memoria. La salida es texto con una línea por línea visual y las filas de tabla en una sola línea. Entrega además el texto por página, que es lo que pide el detector de escaneados de la sección 5. Las páginas de `escaneado5.pdf` devolvieron 0 caracteres sin espacios cada una.

`mupdf` (MuPDF.js) 1.28.1 es igual de rápido (32 y 58 ms), pero su licencia es AGPL-3.0-or-later. Lo confirman el registro de npm y la página de licencia de MuPDF («MuPDF is licensed under the GNU AGPL» y «the need to release the full source code for systems built with it»). Sin licencia comercial de Artifex no puede ir en un servicio MIT. No se evalúa más.

`unpdf` 1.9.1 es PDF.js empaquetado para entornos sin servidor (README de `unjs/unpdf`, consultado 2026-10-20: MIT, Node 22 o superior). Mide de 66 a 223 ms con 208 a 337 MB de memoria, de dos a tres veces el tiempo y la memoria de PDFium, con 3 MB de instalación. Su README avisa de dos cosas que importan aquí. La extracción corre en el bucle de eventos sin trabajador, por lo que conviene competir contra un temporizador. Y `maxImageSize` viene sin límite, por lo que conviene fijarlo y revisar `numPages` antes de procesar un archivo no confiable.

`@giraffesyo/downmark` es una biblioteca Go compilada a un ejecutable estático por plataforma (el paquete trae `@giraffesyo/downmark-linux-x64`, 9 MB) o a un WASM de 12 MB como alternativa. El ejecutable se lanza como subproceso, con unos 5 a 10 ms de sobrecosto según su README. El WASM midió 46 ms en `attn.pdf` y 53 ms en `informe20.docx`, igual que el ejecutable. Cobertura y estructura son buenas (sección 2.3). El riesgo es de proyecto. El repositorio se creó el 2026-07-13, tiene una estrella y una persona, y publicó al menos cinco versiones (de la 0.6.1 a la 0.10.0) entre el 2026-08-21 y el 2026-08-24. Falla con un error explícito si el PDF no tiene capa de texto («no extractable text; the PDF may be scanned images»), lo que sirve de detector gratuito.

`pandoc-wasm` queda descartado por licencia y por tiempo. Midió 520 ms calientes para un DOCX de 140 puntos contra 74 ms de `officeparser`. Es GPL-2.0-or-later, ocupa 57 MB y de los cuatro formatos solo lee DOCX.

## 5. Cuándo mandar el PDF nativo al proveedor

Documentación de Anthropic (`platform.claude.com/docs/en/build-with-claude/pdf-support`, consultada 2026-10-20). El límite es de 32 MB por solicitud y 600 páginas, o 100 páginas cuando la ventana de contexto de la solicitud es menor de 1 millón de tokens. Ambos límites cubren toda la carga, incluido lo que se envíe junto al PDF. El sistema convierte cada página a imagen y extrae su texto para entregarlo junto a la imagen. Cada página cuesta entre 1.500 y 3.000 tokens de texto según densidad, más el costo de la imagen. La documentación advierte que los PDF densos pueden llenar la ventana antes de llegar al límite de páginas y que conviene partirlos.

Contraste con la extracción propia. En `informe20.pdf` el texto extraído mide 45.700 caracteres, unos 11.400 tokens en 19 páginas, 600 por página; en `attn.pdf`, 40.400 caracteres y unos 670 tokens por página. Es decir, el texto extraído cuesta entre un 55 % y un 80 % menos que los 1.500 a 3.000 tokens de texto por página de la documentación, antes de sumar las imágenes. El PDF nativo se justifica cuando hay algo que el texto no lleva: páginas sin capa de texto, figuras o gráficos de los que depende la tarea y diagramas. Un PDF digital con texto y tablas de filas simples no lo necesita.

Detección barata de páginas sin texto. Medidas propias con `@hyzyla/pdfium` (caracteres sin espacios por página):

| Documento | Caracteres por página | Tiempo de contar |
|---|---|---|
| `informe20.pdf` (19 págs) | 818 a 2.196, la última (media página) 818 | 41 ms |
| `attn.pdf` (15 págs) | 657 a 3.634; las 3 últimas (referencias) 657 a 686 | 160 ms con carga inicial |
| `minuta40.pdf` (6 págs) | 760 a 2.065 | 17 ms |
| `deck20.pdf` (20 diapositivas) | 146 a 182 | 27 ms |
| `escaneado5.pdf` (5 págs) | 0, 0, 0, 0, 0 | 3 ms |
| `mixto6.pdf` | 1.979, 0, 1.971, 0, 2.066, 0 | 15 ms |

Entre las páginas digitales de la muestra, la más pobre en texto es una diapositiva de 146 caracteres. Las escaneadas dieron 0. Cualquier umbral entre 1 y 145 separa los dos grupos en esta muestra. Una fuente de 2026 propone contar los caracteres extraíbles por página y marcar como probable escaneo lo que baje de unos 30 (`dev.to/imapphelp/...`, «My PDF converter returned 200 OK and 214 characters for a 46-page contract», publicada el 2026-10-06, consultada 2026-10-20). En un corpus de 500 archivos mide que la extracción de texto resolvía el 76 % y que con respaldo de OCR se llegaba al 95 %, con páginas escaneadas de 10 a 40 veces más lentas. Una búsqueda de incidencias de proyectos de ingesta (resultados del 2026-10-20, no abiertos) trae otros umbrales: 30 caracteres en el total y 40 letras o dígitos para aceptar una capa oculta de OCR. Trae también el caso de una página escaneada que conserva solo un sello con el número de folio. Ese caso y el de la página en blanco piden mirar si la página tiene una imagen que la cubre. Eso no se midió aquí: en mi muestra los sellos estaban dibujados en la imagen, no como texto.

Productos abiertos que ya hacen esta distinción. AnythingLLM llama a OCR solo cuando la carga del PDF devuelve cero documentos (`collector/processSingleFile/convert/asPDF/index.js`, último commit 2026-09-02, consultado 2026-10-20). `anymd` imprime que «every page shown is a scanned image with no text layer» y ofrece OCR local con unos 2 GB de pesos descargables, desactivado por omisión. `downmark` falla con error. Ninguno ofrece partir el PDF para mandar solo las páginas sin texto. La partición con `pdf-lib` (MIT, 26 MB de instalación) midió 36 ms para 3 páginas de un PDF de 6 y 249 ms para 3 de 15. Mandar al proveedor solo las páginas que lo necesitan es barato y deja el resto con extracción, a unos 600 tokens por página.

## 6. Límites que fijan otros productos abiertos, y de dónde sacan el número

| Producto | Límite por omisión | Origen declarado del número | Fuente, consulta 2026-10-20 |
|---|---|---|---|
| Docling | `max_num_pages` y `max_file_size` iguales a `sys.maxsize`; `page_range` desde 1 hasta `sys.maxsize` | ninguno: el límite no existe por omisión | `docling/datamodel/settings.py`, rama main, último commit 2026-08-24 |
| docling-serve | `max_num_pages` y `max_file_size` sin límite; `max_document_timeout` 7 días; `max_sync_wait` 120 s; `max_sources_per_request` 3 | ninguno | `docling_serve/settings.py`, rama main |
| Open WebUI | `RAG_FILE_MAX_SIZE` y `RAG_FILE_MAX_COUNT` sin valor; búsqueda en contenido de archivo hasta 64 Mi caracteres; fragmentos de 1.000 caracteres con solape de 100; cargador de PDF por página | ninguno para el tamaño; el resto sin explicación | `backend/open_webui/config.py`, último commit 2026-10-16 |
| AnythingLLM | no impone un tamaño en el recolector de PDF; OCR si no hay documentos con texto | página de documentación `docs.anythingllm.com/faq/file-size-limit` devolvió 404 | `collector/processSingleFile/convert/asPDF/index.js` |
| Dify | `UPLOAD_FILE_SIZE_LIMIT` 15 MB; lote de 5 archivos; 10 MB por imagen; 50 MB de audio; 100 MB de video; `INDEXING_MAX_SEGMENTATION_TOKENS_LENGTH` 4.000; el cuerpo de Nginx topa en 100 MB; extractor de PDF `pypdfium2` | ninguno: la descripción dice «Maximum allowed file size for uploads in megabytes» sin justificar el 15 | `docs.dify.ai/en/self-host/configuration/environments` (sin fecha) y `api/configs/feature/__init__.py`, último commit 2026-08-24 |
| Claude (API) | 32 MB y 600 páginas; 100 páginas si el contexto es menor de 1 M tokens | la propia documentación, por plataforma | `platform.claude.com/docs/en/build-with-claude/pdf-support` |

Ningún producto abierto citado deriva su número de una medición. Docling y Open WebUI no ponen tope. Dify pone 15 MB sin justificar. El único límite con origen es el del proveedor del modelo, y es el que gobierna aquí. Por eso las perillas de la sección 8.3 se derivan de ese límite y de las mediciones propias, no se copian de estos productos. Sin tope en el tamaño del archivo, la memoria queda gobernada por lo que mida cada extractor. En las corridas propias, el pico más alto con la herramienta recomendada fue de 664 MB (`officeparser` sobre 50.000 filas) y el del PDF de 304 páginas fue de 128 MB.

## 7. Enlaces y SSRF

### 7.1 Lectura del contenido principal

`@mozilla/readability` 0.6.0 (Apache-2.0, última publicación en npm 2025-03-03; el repositorio recibió cambios hasta 2026-08-04; 11.500 estrellas) acepta cualquier DOM, aunque su README solo ejemplifica `jsdom`. `maxElemsToParse` viene en 0 (sin límite); `isProbablyReaderable` usa `minContentLength` 140 y `minScore` 20 y el README lo califica de comprobación aproximada. El README recomienda pasar la salida por un sanitizador como DOMPurify: Readability no sanea.

Medición con 5 páginas reales descargadas el 2026-10-20 (Wikipedia, entrada de blog de Node.js, repositorio de GitHub, MDN, artículo de Martin Fowler; 84 a 541 KB):

| Combinación | Tiempo por página | Tamaño de salida respecto de `jsdom` |
|---|---|---|
| Readability + `linkedom` 0.18.13 (ISC) | 24 a 98 ms | entre 0,92 y 1,00 |
| Readability + `jsdom` 30.1.3 (MIT) | 53 a 201 ms | referencia |
| `defuddle` 0.19.5 + `linkedom`, salida Markdown | 53 a 236 ms | 0,70 a 1,27 |
| `defuddle` + `jsdom` | 527 a 2.006 ms | 1,02 a 4,3; en el caso de Wikipedia 102.537 caracteres contra 26.315 |

`linkedom` es entre dos y cuatro veces más rápido que `jsdom` con diferencias de salida del 8 % o menos en Readability. `defuddle` con `jsdom` 30 lanzó `RangeError: Selector exceeds maximum allowed length of 2048` en el selector interno de `jsdom` en al menos una página, y devolvió salidas inconsistentes en otras; con `linkedom` no falló. `defuddle` (MIT, 9.700 estrellas, README: «Beware! Defuddle is very much a work in progress!») no tiene benchmark publicado: su autor respondió en Hacker News que se apoyaba en «manual testing and user feedback» (comentario de 2025, fuera de la ventana de 12 meses, `news.ycombinator.com/item?id=44067409`). Otra comparación de 2026 trae una recuperación de palabras de 0,686 para Readability en el corpus anotado de Zyte (`zyte.com/blog/how-to-convert-a-website-to-markdown-for-ai-7-methods-compared/`, resultado de búsqueda, no abierto, sin verificar) y no incluye a `defuddle`. Sin referencia anotada propia, mi medición solo prueba velocidad y estabilidad, no cuál recupera mejor el texto principal.

Tamaño de la entrada. Se repitió el cuerpo de la entrada de blog de Node.js (541 KB por repetición) y se pasó por Readability con `linkedom`. A 0,5 MiB tomó 103 ms; a 2,1 MiB, 167 ms. A 5,2 MiB tomó 388 ms con 301 MB de memoria. A 10,5 MiB tomó 1.154 ms con 424 MB. A 10,5 MiB la salida pasó además de 39.837 a 796.716 caracteres, porque el algoritmo dejó de aislar el artículo. Hasta 5 MiB el comportamiento es estable.

### 7.2 Descarga con límite y SSRF

En 2026 el patrón de falla repetido es validar el nombre y luego dejar que el cliente resuelva otra vez. CVE-2026-61704 (publicado el 2026-09-02, `securelayer7.net/lab/cve-2026-61704-link-preview-js-dns-rebinding-ssrf-bypass`, consultado 2026-10-20): `link-preview-js` hasta la 4.0.3 resolvía y validaba el nombre una vez, y llamaba a `fetch()` con el nombre original. El sistema operativo volvía a resolver al conectar. Un DNS del atacante contestaba una IP pública al validar y una interna (127.0.0.1 o la de metadatos de la nube) al conectar. La 4.0.4 lo corrige con un despachador de `undici` fijado a la IP ya validada.

La hoja de OWASP (`cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html`, sin fecha visible, consultada 2026-10-20) dice lo mismo: «A second, unchecked DNS lookup between validation and connection can bypass these checks». Pide conectar a la IP validada conservando el nombre en la cabecera `Host` y deshabilitar el seguimiento de redirecciones. Para URL que da un usuario, donde la lista permitida no es posible, pide bloquear al menos los rangos privados, de enlace local y los puntos de metadatos (`169.254.169.254`, `metadata.google.internal`).

`jonathanong/ssrf-guard` (MIT, exige Node 24 o superior, 2 estrellas, 57 commits, sin fecha de última publicación visible) implementa esa receta. `validateUrl` devuelve las direcciones resueltas, rechaza IP literales privadas sin consultar DNS y bloquea `localhost` y `.local`. `safeFetch` fija las direcciones al socket y revalida cada redirección, con 10 como máximo por omisión. Open WebUI trae el mismo criterio como configuración: `ENABLE_RAG_LOCAL_WEB_FETCH` en `False` y una lista de bloqueo por omisión con las direcciones de metadatos de AWS, Google y Azure, `100.100.100.200`, el multicast y los relevos 6to4. Además `AIOHTTP_CLIENT_ALLOW_REDIRECTS` va en `False`, con la explicación de que cierra el caso de una URL pública que redirige a una interna (`backend/open_webui/config.py`, último commit 2026-10-16).

Prueba propia en Node 24 con `undici` (guion de 40 líneas, sin red externa): un `Agent` con `connect.lookup` que descarta direcciones privadas, `redirect: 'manual'`, tope de bytes leído en el flujo y `AbortSignal.timeout`.

| Caso | Resultado medido |
|---|---|
| `http://localhost:PUERTO/` con el gancho de `lookup` activo | bloqueado en 12 ms («bloqueado localhost -> ::1,::1,127.0.0.1,127.0.0.1») |
| `http://127.0.0.1:PUERTO/` solo con el gancho de `lookup` | no bloqueado: se leyeron 52.494.336 bytes del servidor local |
| el mismo con revisión previa de IP literales | bloqueado en menos de 1 ms |
| `http://169.254.169.254/...` y `http://[::1]:PUERTO/` con revisión previa | bloqueados en menos de 1 ms |
| servidor local que sirve 52 MB, tope de 10 MiB | cortado a los 10.551.289 bytes leídos, en 195 ms |
| respuesta 302 hacia `169.254.169.254` | devuelta como redirección sin seguir; cada salto se vuelve a validar antes de pedirlo |

El segundo renglón es el hallazgo que cambia el diseño. El gancho de `lookup` no se ejecuta cuando el host ya es una IP, así que las IP literales exigen una comprobación previa propia. Es lo que hace `ssrf-guard` («rejects literal private IPs without a DNS lookup»). No se probó la descarga completa contra internet real ni contra servidores que goteen bytes lentamente.

Reglas con respaldo. Resolver una vez y conectar a esa dirección. Revisar antes las IP literales. Bloquear rangos privados, de enlace local, de metadatos y multicast, en IPv4 y en IPv6 (incluidas las IPv4 mapeadas en IPv6). No seguir redirecciones solas y revalidar cada una. Poner el tope de bytes en el flujo y no en `Content-Length`. Poner un temporizador total. Aceptar solo `http` y `https`. El número de redirecciones, el tope de bytes y el tiempo son perillas de la sección 8.3.

## 8. Recomendación

### 8.1 Herramienta ganadora

Por tipo, porque ninguna herramienta gana en los cuatro con la misma licencia y el mismo costo de instalación, y porque MASTER-SPEC §7.4 ya registra un extractor por archivo:

PDF: `@hyzyla/pdfium` 3.0.0. Mediciones: 29 ms para 19 páginas, 67 ms para 15 páginas a dos columnas, 337 ms para 304 páginas. Pesa 14 MB, es WASM y MIT. Entrega el conteo de caracteres por página que alimenta el detector de escaneados. La salida es texto con líneas, sin Markdown de tablas.

DOCX, PPTX y XLSX: `officeparser` 8.2.0 con `generateIds: false`. Mediciones: 74 ms para 140 puntos, 17 ms para 20 diapositivas, 91 ms para 2.000 filas, 359 ms para 3.000 puntos y 1,8 s para 50.000 filas. Es MIT, JavaScript con `@napi-rs/canvas` precompilado y WASM de OCR, 153 MB de instalación. Conserva listas anidadas, tablas, notas del orador y encabezados. Hay que recuperar el nombre de las hojas desde el AST (`metadata.sheetName`) y, si se prefiere, quitar el bloque de metadatos.

Suma de las cinco muestras (los dos PDF, el DOCX de 140 puntos, el PPTX y el XLSX): 29 + 67 + 74 + 17 + 91 = 278 ms. La misma suma da 356 ms para `markitdown-node`, más 0,42 a 0,59 s de importación y con el 36 % de las cadenas perdidas en DOCX. Para MarkItDown Python da 4.982 ms, más 0,4 a 0,7 s por proceso.

Alternativas de un solo paquete, que el banco de §7.11 debe mantener por si el costo de 236 MB de imagen pesa más que el de un mantenedor.

Kreuzberg 4.10.2 (MIT, 9.433 estrellas, último commit 2026-10-20, `.node` de 87 MB) por madurez. Office de 5 a 25 ms, PDF de 228 a 277 ms, PDF sin filas de tabla.

`downmark` 0.10.0 por velocidad y tamaño: 30 MB de imagen, PDF de 44 a 47 ms, Office de 31 a 168 ms, buena estructura. El riesgo es un proyecto de tres meses y una estrella.

`anymd` 8.5.5 por calidad: 14 a 20 ms en Office, 82 a 159 ms en PDF, tablas de PDF en Markdown y detección de escaneado incorporada. Tiene dos reparos que no pude resolver. Su README dice MIT y ofrece un plan de pago para funciones de video y verificación de citas, pero no localicé su repositorio de código por la API de GitHub. Y el único banco que lo favorece lo publicó su propio autor.

### 8.2 Tabla de recomendaciones

| Recomendación | Evidencia | Fuente, fecha |
|---|---|---|
| Sacar `markitdown-node` del primer lugar de MASTER-SPEC §3 y de UD-009 | 63,4 % de cobertura en DOCX por listas pegadas; importación de 0,42 a 0,59 s; PDF por `pdf-ts` sin cambios desde 2023-08-08; una estrella y once meses sin publicar; XLSX de 50.000 filas con 839 MB | medición propia 2026-10-20; registro de npm y API de GitHub 2026-10-20 |
| No usar MarkItDown Python como proceso | 4.982 ms contra 278 ms en la suma de cinco muestras; 0,8 a 0,9 s por proceso; palabras pegadas en `attn.pdf` (343 «palabras» de 25 letras o más); imagen de 911 MB, 583 MB más que la base; tablas con F1 de 57,2 en AgentDocBench | medición propia 2026-10-20; `github.com/SylphxAI/anymd/pull/758`, 2026-09-25 |
| No usar `markitdown-mcp` | pre-lanzamiento 0.0.1a7, sin autenticación, lee cualquier archivo del usuario del proceso | `pypi.org/project/markitdown-mcp/`, 2026-09-14 |
| PDF digital: `@hyzyla/pdfium` en proceso | 29 a 67 ms; 337 ms en 304 páginas; 14 MB; MIT; filas de tabla en una línea | medición propia; registro de npm, 2026-10-20 |
| Office: `officeparser` con `generateIds: false` | 17 a 91 ms; cobertura 100 %; listas anidadas y tablas; sin nombre de hoja en XLSX hasta leer el AST | medición propia; `github.com/harshankur/officeParser`, 2026-10-20 |
| Excluir MuPDF.js y `pandoc-wasm` | AGPL-3.0 y GPL-2.0-or-later; `pandoc-wasm` 520 ms contra 74 ms | `mupdf.readthedocs.io/en/latest/license.html`, registro de npm, 2026-10-20 |
| Detectar escaneados por página con el conteo de PDFium | escaneadas 0; la página digital más pobre 146 caracteres; 3 a 160 ms para contar | medición propia; `dev.to/imapphelp/...`, 2026-10-06 |
| Mandar al proveedor solo las páginas sin texto, partiendo el PDF con `pdf-lib` | partir 3 de 15 páginas toma 249 ms; el nativo cuesta 1.500 a 3.000 tokens de texto por página más imagen, contra 600 a 670 extraídos | medición propia; `platform.claude.com/docs/en/build-with-claude/pdf-support`, 2026-10-20 |
| Topar los caracteres extraídos y no los megabytes del archivo | un XLSX de 1,6 MB produce 3,79 millones de caracteres; un PDF de 2,5 MB, 186.000 tokens | medición propia, 2026-10-20 |
| Enlaces: Readability + `linkedom`, sin `jsdom` | 24 a 98 ms contra 53 a 201 ms con salida igual en ±2 %; `defuddle` + `jsdom` falla un selector y tarda 527 a 2.006 ms | medición propia; `github.com/mozilla/readability`, `github.com/kepano/defuddle`, 2026-10-20 |
| Enlaces: `undici` con `lookup` filtrado, revisión de IP literales, `redirect: 'manual'`, tope de bytes en el flujo | el gancho solo dejó pasar 52 MB desde 127.0.0.1; con revisión previa bloqueó en menos de 1 ms; el tope cortó en 10,55 MB | medición propia; CVE-2026-61704, 2026-09-02; OWASP SSRF, sin fecha, ambos consultados 2026-10-20 |
| Mantener Docling para la reversión de UD-009 (tablas anidadas, escaneado con OCR) | 93,0 de puntaje y 89,9 de F1 de celdas, 2.432 s para 38 documentos; 7 días de tiempo máximo por omisión en docling-serve | `github.com/SylphxAI/anymd/pull/758`, 2026-09-25; `docling-serve`, rama main, 2026-10-20 |

### 8.3 Perillas

Cada una cita su origen; el valor es la omisión y la consola de operación debería permitir cambiarlo (MASTER-SPEC §4.9).

| Perilla | Valor por omisión | Justificación |
|---|---|---|
| Tamaño máximo de archivo subido | 24 MB | 32 MB es el tope de una solicitud al proveedor y el base64 de un PDF nativo ocupa 4/3 del archivo; 32 × 3/4 = 24. Ningún producto abierto revisado da un número con origen (sección 6) |
| Tamaño máximo de texto extraído | 270.000 caracteres (unos 67.500 tokens) | 100 páginas, que es el máximo de páginas por solicitud con contexto menor de 1 M tokens, por 2.700 caracteres por página, el mayor de los dos PDF medidos (`informe20.pdf` 2.400 y `attn.pdf` 2.700). Sobre el tope el trabajo termina con un aviso y la partición queda a lo que decida §7.5. Lo medido que lo supera: 304 páginas (742.000), 3.000 puntos de DOCX (430.000) y 50.000 filas de XLSX (3,79 millones) |
| Páginas por llamada al modo nativo | 100 | límite de la documentación del proveedor con contexto menor de 1 M tokens; 600 si el contexto del modelo en uso es de 1 M o más. Contexto del modelo por omisión: sin verificar aquí |
| Umbral de página escaneada | menos de 30 caracteres sin espacios por página | las páginas escaneadas medidas dieron 0 y la digital más pobre 146; el valor 30 coincide con el umbral publicado el 2026-10-06. Cualquier valor entre 1 y 145 separa la muestra; subirlo exige una muestra con páginas digitales casi vacías |
| Regla de enrutamiento por página | páginas bajo el umbral al proveedor en modo nativo; el resto, extracción | la partición cuesta 36 a 249 ms; evita el promedio por documento, que esconde páginas vacías (hallazgo recurrente en las incidencias de 2026 consultadas, sin abrir) |
| Tiempo máximo de extracción por documento | 60 s, declarado como cortesía | no sale de una medición: lo más lento medido con la herramienta recomendada fue 7,5 s (304 páginas con `officeparser`) y los 60 s repiten el plazo por omisión de la carga web de Open WebUI. Como `unpdf` y PDFium corren en el bucle de eventos, el plazo exige un hilo trabajador; no se probó |
| Memoria por extracción | 700 MB por trabajo | pico medido de 664 MB (`officeparser` con 50.000 filas); hay que fijarlo con `resourceLimits` del hilo trabajador, sin probar |
| Descarga de enlaces: tamaño máximo | 5 MiB | Readability con `linkedom`: 388 ms y 301 MB a 5,2 MiB; a 10,5 MiB 1,15 s, 424 MB y salida que cambia de forma |
| Descarga de enlaces: redirecciones | 0 seguidas automáticamente; cada salto se pide y se revalida, con 5 como máximo | OWASP pide desactivar el seguimiento; `ssrf-guard` revalida hasta 10 saltos. El 5 es una cortesía declarada, sin medición |
| Descarga de enlaces: tiempo total | 15 s | sin medición propia ni fuente; cortesía declarada |

## 9. Sin verificar y límites de esta investigación

El efecto de cada formato de salida sobre el puntaje MECE del analizador no se midió. La cobertura de cadenas es del 100 % en casi todas las herramientas y no discrimina. El banco de §7.11 lo decide, y esta investigación deja los corpus y el guion de medición en `/home/kirlts/.cache/claude-tmp/extr/` para repetirlo. Los documentos son sintéticos o un único artículo científico. Un Word real con estilos propios, imágenes incrustadas o control de cambios, y un PDF real de un cliente, pueden mover las posiciones. Los tiempos se tomaron con la máquina cargada. No se probó OCR en ninguna herramienta. No se localizó el repositorio de código de `anymd`. La vida del proyecto `downmark` es una hipótesis: una estrella y tres meses. El aislamiento por hilo trabajador y los límites de memoria son una propuesta sin prueba. La hoja de OWASP no trae fecha. Las búsquedas de umbrales de escaneado trajeron incidencias de GitHub que se citan solo por lo que su resumen decía y no se abrieron.

## 10. Fuentes

Todas consultadas el 2026-10-20.

- `https://github.com/microsoft/markitdown` (README; MIT, 191.300 estrellas)
- `https://pypi.org/project/markitdown-mcp/` (0.0.1a7, 2026-09-14)
- `https://pypi.org/pypi/markitdown/json` (0.1.8, subida 2026-09-21)
- `https://github.com/mwilliamson/mammoth.js` (README: Markdown deprecado, sin saneamiento)
- `https://github.com/unjs/unpdf` (README)
- `https://mupdf.readthedocs.io/en/latest/license.html` y `https://www.npmjs.com/package/mupdf`
- `https://platform.claude.com/docs/en/build-with-claude/pdf-support`
- `https://dev.to/imapphelp/my-pdf-converter-returned-200-ok-and-214-characters-for-a-46-page-contract-scanned-pages-have-no-16lk` (2026-10-06)
- `https://github.com/SylphxAI/anymd/pull/758` (AgentDocBench, 2026-09-25) y `https://www.npmjs.com/package/@sylphx/anymd`
- `https://pondero.ai/agents/guides/anydoc-vs-unstructured-vs-docling-vs-markitdown-august-2026/` (2026-08-28)
- `https://yage.ai/share/markitdown-survey-en-20260412.html` (2026-04-12)
- `https://github.com/docling-project/docling/blob/main/docling/datamodel/settings.py` y `https://github.com/docling-project/docling-serve/blob/main/docling_serve/settings.py`
- `https://github.com/open-webui/open-webui/blob/main/backend/open_webui/config.py`
- `https://github.com/Mintplex-Labs/anything-llm/blob/master/collector/processSingleFile/convert/asPDF/index.js`
- `https://docs.dify.ai/en/self-host/configuration/environments` y `https://github.com/langgenius/dify/blob/main/api/configs/feature/__init__.py`
- `https://github.com/giraffesyo/downmark`, `https://github.com/kreuzberg-dev/kreuzberg`, `https://github.com/run-llama/liteparse`, `https://github.com/harshankur/officeParser`, `https://github.com/mdgate/converters`
- `https://github.com/kepano/defuddle`, `https://github.com/mozilla/readability`, `https://news.ycombinator.com/item?id=44067409` (2025, fuera de ventana)
- `https://securelayer7.net/lab/cve-2026-61704-link-preview-js-dns-rebinding-ssrf-bypass` (2026-09-02)
- `https://github.com/jonathanong/ssrf-guard`
- `https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html`
- Registro de npm (`registry.npmjs.org`) y API de GitHub (`api.github.com/repos/...`) para versiones, licencias, fechas y estrellas de todos los paquetes del inventario.
- Muestra de PDF: `https://arxiv.org/pdf/1706.03762`
