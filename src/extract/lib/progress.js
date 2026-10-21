// Progress per real step (MASTER-SPEC §7.10): the percentage comes from completed steps over
// total steps, never from a clock. It never goes down and does not repeat an identical notice.

export function createProgress(onProgress, total) {
  let done = 0;
  let lastPercent = -1;
  let lastPhrase = null;

  function emit(phrase) {
    const percent = total > 0 ? Math.min(100, Math.floor((100 * done) / total)) : 0;
    const shown = Math.max(percent, lastPercent);
    if (shown === lastPercent && phrase === lastPhrase) return;
    lastPercent = shown;
    lastPhrase = phrase;
    if (typeof onProgress !== 'function') return;
    try {
      onProgress(shown, phrase);
    } catch {
      // A notifier that fails (for example, a closed SSE stream) must not kill the extraction.
    }
  }

  return {
    /** Announces the phrase of the step in progress without completing any. */
    report(phrase) {
      emit(phrase);
    },
    /** Completes a step and announces it. */
    advance(phrase) {
      done = Math.min(total, done + 1);
      emit(phrase);
    },
    setTotal(n) {
      total = n;
    },
    /** Closes at 100 %. */
    finish(phrase = 'Listo') {
      done = total;
      emit(phrase);
    },
  };
}
