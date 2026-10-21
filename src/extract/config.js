// Knobs of the extraction module (MASTER-SPEC §4.9, RULES 3).
// Each value carries its origin: «report NN §X» is a report in docs/investigaciones/;
// «MASTER-SPEC §X» is the design document. A value with a citation in neither
// is declared as a courtesy and says why.

const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;

export const DEFAULTS = Object.freeze({
  // Cap on the text an extractor hands to the analyzer. Above the cap the text is cut
  // at a line break and `meta.warnings` carries `text_truncated`.
  text: Object.freeze({
    // 100 pages (maximum per request with a context under 1 M tokens)
    // times 2,700 characters per page (the larger of the two PDFs measured), report 05 §8.3.
    maxChars: 270_000,
  }),

  image: Object.freeze({
    // MASTER-SPEC §7.8: initial image upload limit, 7 MB.
    maxBytes: 7 * MiB,
    // report 06 §2.7: Anthropic models 4.7 and later accept 2576 px on the long side.
    maxSide: 2576,
    // Formats that vision providers accept as they are (report 06 §6.2: JPEG, PNG, GIF, WebP).
    passthroughFormats: Object.freeze(['jpeg', 'png', 'gif', 'webp']),
    // Format everything else is converted to (TIFF, AVIF, SVG), or what must be shrunk or rotated.
    outputFormat: 'png',
    // Actionable description prompt (MASTER-SPEC §7.4: describe everything actionable for a
    // software team, verbatim). It is an instruction to the model, not a business rule.
    prompt:
      'Describe this image for a software team. Transcribe verbatim all visible text: error ' +
      'messages, labels, buttons, codes, addresses and numbers. Describe everything that is ' +
      'actionable: which screen or component is shown, what state it is in, what seems to fail or ' +
      'be missing, what is pointed at or marked. Do not add intentions that the image does not ' +
      'show. Write the description in Spanish.',
    // Second reading of an image that produced no message at first sight (UD-021). It asks for more detail and for the
    // likely reason the person sent it; the description feeds the analyzer, which decides what it means.
    deepPrompt:
      'A person sent this image to a software team and gave no text with it, so they sent it for a reason. Describe ' +
      'it in detail for the team. Say what kind of screen, document or mockup it is and what it shows, region by region. ' +
      'Transcribe verbatim all visible text: titles, labels, buttons, field names, values, error messages, codes and ' +
      'numbers. Say what looks wrong, unfinished, empty, misaligned, inconsistent or missing, what is marked or ' +
      'highlighted, and what the person is most likely pointing at or asking the team to do about it. Do not invent ' +
      'what the image does not show. Write the description in Spanish.',
  }),

  document: Object.freeze({
    // report 05 §8.3: 32 MB provider request times 3/4 of the base64.
    maxBytes: 24 * MiB,
    // Fewer than 30 non-space characters per page is a page without text
    // (scanned pages measured: 0; poorest digital page: 146), report 05 §8.3.
    scannedPageMaxChars: 30,
    // report 05 §8.3: 100 pages per call in native mode with a context under 1 M tokens.
    nativePagesPerCall: 100,
    // report 05 §8.3: declared courtesy, no measurement (slowest measured: 7.5 s).
    timeoutMs: 60_000,
    // report 05 §8.3: measured peak of 664 MB with 50,000 XLSX rows; set with the worker thread's
    // resourceLimits (the report's proposal, tested here in document.test.js).
    memoryMb: 700,
  }),

  audio: Object.freeze({
    // MASTER-SPEC §7.8: initial audio upload limit, 25 MB.
    maxBytes: 25 * MiB,
    // MASTER-SPEC §7.4 and report 06 §8: FLAC 16 kHz mono.
    sampleRate: 16_000,
    // MASTER-SPEC §7.4 and report 06 §3.3: 600 s chunks (18.5 MB measured, under Groq's 25 MB).
    chunkSeconds: 600,
    // MASTER-SPEC §7.4 and report 06 §3.3: 5 s overlap.
    overlapSeconds: 5,
    // report 06 §3.2: Groq bills 10 s minimum per request; a shorter last chunk is
    // absorbed into the previous one (report 06 §3.3, merge rule).
    minChunkSeconds: 10,
    // report 06 §3.2: Groq file cap, 25 MB (designed for 25 MB, report 06 §7).
    maxChunkBytes: 25 * MiB,
    // MASTER-SPEC §7.4: language=es.
    language: 'es',
    // report 06 §3.2: the Whisper prompt carries vocabulary only (areas, products, people)
    // and never instructions. Empty: no prompt is sent.
    vocabulary: '',
    // MASTER-SPEC §7.4 and report 06 §3.2: 7,200 s of audio per hour for the whole team.
    budgetSecondsPerHour: 7_200,
    // Budget window: «per hour» (report 06 §3.2). Sliding window, the most conservative
    // reading of «per hour»; Groq does not document how it counts.
    budgetWindowMs: 3_600_000,
    // Declared courtesy: a 20-minute video produces 3 chunks (report 06, computed with
    // 600 s and 5 s) and Groq's 20 req/min (report 06 §3.2) is nowhere near. Not measured
    // against the real provider; the bench (MASTER-SPEC §7.11) sets it.
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
    maxUnitWords: 40, // declared courtesy, measurement 2026-10-20 (see above)
  }),

  video: Object.freeze({
    // MASTER-SPEC §7.4: 20-minute cap.
    maxSeconds: 20 * 60,
    // MASTER-SPEC §7.4 and report 06 §8: 2 GB cap.
    maxBytes: 2 * GiB,
    // report 06 §8, `frameSampleSeconds`: 1 frame per second.
    frameSampleSeconds: 1,
    // report 06 §8, `frameHashDistance`: 64-bit dHash, kept if the distance to the
    // last kept frame exceeds 6 (last value with no loss of screens, report 06 §2.5).
    frameHashDistance: 6,
    // report 06 §8, `maxFrames`: 48 × 1,456 = 69,888 tokens, under the 100,000 step.
    maxFrames: 48,
    // report 06 §8, `frameWidth`: 720 px wide.
    frameWidth: 720,
    // report 06 §8: JPEG quality 4 (`-q:v 4`), 60 KB and 1,456 tokens per frame.
    frameQuality: 4,
    // report 06 §8, `sceneThreshold`: off. There is no knob: scene change was discarded
    // as the main sampling (report 06 §2.3, covers 8 of 16 screens at 0.20).
    // Per-frame description prompt. Instruction to the model.
    prompt:
      'You receive frames of a video in chronological order, each labeled «Fotograma N». ' +
      'For each frame, describe what is visible that is actionable for a software team: screen or ' +
      'component, state, visible text transcribed verbatim, errors, and what changed compared to ' +
      'the previous frame. Answer with one item per frame, with the same number. Write the ' +
      'descriptions in Spanish.',
  }),

  link: Object.freeze({
    // 5 MiB (Readability with linkedom: 388 ms and 301 MB at 5.2 MiB; at 10.5 MiB the
    // output changes shape), report 05 §8.3.
    maxBytes: 5 * MiB,
    // report 05 §8.3: declared courtesy, no measurement.
    timeoutMs: 15_000,
    // report 05 §8.3: 0 automatic redirects; each hop is requested and revalidated, with 5 as
    // the maximum (declared courtesy).
    maxRedirects: 5,
    // Private names or addresses exempt from the SSRF block. Empty by default; it exists for the
    // test environment and for a host that serves documents from its internal network.
    allowedPrivateHosts: Object.freeze([]),
  }),
});

function mergeSection(base, over) {
  return Object.freeze({ ...base, ...(over ?? {}) });
}

/** Merges the given knobs over the defaults, section by section. */
export function resolveConfig(overrides = {}) {
  const out = {};
  for (const section of Object.keys(DEFAULTS)) out[section] = mergeSection(DEFAULTS[section], overrides[section]);
  for (const section of Object.keys(overrides)) {
    if (section !== 'workDir' && !(section in DEFAULTS)) throw new Error(`unknown knob: ${section}`);
  }
  // `workDir`: working directory for intermediate files (frames, audio chunks).
  // Default: the system temp directory.
  out.workDir = overrides.workDir ?? null;
  return Object.freeze(out);
}
