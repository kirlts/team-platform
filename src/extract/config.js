// Perillas del módulo de extracción (MASTER-SPEC §4.9, RULES 3).
// Cada valor lleva su origen: «informe NN §X» es un informe de docs/investigaciones/;
// «MASTER-SPEC §X» es el documento de diseño. Un valor sin cita en ninguno de los dos
// está declarado como cortesía y dice por qué.

const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;

export const DEFAULTS = Object.freeze({
  // Tope de texto que un extractor entrega al analizador. Sobre el tope el texto se corta
  // en un salto de línea y `meta.warnings` lleva `text_truncated`.
  text: Object.freeze({
    // 100 páginas (máximo por solicitud con contexto menor de 1 M tokens)
    // por 2.700 caracteres por página (el mayor de los dos PDF medidos), informe 05 §8.3.
    maxChars: 270_000,
  }),

  image: Object.freeze({
    // MASTER-SPEC §7.8: límite inicial de subida de imagen, 7 MB.
    maxBytes: 7 * MiB,
    // informe 06 §2.7: los modelos 4.7 y posteriores de Anthropic admiten 2576 px de lado largo.
    maxSide: 2576,
    // Formatos que los proveedores de visión aceptan tal cual (informe 06 §6.2: JPEG, PNG, GIF, WebP).
    passthroughFormats: Object.freeze(['jpeg', 'png', 'gif', 'webp']),
    // Formato al que se convierte lo demás (TIFF, AVIF, SVG) o lo que hay que reducir o girar.
    outputFormat: 'png',
    // Prompt de descripción accionable (MASTER-SPEC §7.4: «describe todo lo que sea accionable
    // para un equipo de software, textual»). Es una instrucción al modelo, no una regla de negocio.
    prompt:
      'Describe esta imagen para un equipo de software. Transcribe textualmente todo el texto ' +
      'visible: mensajes de error, etiquetas, botones, códigos, direcciones y números. Describe ' +
      'todo lo que sea accionable: qué pantalla o componente se ve, en qué estado está, qué parece ' +
      'fallar o faltar, qué se señala o se marca. No agregues intenciones que la imagen no muestre.',
  }),

  document: Object.freeze({
    // informe 05 §8.3: 32 MB de solicitud al proveedor por 3/4 del base64.
    maxBytes: 24 * MiB,
    // Menos de 30 caracteres sin espacios por página es una página sin texto
    // (escaneadas medidas: 0; página digital más pobre: 146), informe 05 §8.3.
    scannedPageMaxChars: 30,
    // informe 05 §8.3: 100 páginas por llamada al modo nativo con contexto menor de 1 M tokens.
    nativePagesPerCall: 100,
    // informe 05 §8.3: cortesía declarada, sin medición (lo más lento medido: 7,5 s).
    timeoutMs: 60_000,
    // informe 05 §8.3: pico medido de 664 MB con 50.000 filas de XLSX; se fija con resourceLimits
    // del hilo trabajador (propuesta del informe, probada aquí en document.test.js).
    memoryMb: 700,
    // H-23: the heap of the PDFium WebAssembly is external memory and `memoryMb` does not count
    // it. Same cap as the thread, 700 MiB (informe 05 §8.3), enforced in lib/pdfium-capped.js.
    // Measured 2026-10-20 (mediciones/2026-10-20-memoria-wasm-pdfium.md): 17.9 MiB at start,
    // about 10.8 MiB of heap per MB of inflated page content (1212 MiB for 112 MB), and a 300-page text PDF stays at 17.9 MiB.
    wasmMemoryMb: 700,
  }),

  audio: Object.freeze({
    // MASTER-SPEC §7.8: límite inicial de subida de audio, 25 MB.
    maxBytes: 25 * MiB,
    // MASTER-SPEC §7.4 e informe 06 §8: FLAC 16 kHz mono.
    sampleRate: 16_000,
    // MASTER-SPEC §7.4 e informe 06 §3.3: trozos de 600 s (18,5 MB medidos, bajo los 25 MB de Groq).
    chunkSeconds: 600,
    // MASTER-SPEC §7.4 e informe 06 §3.3: solapamiento de 5 s.
    overlapSeconds: 5,
    // informe 06 §3.2: Groq factura 10 s como mínimo por solicitud; un último trozo menor se
    // absorbe en el anterior (informe 06 §3.3, regla de fusión).
    minChunkSeconds: 10,
    // informe 06 §3.2: tope de archivo de Groq, 25 MB (se diseña para 25 MB, informe 06 §7).
    maxChunkBytes: 25 * MiB,
    // MASTER-SPEC §7.4: language=es.
    language: 'es',
    // informe 06 §3.2: el prompt de Whisper lleva sólo vocabulario (áreas, productos, personas)
    // y nunca instrucciones. Vacío: no se envía prompt.
    vocabulary: '',
    // MASTER-SPEC §7.4 e informe 06 §3.2: 7.200 s de audio por hora para todo el equipo.
    budgetSecondsPerHour: 7_200,
    // Ventana del presupuesto: «por hora» (informe 06 §3.2). Ventana deslizante, la lectura
    // más conservadora de «por hora»; Groq no documenta cómo la cuenta.
    budgetWindowMs: 3_600_000,
    // Cortesía declarada: un video de 20 minutos produce 3 trozos (informe 06, cálculo con
    // 600 s y 5 s) y los 20 req/min de Groq (informe 06 §3.2) no se acercan. No se midió
    // contra el proveedor real; el banco (MASTER-SPEC §7.11) lo fija.
    chunkConcurrency: 3,
    // Measured 2026-10-20 on three real voice notes (51 to 118 s, 98 Groq whisper-large-v3-turbo
    // segments): docs/investigaciones/mediciones/2026-10-20-unidades-de-audio.md.
    // Longest pause between two segments that still joins them into one line when the previous one
    // does not close a sentence. Smallest of the tested values (0.5, 0.8, 1.2, 2.0 s) that already puts
    // the median unit at 11.5 words, a full sentence (10 to 25); larger values join across pauses of
    // 0.5 to 2 s and gain nothing on the median. Groq segments are contiguous (79 of 95 measured gaps
    // are under 0.3 s), so the knob only cuts at the few real pauses.
    pauseSeconds: 0.5,
    // Word cap of a joined line. Declared courtesy, measured in the same run: with no cap, run-on speech
    // without punctuation gave units of 109 words and 52 s (p90 of 68 words); with 40 the p90 drops to 39,
    // the median rises to 17 and the longest joined unit is a single 50-word segment. 40 keeps whole the
    // longest punctuated sentences measured (29 words) plus one typical segment (p90 of 14 words).
    maxUnitWords: 40, // cortesía declarada, medición 2026-10-20 (see above)
  }),

  video: Object.freeze({
    // MASTER-SPEC §7.4: tope de 20 minutos.
    maxSeconds: 20 * 60,
    // MASTER-SPEC §7.4 e informe 06 §8: tope de 2 GB.
    maxBytes: 2 * GiB,
    // informe 06 §8, `frameSampleSeconds`: 1 fotograma por segundo.
    frameSampleSeconds: 1,
    // informe 06 §8, `frameHashDistance`: dHash de 64 bits, se conserva si la distancia con el
    // último conservado supera 6 (último valor sin pérdida de pantallas, informe 06 §2.5).
    frameHashDistance: 6,
    // informe 06 §8, `maxFrames`: 48 × 1.456 = 69.888 tokens, bajo el escalón de 100.000.
    maxFrames: 48,
    // informe 06 §8, `frameWidth`: 720 px de ancho.
    frameWidth: 720,
    // informe 06 §8: JPEG calidad 4 (`-q:v 4`), 60 KB y 1.456 tokens por fotograma.
    frameQuality: 4,
    // informe 06 §8, `sceneThreshold`: apagado. No hay perilla: el cambio de escena se descartó
    // como muestreo principal (informe 06 §2.3, cubre 8 de 16 pantallas con 0,20).
    // Prompt de descripción por fotograma. Instrucción al modelo.
    prompt:
      'Recibes fotogramas de un video en orden cronológico, cada uno rotulado «Fotograma N». ' +
      'Para cada fotograma, describe lo que se ve y que sea accionable para un equipo de ' +
      'software: pantalla o componente, estado, texto visible transcrito textualmente, errores, ' +
      'y qué cambió respecto del fotograma anterior. Responde un elemento por fotograma, con el ' +
      'mismo número.',
  }),

  link: Object.freeze({
    // 5 MiB (Readability con linkedom: 388 ms y 301 MB a 5,2 MiB; a 10,5 MiB la
    // salida cambia de forma), informe 05 §8.3.
    maxBytes: 5 * MiB,
    // informe 05 §8.3: cortesía declarada, sin medición.
    timeoutMs: 15_000,
    // informe 05 §8.3: 0 redirecciones automáticas; cada salto se pide y se revalida, con 5 como
    // máximo (cortesía declarada).
    maxRedirects: 5,
    // Nombres o direcciones privadas exentas del bloqueo SSRF. Vacío por omisión; existe para el
    // entorno de pruebas y para un anfitrión que sirva documentos desde su red interna.
    allowedPrivateHosts: Object.freeze([]),
  }),
});

function mergeSection(base, over) {
  return Object.freeze({ ...base, ...(over ?? {}) });
}

/** Mezcla las perillas dadas sobre los valores por omisión, sección por sección. */
export function resolveConfig(overrides = {}) {
  const out = {};
  for (const section of Object.keys(DEFAULTS)) out[section] = mergeSection(DEFAULTS[section], overrides[section]);
  for (const section of Object.keys(overrides)) {
    if (section !== 'workDir' && !(section in DEFAULTS)) throw new Error(`perilla desconocida: ${section}`);
  }
  // `workDir`: directorio de trabajo para archivos intermedios (fotogramas, trozos de audio).
  // Omisión: el temporal del sistema.
  out.workDir = overrides.workDir ?? null;
  return Object.freeze(out);
}
