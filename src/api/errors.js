// Traducción de errores a la forma de la API: { code, message, ...extra }. Los mensajes van en español.

import { AppError } from '../domain/errors.js'

const MULTIPART = {
  FST_REQ_FILE_TOO_LARGE: [413, 'file_too_large', 'Un archivo supera el tamaño máximo permitido.'],
  FST_FILES_LIMIT: [413, 'too_many_files', 'Se superó la cantidad máxima de archivos por envío.'],
  FST_PARTS_LIMIT: [413, 'too_many_parts', 'El envío tiene demasiadas partes.'],
  FST_FIELDS_LIMIT: [413, 'too_many_fields', 'El envío tiene demasiados campos.'],
  FST_INVALID_MULTIPART_CONTENT_TYPE: [415, 'unsupported_media_type', 'Se esperaba un envío multipart/form-data.'],
  FST_ERR_CTP_BODY_TOO_LARGE: [413, 'body_too_large', 'El cuerpo de la petición es demasiado grande.'],
  FST_ERR_CTP_INVALID_MEDIA_TYPE: [415, 'unsupported_media_type', 'Tipo de contenido no admitido.'],
  FST_ERR_CTP_EMPTY_JSON_BODY: [400, 'bad_request', 'Falta el cuerpo JSON de la petición.'],
  FST_ERR_CTP_INVALID_JSON_BODY: [400, 'bad_request', 'El cuerpo no es JSON válido.']
}

const ETIQUETAS = {
  required: (e) => `Falta el campo «${e.params.missingProperty}».`,
  type: (e, campo) => `El campo «${campo}» tiene un tipo inválido (se esperaba ${e.params.type}).`,
  enum: (e, campo) => `El campo «${campo}» debe ser uno de: ${e.params.allowedValues.join(', ')}.`,
  minLength: (e, campo) => `El campo «${campo}» no puede estar vacío.`,
  maxLength: (e, campo) => `El campo «${campo}» supera el largo máximo (${e.params.limit}).`,
  minimum: (e, campo) => `El campo «${campo}» debe ser mayor o igual a ${e.params.limit}.`,
  maximum: (e, campo) => `El campo «${campo}» debe ser menor o igual a ${e.params.limit}.`,
  additionalProperties: (e) => `El campo «${e.params.additionalProperty}» no existe.`,
  pattern: (e, campo) => `El campo «${campo}» no tiene el formato esperado.`,
  minItems: (e, campo) => `El campo «${campo}» necesita al menos ${e.params.limit} elemento(s).`
}

/** `schemaErrorFormatter` de Fastify: de los errores de Ajv a un 400 con mensaje en español. */
export function schemaErrorFormatter (errors, dataVar) {
  const primero = errors[0]
  const campo = (primero.instancePath || '').replace(/^\//, '').replaceAll('/', '.') || dataVar
  const mensaje = (ETIQUETAS[primero.keyword] ?? (() => `El campo «${campo}» no es válido.`))(primero, campo)
  return new AppError(400, 'validation', mensaje)
}

export function installErrorHandler (app) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.extra?.retryAfterSeconds) reply.header('retry-after', String(error.extra.retryAfterSeconds))
      return reply.code(error.status).send({ code: error.code, message: error.message, ...error.extra })
    }
    const conocido = MULTIPART[error.code]
    if (conocido) {
      reply.header('connection', 'close') // el cuerpo restante no se va a leer
      return reply.code(conocido[0]).send({ code: conocido[1], message: conocido[2] })
    }
    if (error.validation) {
      return reply.code(400).send({ code: 'validation', message: 'Datos inválidos.' })
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ code: 'bad_request', message: 'Petición inválida.' })
    }
    request.log.error({ err: error }, 'error no controlado')
    return reply.code(500).send({ code: 'internal', message: 'Error interno del servidor.' })
  })
}
