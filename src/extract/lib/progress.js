// Progreso por paso real (MASTER-SPEC §7.10): el porcentaje sale de pasos completados sobre
// pasos totales, nunca de un reloj. Nunca baja y no repite un aviso idéntico.

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
      // Un avisador que falla (por ejemplo, un flujo SSE cerrado) no debe matar la extracción.
    }
  }

  return {
    /** Avisa la frase del paso en curso sin completar ninguno. */
    report(phrase) {
      emit(phrase);
    },
    /** Completa un paso y avisa. */
    advance(phrase) {
      done = Math.min(total, done + 1);
      emit(phrase);
    },
    setTotal(n) {
      total = n;
    },
    /** Cierra en 100 %. */
    finish(phrase = 'listo') {
      done = total;
      emit(phrase);
    },
  };
}
