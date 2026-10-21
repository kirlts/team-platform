// Joins transcription segments into sentence-sized units (MASTER-SPEC §7.4).
// The speech provider cuts at short phrases (1 to 5 s: "Eso.", "pues cachai"), not at sentences.
// Consecutive segments are joined while the previous one does not close a sentence and the pause
// between them is below the threshold. Only the final punctuation the provider wrote and the
// timings are read; the meaning of the text is never looked at.

// Closes a sentence: full stop, question mark, exclamation mark or ellipsis, optionally followed by closing quotes or brackets.
const SENTENCE_END = /[.?!…]["'”’»)\]]*\s*$/u;

/** `true` when the text ends in sentence-final punctuation. */
export function endsSentence(text) {
  return SENTENCE_END.test(text);
}

function countWords(text) {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Joins consecutive segments into one when the previous one does not end a sentence, the pause between
 * them (`start` of the next minus `end` of the previous) is below `pauseSeconds`, and both come from the
 * same audio chunk (a chunk boundary was already resolved by the overlap logic and is never crossed).
 * The joined segment keeps the `start` of the first and the `end` of the last. A `pauseSeconds` of 0 or
 * less joins nothing. Run-on speech with no punctuation and no pause does not grow without limit: when
 * adding the next segment would pass `maxWords` words, that segment opens a new unit (a single segment
 * longer than the cap stays whole; segments are never split). With an infinite `maxWords` there is no cap.
 *
 * @param {{start:number,end:number,text:string,chunk?:number}[]} segments sorted by `start`
 * @param {number} pauseSeconds
 * @param {number} [maxWords]
 */
export function joinSegments(segments, pauseSeconds, maxWords = Number.POSITIVE_INFINITY) {
  const out = [];
  for (const seg of segments) {
    const prev = out.at(-1);
    const sameChunk = prev && prev.chunk === seg.chunk;
    const fits = sameChunk && countWords(prev.text) + countWords(seg.text) <= maxWords;
    if (sameChunk && fits && !endsSentence(prev.text) && seg.start - prev.end < pauseSeconds) {
      prev.end = seg.end;
      prev.text = `${prev.text} ${seg.text}`;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}
