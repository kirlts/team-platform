// scripts/sembrar.mjs seeds the sample set of `ejemplos/` through the API of a real server with the fake providers.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { all, get } from '../src/db/index.js'
import { fakeState } from '../src/testing/fake-providers-module.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const PASSWORD = 'una clave larga de prueba 1'

test('--ejemplo sends every file and folder of ejemplos/, waits for the analysis and prints one row per send', { timeout: 120000 }, async () => {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-sembrar-'))
  const env = { DATA_DIR: dir, HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'silent', ADMIN_EMAIL: 'ed@x.org', ADMIN_PASSWORD: PASSWORD, PROVIDERS_MODULE: './testing/fake-providers-module.js' }
  const { loadConfig } = await import('../src/config.js')
  const { start } = await import('../src/server.js')
  const system = await start(loadConfig(env), { env })
  try {
    const first = get(system.db, 'SELECT a.id AS area_id, t.id AS template_id FROM templates t JOIN areas a ON a.id = t.area_id ORDER BY a.id, t.id LIMIT 1')
    fakeState.areaId = first.area_id
    fakeState.templateId = first.template_id
    const base = `http://127.0.0.1:${system.app.server.address().port}`
    const { stdout } = await promisify(execFile)('node', ['scripts/sembrar.mjs', '--url', base, '--email', 'ed@x.org', '--password', PASSWORD, '--ejemplo', '--paralelo', '3'], { cwd: root, env: { ...process.env, SEMBRAR_POLL_MS: '100' } })
    const lines = stdout.trim().split('\n')
    assert.match(lines[0], /^envío\s+estado\s+mensajes\s+segundos$/)
    const rows = lines.slice(1, -1)
    assert.equal(rows.length, 7, stdout) // six loose files and one folder
    for (const row of rows.filter((r) => !r.startsWith('nota-de-voz'))) assert.match(row, /\spublished\s+\d+\s+\d+(\.\d)?$/, row)
    // The fake transcription is two words and the analysis discards it: the row says so instead of failing.
    assert.match(rows.find((r) => r.startsWith('nota-de-voz')), /\ssin mensajes\s+0\s/)
    assert.match(lines.at(-1), /^7 envíos, 6 publicados, \d+ mensajes$/)
    assert.equal(get(system.db, "SELECT COUNT(*) AS n FROM inputs WHERE status = 'published'").n, 6)
    const combined = get(system.db, "SELECT i.id, (SELECT COUNT(*) FROM attachments a WHERE a.input_id = i.id) AS files FROM inputs i WHERE i.text LIKE 'Reporte de la exportación lenta%'")
    assert.equal(combined.files, 1) // the folder: its .md is the text and its .png the attachment
    assert.deepEqual(all(system.db, "SELECT DISTINCT kind FROM attachments ORDER BY kind").map((r) => r.kind), ['audio', 'document', 'image'])
    assert.ok(get(system.db, 'SELECT COUNT(*) AS n FROM messages').n >= 6)
  } finally {
    await system.shutDown('test')
    rmSync(dir, { recursive: true, force: true })
  }
})
