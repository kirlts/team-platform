// Every destructive operation requires `?confirm=true`: without it, it answers 400 and does nothing.
import { badRequest } from '../domain/errors.js'

export function requireConfirm (request) {
  if (request.query.confirm !== true) {
    throw badRequest('La operación es destructiva y exige confirm=true en la dirección.', 'confirm_required')
  }
}
