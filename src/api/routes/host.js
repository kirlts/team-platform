// Host routes (UD-301): what the site that hosts Team Platform asks about one of its people, with the signed token of that person.
// Read only, and only what belongs to the member of the token. The host's console shows the same bell the panel shows (UD-028, UD-041)
// without opening the panel, and learns from the same call whether the person has an account here.
//
// The identity is the host's token and nothing else, and it is read WITHOUT entering the person: an unknown email is not created
// (404 `member_not_registered`, even with IDENTITY_PROVISION=host), a role is not applied, a deactivated member is 403 `account_inactive`
// and no session of our own is issued. Entering is what the panel does, with the same token, when the person opens it.

import { unauthenticated } from '../../domain/errors.js'
import { iso } from '../../db/util.js'
import { messageSummary } from '../../domain/messages.js'

// declared courtesy: the host console lists the latest five notices; it is a display size, not a measurement, and the panel's own list is the full one (UD-301)
const NOTICE_LIMIT_DEFAULT = 5
// declared courtesy: ceiling of that display size, so the question never returns the whole summary (UD-301)
const NOTICE_LIMIT_MAX = 20

export function registerHostRoutes (app, ctx) {
  const { db, identity } = ctx

  app.get('/host/notices', {
    // Public for the policy table: the identity hook of `requireRole` would provision the member, and this route must not.
    config: { public: true },
    schema: {
      summary: 'The notices of the member of a host token (host site)',
      description: 'Los avisos que afectan a la persona del token del anfitrión: los mensajes abiertos y respondidos que la afectan (UD-028), con sus conteos y los últimos `limit`, el abierto antes que el respondido y dentro de cada estado el más reciente. Cada ítem trae `path`, la dirección del mensaje en el panel. Sólo lectura, y nunca crea la cuenta: 401 sin token válido, 404 `member_not_registered` si el correo no es de un miembro, 403 `account_inactive` si está desactivado.',
      querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: NOTICE_LIMIT_MAX } } },
      response: {
        200: {
          type: 'object',
          properties: {
            member: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' }, role: { type: 'string' } } },
            counts: { type: 'object', properties: { open: { type: 'integer' }, answered: { type: 'integer' }, total: { type: 'integer' } } },
            items: { type: 'array', items: { type: 'object', properties: { message_id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', enum: ['open', 'answered'] }, at: { type: 'string' }, path: { type: 'string' } } } }
          }
        }
      }
    }
  }, async (request) => {
    const found = await identity.provider.identifyExisting(request)
    if (!found) throw unauthenticated('Se requiere el token firmado del anfitrión.')
    const { mine, items } = messageSummary(db, found.member_id)
    const limit = request.query.limit ?? NOTICE_LIMIT_DEFAULT
    return {
      member: { id: String(found.member_id), name: found.name, email: found.email, role: found.role },
      counts: mine,
      items: items.slice(0, limit).map((i) => ({ ...i, at: iso(i.at), path: `/messages/${i.message_id}` }))
    }
  })
}
