// Rutas de miembros (MASTER-SPEC §7.1, UD-007). Un miembro edita sólo su descripción y dominios; el editor
// da de alta y administra a los demás. Cambiar el rol o la contraseña cierra las sesiones de esa persona
// (la sesión se regenera al cambiar de privilegio, informe 04 §2.2).

import { get, run, tx } from '../../db/index.js'
import { badRequest, conflict, unauthenticated } from '../../domain/errors.js'
import { audit } from '../../domain/audit.js'
import { LANGUAGES } from '../../domain/language.js'
import { createMember, getMember, listMembers, updateMember } from '../../domain/members.js'
import { hashPassword, validatePassword, verifyPassword } from '../../identity/password.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'
import { idParams, member } from '../schemas.js'

const emailAddr = { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^@\\s]+@[^@\\s]+$' } // 254: largo máximo de una dirección (RFC 5321)
const domainList = { type: 'array', items: { type: 'string' } }
const languageTag = { type: 'string', enum: LANGUAGES } // UD-018: exactly two values; anything else is 400 'validation'

export function registerMemberRoutes (app, ctx) {
  const { db, config, requireRole, identity, blocklist } = ctx
  const local = config.identity.provider === 'local'

  async function savePassword (memberId, password, actorId) {
    if (!local) throw conflict('La contraseña la administra el sitio anfitrión.', 'password_managed_externally')
    validatePassword(password, config.identity.password, blocklist)
    const hash = await hashPassword(password, config.identity.argon2)
    run(db, `INSERT INTO credentials (member_id, password_hash, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(member_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at, failed_count = 0, next_attempt_at = 0`,
    memberId, hash, Date.now())
    audit(db, { memberId: actorId, action: 'member.password', entity: 'member', entityId: memberId })
  }

  app.get('/members', {
    onRequest: [requireRole('member')],
    schema: { summary: 'Miembros del equipo', querystring: { type: 'object', additionalProperties: false, properties: pageQuerySchema(config) }, response: { 200: pageEnvelope(member) } }
  }, async (request) => {
    const p = pageParams(request.query, config)
    const everyone = listMembers(db)
    return pageResult(everyone.slice(p.offset, p.offset + p.limit), everyone.length, p)
  })

  // Alta: sólo la hace un editor; ningún modo de identidad crea miembros por su cuenta (UD-007).
  app.post('/members', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Dar de alta un miembro (editor)',
      body: {
        type: 'object', required: ['email', 'name'], additionalProperties: false,
        properties: {
          email: emailAddr, name: { type: 'string', minLength: 1 }, role: { type: 'string', enum: ['member', 'editor'] },
          responsibilities: { type: 'string' }, domains: domainList, password: { type: 'string' }
        }
      },
      response: { 201: member }
    }
  }, async (request, reply) => {
    const { password, ...memberData } = request.body
    if (password !== undefined) {
      validatePassword(password, config.identity.password, blocklist) // se valida antes de crear
      if (!local) throw conflict('La contraseña la administra el sitio anfitrión.', 'password_managed_externally')
    }
    const hash = password !== undefined ? await hashPassword(password, config.identity.argon2) : null
    const id = tx(db, () => {
      const fresh = createMember(db, memberData, { actorId: request.member.id })
      if (hash) run(db, 'INSERT INTO credentials (member_id, password_hash, updated_at) VALUES (?, ?, ?)', fresh, hash, Date.now())
      return fresh
    })
    reply.code(201)
    return getMember(db, id)
  })

  // El propio miembro: descripción, dominios y, con la contraseña actual, la contraseña.
  app.patch('/members/me', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Editar lo propio: descripción, dominios, idioma de salida y contraseña',
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { responsibilities: { type: 'string' }, domains: domainList, language: languageTag, current_password: { type: 'string' }, new_password: { type: 'string' } }
      },
      response: { 200: member }
    }
  }, async (request) => {
    const { current_password: current, new_password: newValue, ...profile } = request.body
    if ((current === undefined) !== (newValue === undefined)) throw badRequest('Para cambiar la contraseña se envían la actual y la nueva.', 'password_pair_required')
    if (newValue !== undefined) {
      if (!local) throw conflict('La contraseña la administra el sitio anfitrión.', 'password_managed_externally')
      const cred = get(db, 'SELECT password_hash FROM credentials WHERE member_id = ?', request.member.id)
      const { ok } = cred ? await verifyPassword(current, cred.password_hash, config.identity.argon2) : { ok: false }
      if (!ok) throw unauthenticated('La contraseña actual no es correcta.')
      await savePassword(request.member.id, newValue, request.member.id)
      identity.sessions.destroyForMember(request.member.id, request.member.token) // cierra las demás sesiones
    }
    if (Object.keys(profile).length > 0) updateMember(db, request.member.id, profile, { actorId: request.member.id })
    return getMember(db, request.member.id)
  })

  app.patch('/members/:id', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Editar un miembro (editor)',
      params: idParams(),
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1 }, email: emailAddr, role: { type: 'string', enum: ['member', 'editor'] },
          responsibilities: { type: 'string' }, domains: domainList, password: { type: 'string' }
        }
      },
      response: { 200: member }
    }
  }, async (request) => {
    const { password, ...edits } = request.body
    const id = request.params.id
    if (password !== undefined) {
      await savePassword(id, password, request.member.id) // también reinicia el contador de intentos fallidos
      identity.sessions.destroyForMember(id)
    }
    const { member: updatedMember, roleChanged } = updateMember(db, id, edits, { actorId: request.member.id })
    if (roleChanged) identity.sessions.destroyForMember(id) // regenerar al cambiar de rol
    return updatedMember
  })
}
