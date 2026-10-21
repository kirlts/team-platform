# Unidades de audio, 2026-10-20

Resultado: con una pausa de 0,5 s y un tope de 40 palabras, 98 segmentos de tres notas de voz reales quedan en 38 unidades. La unidad mediana pasa de 2,1 s y 5 palabras a 5,4 s y 17 palabras.

## Defecto

Groq (whisper-large-v3-turbo) devuelve un segmento por frase corta. El extractor escribía una línea `[mm:ss]` por segmento y el analizador numera una unidad por línea de audio. En la nota de 107 s eso daba 46 unidades, con fragmentos como «Eso.» o «pues cachai». El analizador descartaba los fragmentos sin contenido o los pegaba a un vecino, y un mismo mensaje quedaba partido en varias unidades.

## Método

- Entrada: tres notas de voz de 51, 118 y 107 s. Son privadas: ni los audios ni su texto salen del equipo.
- Transcripción real con Groq, una llamada por nota (un solo trozo de 600 s cada una).
- Sobre los segmentos ya fusionados por marca de tiempo se aplica `joinSegments` (`src/extract/lib/sentences.js`) con cuatro pausas: 0,5; 0,8; 1,2 y 2,0 s. Se unen segmentos consecutivos si el anterior no termina en `.?!…` y la pausa entre ellos es menor que el umbral.
- Se mide con y sin tope de palabras por unidad. Palabras: separadas por espacio. Duración: del inicio del primer segmento al fin del último.

## Resultados

Unidades por nota en el orden 51 / 118 / 107 s.

| Caso | Segmentos antes | Unidades después | Por nota | Duración mediana (s) | Palabras medianas | Palabras p90 | Palabras máx. | Duración máx. (s) |
|---|---|---|---|---|---|---|---|---|
| Sin unir | 98 | 98 | 15 / 37 / 46 | 2,1 | 5 | 14 | 50 | 20 |
| 0,5 s sin tope | 98 | 30 | 7 / 18 / 5 | 4,7 | 11,5 | 68 | 109 | 52 |
| 0,8 s sin tope | 98 | 29 | 7 / 17 / 5 | 4,5 | 11 | 68 | 109 | 52 |
| 1,2 s sin tope | 98 | 29 | 7 / 17 / 5 | 4,5 | 11 | 68 | 109 | 52 |
| 2,0 s sin tope | 98 | 28 | 6 / 17 / 5 | 5,2 | 13,5 | 68 | 109 | 52 |
| 0,5 s tope 40 | 98 | 38 | 9 / 20 / 9 | 5,4 | 17 | 39 | 50 | 22 |
| 0,8 s tope 40 | 98 | 38 | 9 / 20 / 9 | 5,2 | 15 | 39 | 50 | 22 |
| 1,2 s tope 40 | 98 | 38 | 9 / 20 / 9 | 5,2 | 15 | 39 | 50 | 22 |
| 2,0 s tope 40 | 98 | 37 | 8 / 20 / 9 | 5,5 | 18 | 39 | 50 | 22 |

Pausas entre segmentos consecutivos (95 en total): 79 bajo 0,3 s, 3 entre 0,3 y 0,5 s, 7 entre 0,5 y 0,8 s, 4 entre 0,8 y 1,2 s, 2 entre 1,2 y 2,0 s, ninguna sobre 2,0 s.

Solo 26 de 98 segmentos terminan en puntuación de fin de oración.

## Decisión

- `audio.pauseSeconds = 0,5`. Es el menor valor probado y ya deja la mediana en 11,5 palabras, dentro de una oración completa (10 a 25). Los valores mayores unen a través de pausas de 0,5 a 2 s sin mover la mediana de forma útil. Con 0,5 no se une nada a través de una pausa de 0,5 s o más. Groq entrega segmentos contiguos, así que la perilla corta en pocos puntos.
- `audio.maxUnitWords = 40`. Sin tope, el habla sin puntuación forma unidades de hasta 109 palabras y 52 s, y el p90 queda en 68 palabras. Con 40 el p90 baja a 39 y la unidad más larga es un solo segmento de 50 palabras (un segmento no se parte). El tope conserva enteras las oraciones puntuadas más largas medidas (29 palabras) y deja margen de un segmento típico (p90 de 14 palabras). Es una cortesía declarada con esta medición, no un valor del proveedor.

## Límites de la medición

- Solo tres notas, en español de Chile; no se probó otro acento ni el audio de un video de pantalla.
- Un solo trozo por nota. La regla de no unir a través del corte entre trozos la cubren pruebas con segmentos sintéticos (`src/extract/lib/sentences.test.js`, `src/extract/audio.test.js`), no esta corrida.
- La cobertura estricta del analizador con las unidades nuevas no se midió aquí: requiere el banco con el proveedor de texto real.
