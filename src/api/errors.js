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

const LABELS = {
  required: (e) => `Falta el campo «${e.params.missingProperty}».`,
  type: (e, fieldName) => `El campo «${fieldName}» tiene un tipo inválido (se esperaba ${e.params.type}).`,
  enum: (e, fieldName) => `El campo «${fieldName}» debe ser uno de: ${e.params.allowedValues.join(', ')}.`,
  minLength: (e, fieldName) => `El campo «${fieldName}» no puede estar vacío.`,
  maxLength: (e, fieldName) => `El campo «${fieldName}» supera el largo máximo (${e.params.limit}).`,
  minimum: (e, fieldName) => `El campo «${fieldName}» debe ser mayor o igual a ${e.params.limit}.`,
  maximum: (e, fieldName) => `El campo «${fieldName}» debe ser menor o igual a ${e.params.limit}.`,
  additionalProperties: (e) => `El campo «${e.params.additionalProperty}» no existe.`,
  pattern: (e, fieldName) => `El campo «${fieldName}» no tiene el formato esperado.`,
  minItems: (e, fieldName) => `El campo «${fieldName}» necesita al menos ${e.params.limit} elemento(s).`
}

/** `schemaErrorFormatter` de Fastify: de los errores de Ajv a un 400 con mensaje en español. */
export function schemaErrorFormatter (errors, dataVar) {
  const firstEditor = errors[0]
  const fieldName = (firstEditor.instancePath || '').replace(/^\//, '').replaceAll('/', '.') || dataVar
  const msgRow = (LABELS[firstEditor.keyword] ?? (() => `El campo «${fieldName}» no es válido.`))(firstEditor, fieldName)
  return new AppError(400, 'validation', msgRow)
}

export function installErrorHandler (app) {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.extra?.retryAfterSeconds) reply.header('retry-after', String(error.extra.retryAfterSeconds))
      return reply.code(error.status).send({ code: error.code, message: error.message, ...error.extra })
    }
    const knownCode = MULTIPART[error.code]
    if (knownCode) {
      reply.header('connection', 'close') // el cuerpo restante no se va a leer
      return reply.code(knownCode[0]).send({ code: knownCode[1], message: knownCode[2] })
    }
    if (error.validation) {
      return reply.code(400).send({ code: 'validation', message: 'Datos inválidos.' })
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ code: 'bad_request', message: 'Petición inválida.' })
    }
    request.log.error({ err: error }, 'error no controlado')
    if (process.env.TEAM_DEBUG_ERRORS) console.error(error.stack) // ayuda de desarrollo: las pruebas corren con el registro apagado
    return reply.code(500).send({ code: 'internal', message: 'Error interno del servidor.' })
  })
}
