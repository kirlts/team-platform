// scripts/team.mjs against a listening test server: the four commands an unattended session uses, signed with the
// credential of its agent member (UD-255, H-3724).
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { run } from '../src/db/index.js'
import { addMember, login, makeEnv } from '../src/testing/helpers.js'
import { HELP, helpText, runTeam } from './team.mjs'

const TEAM = fileURLToPath(new URL('./team.mjs', import.meta.url))
const PORT = 8642 // the range given to this work (8640 to 8649)

describe('team command', () => {
  let env, agent, messageId, jobId
  const team = (args, extra = {}) => promisify(execFile)('node', [TEAM, ...args], {
    env: { ...process.env, TEAM_URL: `http://127.0.0.1:${PORT}`, TEAM_AGENT_EMAIL: agent.email, TEAM_AGENT_SECRET: agent.agent_secret, ...extra }
  }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }))

  before(async () => {
    env = await makeEnv()
    await addMember(env, { email: 'ed@x.org', role: 'editor' })
    const editor = await login(env, 'ed@x.org')
    agent = (await env.app.inject({ method: 'POST', url: '/api/members', headers: { cookie: editor, 'x-team-request': 'panel' }, payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent' } })).json()
    const authorId = await addMember(env, { email: 'ana@x.org', name: 'Ana' })
    const area = env.db.prepare('SELECT id FROM areas ORDER BY id LIMIT 1').get().id
    const t = Date.now()
    messageId = Number(run(env.db, "INSERT INTO messages (area_id, author_id, title, body, fields_json, status, created_at, updated_at) VALUES (?, ?, 'Pantalla en blanco', 'Queda en blanco.', '{}', 'open', ?, ?)", area, authorId, t, t).lastInsertRowid)
    jobId = env.queue.enqueue('execute', { message_id: messageId, member_id: Number(agent.id) }, { messageId })
    env.queue.claim('test-worker')
    await env.app.listen({ host: '127.0.0.1', port: PORT })
  })
  after(() => env.close())

  it('--help prints the usage the prompt carries', async () => {
    const r = await team(['--help'])
    assert.equal(r.code, 0)
    assert.equal(r.stdout.trim(), HELP)
    for (const cmd of ['team show', 'team reply', 'team progress', 'team mark', 'team timing', 'team close']) assert.ok(HELP.includes(cmd))
  })

  it('show prints the message', async () => {
    const r = await team(['show', String(messageId)])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(JSON.parse(r.stdout).title, 'Pantalla en blanco')
  })

  it('reply adds a reply as the agent, with its kind', async () => {
    const r = await team(['reply', String(messageId), '--body', 'Recibido. Empiezo por la agenda.', '--kind', 'clarification'])
    assert.equal(r.code, 0, r.stderr)
    const reply = env.db.prepare('SELECT author_id, body, kind FROM replies WHERE message_id = ?').get(messageId)
    assert.deepEqual({ ...reply }, { author_id: Number(agent.id), body: 'Recibido. Empiezo por la agenda.', kind: 'clarification' })
  })

  it('mark adds the time of a part of the job and delivery says whether it arrived', async () => {
    assert.equal((await team(['mark', 'judge', '--ms', '4000'], { TEAM_JOB_ID: String(jobId) })).code, 0)
    assert.equal((await team(['mark', 'judge', '--ms', '1000'], { TEAM_JOB_ID: String(jobId) })).code, 0)
    const r = await team(['mark', 'delivery', '--ms', '9000', '--ok', 'false'], { TEAM_JOB_ID: String(jobId) })
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(JSON.parse(env.queue.getJob(jobId).marks_json), { judge_ms: 5000, delivery_ms: 9000, delivered: 0 })
    const refused = await team(['mark', 'coffee', '--ms', '5'], { TEAM_JOB_ID: String(jobId) })
    assert.equal(refused.code, 1)
    assert.match(refused.stderr, /team mark: use/)
  })

  it('timing prints the figures of the message without the span tree and asks the right path', async () => {
    let asked = null
    const fetchImpl = async (url) => { asked = String(url); return { ok: true, status: 200, text: async () => JSON.stringify({ message_id: '7', first_reply_ms: 1200, final_reply_ms: 9000, total_ms: 9500, tree: { name: 'execute' } }) } }
    const r = await runTeam(['timing', '7'], { TEAM_URL: 'http://x', TEAM_AGENT_EMAIL: 'a@x.org', TEAM_AGENT_SECRET: 's' }, fetchImpl)
    assert.equal(r.code, 0)
    assert.ok(asked.endsWith('/api/messages/7/timing'), asked)
    assert.deepEqual(JSON.parse(r.out), { message_id: '7', first_reply_ms: 1200, final_reply_ms: 9000, total_ms: 9500 })
    assert.equal((await runTeam(['timing'], { TEAM_URL: 'http://x', TEAM_AGENT_EMAIL: 'a@x.org', TEAM_AGENT_SECRET: 's' }, fetchImpl)).code, 1)
  })

  it('progress publishes an event of the job; the job id may come from TEAM_JOB_ID', async () => {
    assert.equal((await team(['progress', String(jobId), '--percent', '40', '--phrase', 'Revisión de estilos'])).code, 0)
    assert.equal((await team(['progress', '--percent', '50', '--phrase', 'Pruebas'], { TEAM_JOB_ID: String(jobId) })).code, 0)
    const phrases = env.db.prepare("SELECT percent, phrase FROM job_events WHERE job_id = ? AND kind = 'progress' ORDER BY seq").all(jobId).map((e) => `${e.percent} ${e.phrase}`)
    assert.deepEqual(phrases, ['40 Revisión de estilos', '50 Pruebas'])
  })

  it('close closes the message', async () => {
    const r = await team(['close', String(messageId)])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(env.db.prepare('SELECT status FROM messages WHERE id = ?').get(messageId).status, 'closed')
  })

  it('a wrong secret, a missing variable or a bad argument exits 1 with the reason', async () => {
    const bad = await team(['show', String(messageId)], { TEAM_AGENT_SECRET: 'otro' })
    assert.equal(bad.code, 1)
    assert.match(bad.stderr, /HTTP 401/)
    const missing = await team(['show', String(messageId)], { TEAM_URL: '' })
    assert.match(missing.stderr, /TEAM_URL/)
    const noBody = await team(['reply', String(messageId)])
    assert.match(noBody.stderr, /--body is required/)
    const unknown = await team(['dance'])
    assert.equal(unknown.code, 1)
  })
})

describe('the help depends on whether the host allows captures that show people', () => {
  it('says unmasked captures need the open zone by default, and not when the host allows them', async () => {
    assert.match(helpText(), /masked false needs --zone ninguna\./)
    assert.doesNotMatch(helpText({ unmasked: true }), /needs --zone/)
    assert.match(helpText({ unmasked: true }), /masked false is accepted as it is\./)
    const allowed = await runTeam(['--help'], { TEAM_CAPTURES_UNMASKED: 'allowed' })
    assert.doesNotMatch(allowed.out, /needs --zone/)
    assert.match((await runTeam(['--help'], { TEAM_CAPTURES_UNMASKED: 'denied' })).out, /masked false needs --zone ninguna\./)
  })
})
