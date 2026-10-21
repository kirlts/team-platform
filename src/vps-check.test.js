// scripts/vps-check.mjs against a real local server with the demo analyzer: the end-to-end check that H-89 runs on the VPS
// passes here, prints no credential, and fails when the access is wrong.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assetsOf, parseCredentials } from '../scripts/vps-check.mjs'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PASSWORD = 'una clave larga de prueba 1'

test('parseCredentials reads KEY=value lines with or without export and quotes', () => {
  assert.deepEqual(parseCredentials('URL=https://x.test:8444\nexport ADMIN_EMAIL="a@b.test"\n# nota\nADMIN_PASSWORD=\'p q\'\n'), { URL: 'https://x.test:8444', ADMIN_EMAIL: 'a@b.test', ADMIN_PASSWORD: 'p q' })
})

test('assetsOf lists the compiled files a page references, sorted and without repeats', () => {
  const html = '<script src="/assets/index-AB12.js"></script><link href="/assets/index-CD34.css"><script src="/assets/index-AB12.js">'
  assert.deepEqual(assetsOf(html), ['/assets/index-AB12.js', '/assets/index-CD34.css'])
})

test('the check passes against a local server, prints no password and cancels its test input; with a wrong password it fails', async (t) => {
  if (!existsSync(path.join(rootDir, 'panel/dist/index.html'))) return t.skip('panel/dist is not built')
  const dir = mkdtempSync(path.join(tmpdir(), 'vps-check-'))
  const env = { ...process.env, DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', LOG_LEVEL: 'info', PROJECT_NAME: 'Prueba', ADMIN_EMAIL: 'ana@prueba.test', ADMIN_PASSWORD: PASSWORD,
    ANALYZE_MODULE: path.join(rootDir, 'src/testing/demo-modules.js'), EXTRACT_MODULE: path.join(rootDir, 'src/testing/demo-modules.js') }
  const server = spawn(process.execPath, ['src/server.js'], { cwd: rootDir, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  server.stdout.on('data', (d) => { log += d })
  server.stderr.on('data', (d) => { log += d })
  try {
    for (let i = 0; i < 200 && !/API listening/.test(log); i++) await new Promise((r) => setTimeout(r, 50))
    const port = /API listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(log)?.[1]
    assert.ok(port, `the server did not start:\n${log}`)
    const access = path.join(dir, 'access')
    writeFileSync(access, `URL=http://127.0.0.1:${port}\nADMIN_EMAIL=ana@prueba.test\nADMIN_PASSWORD=${PASSWORD}\n`)
    const ok = spawnSync(process.execPath, ['scripts/vps-check.mjs', '--credentials', access, '--timeout', '30'], { cwd: rootDir, encoding: 'utf8' })
    assert.equal(ok.status, 0, ok.stdout + ok.stderr)
    assert.match(ok.stdout, /OK\s+La propuesta llega/)
    assert.match(ok.stdout, /OK\s+El envío de prueba se descarta/)
    assert.match(ok.stdout, /OK\s+El panel servido es el de este árbol/)
    assert.ok(!ok.stdout.includes(PASSWORD) && !ok.stderr.includes(PASSWORD), 'the password must not be printed')

    const kept = spawnSync(process.execPath, ['scripts/vps-check.mjs', '--credentials', access, '--keep', '--timeout', '30'], { cwd: rootDir, encoding: 'utf8' })
    assert.equal(kept.status, 0, kept.stdout + kept.stderr)
    const last = spawnSync(process.execPath, ['scripts/vps-check.mjs', '--credentials', access, '--last'], { cwd: rootDir, encoding: 'utf8' })
    assert.equal(last.status, 0, last.stdout + last.stderr)
    assert.match(last.stdout, /OK\s+Último envío: estado proposed, adjuntos: ninguno/)

    writeFileSync(access, `URL=http://127.0.0.1:${port}\nADMIN_EMAIL=ana@prueba.test\nADMIN_PASSWORD=otra clave larga equivocada 1\n`)
    const bad = spawnSync(process.execPath, ['scripts/vps-check.mjs', '--credentials', access, '--timeout', '5'], { cwd: rootDir, encoding: 'utf8' })
    assert.equal(bad.status, 1)
    assert.match(bad.stdout, /FALLA\s+Inicio de sesión/)
  } finally {
    server.kill()
    rmSync(dir, { recursive: true, force: true })
  }
})
