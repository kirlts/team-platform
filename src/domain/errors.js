// Errores de dominio. La API los traduce a { code, message } con el estado HTTP indicado.
// Los mensajes van en español porque los lee una persona (UD-005).

export class AppError extends Error {
  constructor (status, code, message, extra = {}) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.extra = extra
  }
}

export const badRequest = (message, code = 'bad_request', extra) => new AppError(400, code, message, extra)
export const unauthenticated = (message = 'Se requiere iniciar sesión.', extra) => new AppError(401, 'unauthenticated', message, extra)
export const forbidden = (message = 'Sin permiso para esta acción.', code = 'forbidden') => new AppError(403, code, message)
export const notFound = (message = 'No se encontró el recurso.') => new AppError(404, 'not_found', message)
export const conflict = (message, code = 'conflict') => new AppError(409, code, message)
export const tooLarge = (message) => new AppError(413, 'too_large', message)
export const unsupported = (message) => new AppError(415, 'unsupported_media_type', message)
export const unprocessable = (message, code = 'invalid_value', extra) => new AppError(422, code, message, extra)
export const tooMany = (message, retryAfterSeconds) => new AppError(429, 'too_many_requests', message, { retryAfterSeconds })

/** Marca un error de trabajo como definitivo: la cola no lo reintenta (contracts.md). */
export function permanent (message, code = null) {
  const error = new Error(message)
  error.retryable = false
  if (code) error.code = code
  return error
}
