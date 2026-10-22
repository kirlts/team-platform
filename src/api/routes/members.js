// Member routes (MASTER-SPEC §7.1, UD-007). A member edits only their own profile (UD-023); the editor
// creates and administers the rest. Changing the role or the password closes that person's sessions
// (the session is regenerated on a privilege change, report 04 §2.2). The editor also deletes a member for good (UD-240).

import { get, run, tx } from '../../db/index.js'
import { badRequest, conflict, unauthenticated } from '../../domain/errors.js'
import { audit } from '../../domain/audit.js'
import { LANGUAGES } from '../../domain/language.js'
import { createMember, deleteMember, getMember, listMembers, updateMember } from '../../domain/members.js'
import { removeUnreferencedBlobs } from '../../domain/storage.js'
import { requireConfirm } from '../confirm.js'
import { hashPassword, validatePassword, verifyPassword } from '../../identity/password.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'
import { idParams, member } from '../schemas.js'

const emailAddr = { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^@\\s]+@[^@\\s]+$' } // 254: maximum length of an address (RFC 5321)
const languageTag = { type: 'string', enum: LANGUAGES } // UD-018: exactly two values; anything else is 400 'validation'

export function registerMemberRoutes (app, ctx) {
  const { db, config, requireRole, identity, blocklist, queue } = ctx
  const profileText = { type: 'string', maxLength: config.members.profileMaxLength, description: 'Perfil: un par de párrafos en primera persona (UD-023).' }
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
    schema: { summary: 'Team members', querystring: { type: 'object', additionalProperties: false, properties: pageQuerySchema(config) }, response: { 200: pageEnvelope(member) } }
  }, async (request) => {
    const p = pageParams(request.query, config)
    const everyone = listMembers(db)
    return pageResult(everyone.slice(p.offset, p.offset + p.limit), everyone.length, p)
  })

  // Creation: only an editor does it; no identity mode creates members on its own (UD-007).
  app.post('/members', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Add a member (editor)',
      body: {
        type: 'object', required: ['email', 'name'], additionalProperties: false,
        properties: {
          email: emailAddr, name: { type: 'string', minLength: 1 }, role: { type: 'string', enum: ['member', 'editor'] },
          profile: profileText, password: { type: 'string' }
        }
      },
      response: { 201: member }
    }
  }, async (request, reply) => {
    const { password, ...memberData } = request.body
    if (password !== undefined) {
      validatePassword(password, config.identity.password, blocklist) // validated before creating
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

  // The member themselves: profile, language and, with the current password, the password.
  app.patch('/members/me', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Editar lo propio: perfil, idioma de salida y contraseña',
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { profile: profileText, language: languageTag, current_password: { type: 'string' }, new_password: { type: 'string' } }
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
      identity.sessions.destroyForMember(request.member.id, request.member.token) // closes the other sessions
    }
    if (Object.keys(profile).length > 0) updateMember(db, request.member.id, profile, { actorId: request.member.id })
    return getMember(db, request.member.id)
  })

  app.patch('/members/:id', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Editar un miembro, o desactivarlo y reactivarlo con `active` (editor). El perfil no se edita aquí: cada miembro edita el suyo con `PATCH /members/me` (UD-023)',
      params: idParams(),
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1 }, email: emailAddr, role: { type: 'string', enum: ['member', 'editor'] },
          password: { type: 'string' },
          active: { type: 'boolean', description: 'false desactiva la cuenta (no puede iniciar sesión y conserva su historial); true la reactiva.' }
        }
      },
      response: { 200: member }
    }
  }, async (request) => {
    const { password, ...edits } = request.body
    const id = request.params.id
    if (password !== undefined) {
      await savePassword(id, password, request.member.id) // also resets the failed-attempts counter
      identity.sessions.destroyForMember(id)
    }
    const { member: updatedMember, roleChanged, deactivated } = updateMember(db, id, edits, { actorId: request.member.id })
    if (roleChanged || deactivated) identity.sessions.destroyForMember(id) // regenerate on role change; close everything on deactivation
    return updatedMember
  })

  // Deletion for good (UD-240). A member without history goes with their credentials, sessions and identity links; one
  // with history is a 409 `member_has_history` with the counts, and goes with everything of theirs under `purge=true`.
  app.delete('/members/:id', {
    onRequest: [requireRole('editor')],
    schema: {
      summary: 'Eliminar un miembro (editor; exige ?confirm=true). Con historial responde 409 `member_has_history` salvo `purge=true`, que borra también sus envíos, mensajes y respuestas',
      params: idParams(),
      querystring: { type: 'object', additionalProperties: false, properties: { confirm: { type: 'boolean' }, purge: { type: 'boolean' } } },
      response: {
        200: {
          type: 'object',
          required: ['member_id', 'deleted'],
          properties: {
            member_id: { type: 'string' },
            deleted: { type: 'object', required: ['inputs', 'messages', 'replies'], properties: { inputs: { type: 'integer' }, messages: { type: 'integer' }, replies: { type: 'integer' } } }
          }
        }
      }
    }
  }, async (request) => {
    requireConfirm(request)
    const id = request.params.id
    const { member_id: memberId, deleted, sha256s } = deleteMember(db, id, { actorId: request.member.id, purge: request.query.purge === true, queue })
    identity.sessions.destroyForMember(id) // the rows went with the member; the call keeps the contract explicit
    try { await removeUnreferencedBlobs(db, config, sha256s) } catch (e) { app.log.warn({ err: e }, 'could not free the files of a deleted member') }
    return { member_id: memberId, deleted }
  })
}
