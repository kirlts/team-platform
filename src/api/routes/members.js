// Member routes (MASTER-SPEC §7.1, UD-007). A member edits only their own description and domains; the editor
// adds and manages the others. Changing the role or the password closes that person's sessions
// (the session is regenerated on a privilege change, report 04 §2.2).

import { get, run, tx } from '../../db/index.js'
import { badRequest, conflict, unauthenticated } from '../../domain/errors.js'
import { audit } from '../../domain/audit.js'
import { createMember, getMember, listMembers, updateMember } from '../../domain/members.js'
import { hashPassword, validatePassword, verifyPassword } from '../../identity/password.js'
import { pageEnvelope, pageParams, pageQuerySchema, pageResult } from '../pagination.js'
import { idParams, member } from '../schemas.js'

const emailAddr = { type: 'string', minLength: 3, maxLength: 254, pattern: '^[^@\\s]+@[^@\\s]+$' } // 254: maximum length of an address (RFC 5321)
const domainList = { type: 'array', items: { type: 'string' } }

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
          responsibilities: { type: 'string' }, domains: domainList, password: { type: 'string' }
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

  // The member themself: description, domains and, with the current password, the password.
  app.patch('/members/me', {
    onRequest: [requireRole('member')],
    schema: {
      summary: 'Edit one\'s own data: description, domains and password',
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { responsibilities: { type: 'string' }, domains: domainList, current_password: { type: 'string' }, new_password: { type: 'string' } }
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
      summary: 'Edit a member (editor)',
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
      await savePassword(id, password, request.member.id) // also resets the failed-attempts counter
      identity.sessions.destroyForMember(id)
    }
    const { member: updatedMember, roleChanged } = updateMember(db, id, edits, { actorId: request.member.id })
    if (roleChanged) identity.sessions.destroyForMember(id) // regenerate on a role change
    return updatedMember
  })
}
