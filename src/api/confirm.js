// Toda operación destructiva exige `?confirm=true`: sin eso responde 400 y no hace nada.
import { badRequest } from '../domain/errors.js'

export function requireConfirm (request) {
  if (request.query.confirm !== true) {
    throw badRequest('La operación es destructiva y exige confirm=true en la dirección.', 'confirm_required')
  }
}
