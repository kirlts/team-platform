// Check of the task T6 of model-limits.mjs: the Editor writes a `note` of an area through PATCH and everybody reads it in GET /areas. Prints NOTA-OK or the reason.
import { addMember, login, makeEnv } from '../src/testing/helpers.js'
const env = await makeEnv()
try {
  await addMember(env, { email: 'ed@x.org', role: 'editor' })
  await addMember(env, { email: 'm@x.org' })
  const ed = await login(env, 'ed@x.org')
  const m = await login(env, 'm@x.org')
  const h = (c) => ({ cookie: c, 'x-team-request': 'panel', 'content-type': 'application/json' })
  const list = (await env.app.inject({ method: 'GET', url: '/api/areas', headers: h(m) })).json()
  const id = (list.items ?? list)[0].id
  const patched = await env.app.inject({ method: 'PATCH', url: `/api/areas/${id}`, headers: h(ed), payload: { note: 'Una nota del área.' } })
  const denied = await env.app.inject({ method: 'PATCH', url: `/api/areas/${id}`, headers: h(m), payload: { note: 'x' } })
  const read = ((await env.app.inject({ method: 'GET', url: '/api/areas', headers: h(m) })).json().items ?? []).find?.((a) => a.id === id) ?? (await env.app.inject({ method: 'GET', url: '/api/areas', headers: h(m) })).json().find((a) => a.id === id)
  console.log(patched.statusCode === 200 && denied.statusCode === 403 && read?.note === 'Una nota del área.' ? 'NOTA-OK' : `NOTA-FALLA patch=${patched.statusCode} member=${denied.statusCode} note=${read?.note}`)
} finally { await env.close() }
