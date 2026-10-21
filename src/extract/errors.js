// Error de extracción con un código estable en inglés y un motivo legible en español.
// El motivo es lo que el panel muestra cuando un adjunto no se puede leer.

export class ExtractError extends Error {
  /**
   * @param {string} code identificador estable (p. ej. `image_heic_unsupported`)
   * @param {string} message motivo para la persona, en español
   * @param {object} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExtractError';
    this.code = code;
    this.details = details;
  }
}
