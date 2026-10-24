// Migration 0022 (UD-272): `replies` is rebuilt to accept the kind `forward` and gets `forwarded_to`. The replies already there keep their ids, their text and
// their attachments (DROP TABLE fires ON DELETE CASCADE on reply_attachments, which the migration puts back), and the new kind is accepted while another is not.
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { listMigrations, migrate, openDatabase } from './index.js'
import { tempDir } from '../testing/helpers.js'

const MIGRATIONS = fileURLToPath(new URL('./migrations', import.meta.url))

test('migration 0022 keeps the replies and their attachments and accepts the kind forward', () => {
  const dir = tempDir()
  const old = join(dir, 'old')
  mkdirSync(old)
  for (const m of listMigrations(MIGRATIONS).filter((f) => Number(f.filePath.slice(0, 4)) < 22)) copyFileSync(join(MIGRATIONS, m.filePath), join(old, m.filePath))
  const db = openDatabase(join(dir, 'team.db'))
  migrate(db, { dir: old })
  db.exec(`
    INSERT INTO members (id, email, name, role, kind, created_at) VALUES (1, 'ed@x.org', 'Ed', 'editor', 'person', 0), (2, 'ana@x.org', 'Ana', 'member', 'person', 0);
    INSERT INTO areas (id, title, description) VALUES (1, 'Error', 'd');
    INSERT INTO messages (id, area_id, author_id, title, body, status, created_at, updated_at) VALUES (1, 1, 2, 'm1', 'b', 'answered', 1, 1);
    INSERT INTO replies (id, message_id, author_id, body, kind, created_at, deleted_at, version, edited_at) VALUES (1, 1, 1, 'primera', 'answer', 5, NULL, 1, NULL), (2, 1, 1, 'editada y borrada', 'clarification', 6, 9, 3, 8);
    INSERT INTO reply_attachments (id, reply_id, kind, name, path, mime, size, sha256, position) VALUES (1, 1, 'document', 'informe.pdf', 'abc', 'application/pdf', 10, 'abc', 0), (2, 2, 'link', 'https://x.org', 'https://x.org', 'text/uri-list', 0, 'def', 0);
  `)
  assert.throws(() => db.exec("INSERT INTO replies (message_id, author_id, body, kind, created_at) VALUES (1, 1, 'x', 'forward', 1)"), /CHECK/, 'the old table does not know forward')
  migrate(db, { dir: MIGRATIONS })
  assert.deepEqual(db.prepare('SELECT id, body, kind, created_at, deleted_at, version, edited_at, forwarded_to FROM replies ORDER BY id').all().map((r) => ({ ...r })), [
    { id: 1, body: 'primera', kind: 'answer', created_at: 5, deleted_at: null, version: 1, edited_at: null, forwarded_to: null },
    { id: 2, body: 'editada y borrada', kind: 'clarification', created_at: 6, deleted_at: 9, version: 3, edited_at: 8, forwarded_to: null }
  ])
  assert.deepEqual(db.prepare('SELECT id, reply_id, name FROM reply_attachments ORDER BY id').all().map((r) => ({ ...r })), [{ id: 1, reply_id: 1, name: 'informe.pdf' }, { id: 2, reply_id: 2, name: 'https://x.org' }])
  db.exec("INSERT INTO replies (message_id, author_id, body, kind, created_at, forwarded_to) VALUES (1, 1, 'motivo', 'forward', 10, 2)")
  assert.equal(db.prepare('SELECT id FROM replies WHERE kind = ?').get('forward').id, 3, 'ids go on after the last one')
  assert.throws(() => db.exec("INSERT INTO replies (message_id, author_id, body, kind, created_at) VALUES (1, 1, 'x', 'other', 1)"), /CHECK/)
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'replies' AND name LIKE 'replies_%' ORDER BY name").all().map((r) => r.name), ['replies_live_message', 'replies_message'])
})
