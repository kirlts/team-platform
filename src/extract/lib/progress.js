// Progress per real step (MASTER-SPEC §7.10): the percentage comes from completed steps over
// total steps, never from a clock. It never goes down and does not repeat an identical notice.

import { keyOf, phraseOf, step } from '../../domain/progress-phrases.js';

export function createProgress(onProgress, total) {
  let done = 0;
  let lastPercent = -1;
  let lastPhrase = null;

  // `phrase` is a step of the catalogue (H-3722) or, from an older caller, a text. The notifier receives the default text
  // and, third, the step with its stable code.
  function emit(phrase) {
    const percent = total > 0 ? Math.min(100, Math.floor((100 * done) / total)) : 0;
    const shown = Math.max(percent, lastPercent);
    if (shown === lastPercent && keyOf(phrase) === lastPhrase) return;
    lastPercent = shown;
    lastPhrase = keyOf(phrase);
    if (typeof onProgress !== 'function') return;
    try {
      onProgress(shown, phraseOf(phrase), typeof phrase === 'string' ? null : phrase);
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
    finish(phrase = step('done')) {
      done = total;
      emit(phrase);
    },
  };
}
