// Rutas de miembros (MASTER-SPEC §7.1, UD-007). Un miembro edita sólo su descripción y dominios; el editor
// da de alta y administra a los demás. Cambiar el rol o la contraseña cierra las sesiones de esa persona
// (la sesión se regenera al cambiar de privilegio, informe 04 §2.2).

import { get, run, tx } from '../../db/index.js'
import { badRequest, conflict, unauthenticated } from '../../domain/errors.js'
import { createMember, getMember, listMembers, updateMember } from '../../domain/members.js'
import { hashPassword, validatePassword, verifyPassword } from '../../identity/password.js'
import { idParams, member } from '../schemas.js'

const correo = { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^@\\s]+@[^@\\s]+$' } // 254: largo máximo de una dirección (RFC 5321)

export function registerMemberRoutes (app, ctx) {
  const { db, config, requireRole, identity, blocklist } = ctx
  const local = config.identity.provider === 'local'

  async function guardarClave (memberId, password) {
    if (!local) throw conflict('La contraseña la administra el sitio anfitrión.', 'password_managed_externally')
    validatePassword(password, config.identity.password, blocklist)
    const hash = await hashPassword(password, config.identity.argon2)
    run(db, `INSERT INTO credentials (member_id, password_hash, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(member_id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at, failed_count = 0, next_attempt_at = 0`,
    memberId, hash, Date.now())
  }

  app.get('/members', { onRequest: [requireRole('member')], schema: { response: { 200: { type: 'array', items: member } } } },
    async () => listMembers(db))

  // Alta: sólo la hace un editor; ningún modo de identidad crea miembros por su cuenta (UD-007).
  app.post('/members', {
    onRequest: [requireRole('editor')],
    schema: {
      body: {
        type: 'object', required: ['email', 'name'], additionalProperties: false,
        properties: {
          email: correo, name: { type: 'string', minLength: 1 }, role: { type: 'string', enum: ['member', 'editor'] },
          responsibilities: { type: 'string' }, domains: { type: 'string' }, password: { type: 'string' }
        }
      },
      response: { 201: member }
    }
  }, async (request, reply) => {
    const { password, ...datos } = request.body
    if (password !== undefined) {
      validatePassword(password, config.identity.password, blocklist) // se valida antes de crear
      if (!local) throw conflict('La contraseña la administra el sitio anfitrión.', 'password_managed_externally')
    }
    const hash = password !== undefined ? await hashPassword(password, config.identity.argon2) : null
    const id = tx(db, () => {
      const nuevo = createMember(db, datos)
      if (hash) run(db, 'INSERT INTO credentials (member_id, password_hash, updated_at) VALUES (?, ?, ?)', nuevo, hash, Date.now())
      return nuevo
    })
    reply.code(201)
    return getMember(db, id)
  })

  // El propio miembro: descripción, dominios y, con la contraseña actual, la contraseña.
  app.patch('/members/me', {
    onRequest: [requireRole('member')],
    schema: {
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { responsibilities: { type: 'string' }, domains: { type: 'string' }, current_password: { type: 'string' }, new_password: { type: 'string' } }
      },
      response: { 200: member }
    }
  }, async (request) => {
    const { current_password: actual, new_password: nueva, ...perfil } = request.body
    if ((actual === undefined) !== (nueva === undefined)) throw badRequest('Para cambiar la contraseña se envían la actual y la nueva.', 'password_pair_required')
    if (nueva !== undefined) {
      if (!local) throw conflict('La contraseña la administra el sitio anfitrión.', 'password_managed_externally')
      const cred = get(db, 'SELECT password_hash FROM credentials WHERE member_id = ?', request.member.id)
      const { ok } = cred ? await verifyPassword(actual, cred.password_hash, config.identity.argon2) : { ok: false }
      if (!ok) throw unauthenticated('La contraseña actual no es correcta.')
      await guardarClave(request.member.id, nueva)
      identity.sessions.destroyForMember(request.member.id, request.member.token) // cierra las demás sesiones
    }
    if (Object.keys(perfil).length > 0) updateMember(db, request.member.id, perfil)
    return getMember(db, request.member.id)
  })

  app.patch('/members/:id', {
    onRequest: [requireRole('editor')],
    schema: {
      params: idParams(),
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1 }, email: correo, role: { type: 'string', enum: ['member', 'editor'] },
          responsibilities: { type: 'string' }, domains: { type: 'string' }, password: { type: 'string' }
        }
      },
      response: { 200: member }
    }
  }, async (request) => {
    const { password, ...cambios } = request.body
    const id = request.params.id
    if (password !== undefined) {
      await guardarClave(id, password) // también reinicia el contador de intentos fallidos
      identity.sessions.destroyForMember(id)
    }
    const { member: actualizado, roleChanged } = updateMember(db, id, cambios)
    if (roleChanged) identity.sessions.destroyForMember(id) // regenerar al cambiar de rol
    return actualizado
  })
}
