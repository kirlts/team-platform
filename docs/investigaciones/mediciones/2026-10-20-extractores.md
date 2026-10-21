# Mediciones de los extractores, 2026-10-20

Resultado: un documento tarda 233 a 329 ms dentro del hilo trabajador, con la combinación del informe 05 (PDFium para PDF, officeparser para Office). Un video de 19 minutos 59 segundos, vertical de 1080 por 2340, tarda 7,6 s de trabajo local. Un audio de 20 minutos tarda 1,0 s hasta la llamada al proveedor. Ninguna cifra incluye al proveedor de modelo: la visión y la voz son dobles de latencia cero.

## Decisión de herramienta

El informe 05 existía antes de empezar el módulo, así que no se repitió la comparación de candidatas (`markitdown-node`, `unpdf` con `mammoth` y `turndown`, MarkItDown en Python). Se implementó su recomendación: `@hyzyla/pdfium` 3.0.0 para PDF y `officeparser` 8.2.0 con `generateIds: false` para DOCX, PPTX y XLSX. Esta medición comprueba que la combinación entregada cumple los tiempos del informe dentro del módulo.

## Método

- Equipo: Linux, 16 hilos, Node 24.20.0, ffmpeg 8.1.2, sharp 0.35.5. La carga media durante la corrida fue de 12 a 15 por otras sesiones: los tiempos absolutos son pesimistas.
- Guion: `node src/extract/test/bench.js`. Tres corridas por caso, se informa la mediana.
- Archivos sintéticos generados por el guion. Imagen con `sharp`, DOCX con `docx`, PDF con `pdf-lib`, XLSX y PPTX armados con `fflate`, audio con `ffmpeg -f lavfi`.
- El video tiene 6 pantallas de bloques de gris, repetidas en bucle con `-stream_loop` hasta 1199 s.
- Proveedores dobles de latencia cero. El enlace se descarga desde un servidor local con la excepción de red privada declarada.

## Resultados

| Caso | Mediana (ms) | Detalle |
|---|---|---|
| Imagen PNG 1080x2340 | 4 | pasa sin convertir |
| DOCX 40 puntos, en hilo trabajador | 286 | 3.443 caracteres |
| DOCX 40 puntos, sin hilo | 17 | referencia |
| PDF 20 páginas, en hilo trabajador | 233 | 16.112 caracteres |
| PDF 20 páginas, sin hilo | 37 | referencia |
| PDF 300 páginas, en hilo trabajador | 329 | 246.286 caracteres |
| PDF 300 páginas, sin hilo | 150 | referencia |
| XLSX 2.000 filas, en hilo trabajador | 297 | 69.450 caracteres |
| XLSX 2.000 filas, sin hilo | 73 | referencia |
| PPTX 20 diapositivas, en hilo trabajador | 240 | 768 caracteres |
| PPTX 20 diapositivas, sin hilo | 10 | referencia |
| Audio de 20 minutos, 3 trozos FLAC | 977 | 1.210 s facturables (1.200 más 10 de solapamientos) |
| Video de 19:59, 1080x2340 | 7.613 | 1.200 fotogramas muestreados, 300 tras dHash, 48 enviados |
| Enlace de 6 KB | 17 | 5.681 caracteres |

Desglose del video: audio 1.426 ms, extracción de fotogramas 3.757 ms, dHash 3.312 ms. La pista de audio y los fotogramas corren a la vez, así que el total es menor que la suma.

## Lectura

- El hilo trabajador agrega entre 190 y 270 ms por documento pequeño: es la carga de PDFium y officeparser en cada hilo nuevo. Se acepta porque da plazo de 60 s y límite de memoria (informe 05 §8.3). La llamada al modelo que sigue dura segundos.
- En el PDF de 300 páginas el hilo cuesta 180 ms más que la referencia. El texto extraído, 246.286 caracteres, queda bajo el tope de 270.000.
- Límite de memoria: con `memoryMb` en 16 la lectura de un DOCX de 300 puntos se corta con `document_too_heavy`; con 32 termina. El tope por omisión es 700 (informe 05 §8.3). El límite cubre el montón de JavaScript; la memoria de WebAssembly de PDFium queda fuera de esa cuenta.
- Un video cuya duración es 1200,54 s se rechaza con el tope de 20 minutos (1.200 s). El tope se aplica sin tolerancia, como lo fija el MASTER-SPEC §7.4.

## Sin medir

- Latencia de Groq, Anthropic y DeepSeek con archivos reales: no hay llaves en este entorno.
- Una foto HEIC real de iPhone: no hay codificador en el equipo. El rechazo se probó con una cabecera `ftyp` de marca `heic` fabricada.
- Un Word real con estilos propios, un PDF real de cliente y una grabación real de teléfono (informe 05 §9, informe 06 §8).
- Descarga contra internet real y contra servidores que entregan bytes lentamente.
