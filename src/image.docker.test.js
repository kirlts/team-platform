// HP-006 (docs/TEST.md), the image half: the image starts with no network at all and answers /health. It runs only
// when TEAM_PLATFORM_IMAGE names a built image (`npm run test:image` builds one and sets it), so `npm test` stays
// free of Docker. The static half (compose.yml declares a single service) is in src/static.test.js.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { after, test } from 'node:test'

const image = process.env.TEAM_PLATFORM_IMAGE
const name = `team-platform-test-${process.pid}`
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

after(() => { if (image) try { docker('rm', '-f', name) } catch { /* it was never created */ } })

test('HP-006: the image starts with --network none and answers /health, and nothing outside is reachable', { skip: image ? false : 'TEAM_PLATFORM_IMAGE is not set (npm run test:image)' }, async () => {
  docker('run', '-d', '--name', name, '--network', 'none', image)
  // The image declares a HEALTHCHECK against /health with a 1 s start interval: wait for its verdict.
  let status = 'starting'
  for (let i = 0; i < 60 && status === 'starting'; i++) {
    status = docker('inspect', '--format', '{{.State.Health.Status}}', name)
    if (status === 'starting') await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  assert.equal(status, 'healthy', docker('logs', name))
  assert.deepEqual(JSON.parse(docker('exec', name, 'wget', '-qO-', 'http://127.0.0.1:3000/health')).status, 'ok')
  assert.throws(() => docker('exec', name, 'wget', '-q', '-T', '3', '-O', '/dev/null', 'http://1.1.1.1/'), /Network unreachable|can't connect/)
})
