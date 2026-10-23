// The API of the repository as a child process, for the tests that run in a DOM environment (jsdom replaces `URL`, and the
// server reads its own files with it). Prints one JSON line `{ port, ids }` when it listens and stops when it receives SIGTERM.
import { addMember, makeEnv } from '../../../src/testing/helpers.js'

const port = Number(process.argv[2])
const env = await makeEnv({ config: { identity: { login: { ipMax: 10_000 } } }, worker: true, autoPublish: true })
const ids = {}
for (const m of JSON.parse(process.argv[3])) ids[m.email.split('@')[0]] = String(await addMember(env, m))
await env.app.listen({ host: '127.0.0.1', port })
console.log(JSON.stringify({ port, ids }))
process.on('SIGTERM', async () => {
  await env.close()
  process.exit(0)
})
