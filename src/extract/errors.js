// Extraction error with a stable code in English and a readable reason in Spanish.
// The reason is what the panel shows when an attachment cannot be read.

export class ExtractError extends Error {
  /**
   * @param {string} code stable identifier (e.g. `image_heic_unreadable`)
   * @param {string} message reason for the person, in Spanish
   * @param {object} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExtractError';
    this.code = code;
    this.details = details;
  }
}
