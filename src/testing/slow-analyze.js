// Analizador doble para la prueba de apagado del proceso: no termina hasta que lo abortan.
export const analyze = (bundle, { signal }) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason ?? new Error('abortado')))
})
