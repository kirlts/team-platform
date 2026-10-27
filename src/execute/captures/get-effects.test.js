import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { DEFAULT_MARKS, scanFolder, scanText } from './get-effects.mjs'

const ROUTES = `
app.get('/orders', async () => db.all('SELECT * FROM orders'))
app.get('/orders/:id/receipt', async (req) => {
  db.run('UPDATE orders SET seen = 1 WHERE id = ?')
  return receipt
})
app.post('/orders', async () => { db.run('INSERT INTO orders VALUES (1)') })
app.get('/session', async (req, reply) => { reply.setCookie('s', '1') })
app.get('/last', async () => markRead(1))
`

describe('scanText', () => {
  it('flags the GET handlers with a mark of a write and counts every GET; a POST that writes is not its subject', () => {
    const { gets, found } = scanText(ROUTES)
    assert.equal(gets, 4)
    assert.deepEqual(found.map((f) => [f.route, f.marks]), [['/orders/:id/receipt', ['sql-write']], ['/session', ['cookie']], ['/last', ['mark']]])
    assert.equal(found[0].line, 3)
  })
  it('takes the marks of the host on top of the defaults', () => {
    const { found } = scanText("app.get('/x', () => stamp(1))", [...DEFAULT_MARKS, ['stamp', /\bstamp\(/]])
    assert.deepEqual(found[0].marks, ['stamp'])
  })
})

describe('scanFolder', () => {
  it('walks the folder, skips tests and node_modules, and names files relative to it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'effects-'))
    try {
      mkdirSync(join(dir, 'api')); mkdirSync(join(dir, 'node_modules'))
      writeFileSync(join(dir, 'api', 'routes.js'), ROUTES)
      writeFileSync(join(dir, 'api', 'routes.test.js'), ROUTES)
      writeFileSync(join(dir, 'node_modules', 'dep.js'), ROUTES)
      const { gets, found } = scanFolder(dir)
      assert.equal(gets, 4)
      assert.deepEqual([...new Set(found.map((f) => f.file))], ['api/routes.js'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
