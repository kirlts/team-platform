// Domain errors. The API translates them to { code, message } with the given HTTP status.
// Messages are in Spanish because a person reads them (UD-005).

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
export const conflict = (message, code = 'conflict', extra) => new AppError(409, code, message, extra)
export const tooLarge = (message) => new AppError(413, 'too_large', message)
export const unsupported = (message) => new AppError(415, 'unsupported_media_type', message)
export const unprocessable = (message, code = 'invalid_value', extra) => new AppError(422, code, message, extra)
export const tooMany = (message, retryAfterSeconds) => new AppError(429, 'too_many_requests', message, { retryAfterSeconds })

/** Marks a job error as final: the queue does not retry it (contracts.md). */
export function permanent (message, code = null) {
  const error = new Error(message)
  error.retryable = false
  if (code) error.code = code
  return error
}
