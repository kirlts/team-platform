# Extracción de Word, PDF y voz de teléfono reales (TASK-013)

Fecha: 2026-10-26. Tres documentos Word, dos PDF y dos notas de voz de teléfono, todos del banco privado (fuera de git; aquí sólo cifras). Se extrajeron con `bench/run-private.mjs extract --force` y sin llaves de ningún proveedor en el entorno (`env -u ANTHROPIC_API_KEY -u GROQ_API_KEY`). El gasto es 0 USD y la voz usó `faster-whisper medium` en la CPU del equipo. Los siete archivos viven en una carpeta temporal de casos con sus manifiestos, para no pisar la extracción guardada del 2026-10-21:

```sh
BENCH_PRIVATE_DIR=<carpeta con los manifiestos> node bench/run-private.mjs extract --speech local --force --budget 0.01 --case <id> [--case <id> ...]
```

| Archivo | Tamaño | Extracción | Unidades | Qué conservó |
|---|---|---|---|---|
| Word A, plan con 57 encabezados | 230.139 bytes | 0,3 s | 373 | 2.491 palabras, 143 viñetas, 15 negritas, sin imágenes |
| Word B, instrucciones | 222.955 bytes | 0,5 s | 202 | 1.518 palabras, 37 viñetas, 21 negritas, sin imágenes |
| Word C, evaluación con tabla | 45.203 bytes | 0,4 s | 98 | 1.493 palabras, 14 encabezados, 50 filas de tabla |
| PDF A, encargo | 216.804 bytes | 0,3 s | 47 | 2 páginas de texto nativo (`scanned: false`), 459 palabras |
| PDF B, guía | 24.129 bytes | 0,3 s | 191 | 6 páginas de texto nativo, 974 palabras, 6 encabezados |
| Nota de voz A, WhatsApp Opus mono | 279.760 bytes, 107,2 s | 67,5 s con `medium` local | 8 | 262 palabras con marca de tiempo por segmento |
| Nota de voz B, Opus mono | 128.524 bytes, 50,6 s | 45,6 s con `medium` local | 8 | 158 palabras con marca de tiempo por segmento |

Los cinco documentos salieron sin llamar a visión (`calls` vacío, `nativePageBatches` vacío; las notas de voz hacen una llamada de transcripción cada una). Los tiempos de documento coinciden con los de la extracción guardada del 2026-10-21: el PDF A tardó 400 ms entonces y 253 ms ahora. Las dos notas de voz tardaron 1,8 s y 1,2 s con Groq `whisper-large-v3-turbo`. La CPU local tarda de 0,6 a 0,9 veces la duración del audio, y las dos cifras no se comparan.

Límites: la voz de producción es Groq. La medición local sólo comprueba que la nota se decodifica, se troza y se transcribe con marcas de tiempo. Los Word con imágenes (de 1 a 28 por archivo en el banco) llaman a visión y quedan fuera de esta medición por costo.
