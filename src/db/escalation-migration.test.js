// Migration 0021 (UD-269): the area gets `escalation_member_id` with the first Editor; the messages already buried (latest result of the agent is
// `needs_decision`, `not_mine` or a held delivery, nobody holds them) are handed over as the platform does from now on, and each is audited.
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { listMigrations, migrate, openDatabase } from './index.js'
import { tempDir } from '../testing/helpers.js'
import { buriedHandoffs } from '../domain/escalation.js'

const MIGRATIONS = fileURLToPath(new URL('./migrations', import.meta.url))

test('migration 0021 hands over the buried messages and leaves the others alone', () => {
  const dir = tempDir()
  const old = join(dir, 'old')
  mkdirSync(old)
  for (const m of listMigrations(MIGRATIONS).filter((f) => Number(f.filePath.slice(0, 4)) < 21)) copyFileSync(join(MIGRATIONS, m.filePath), join(old, m.filePath))
  const db = openDatabase(join(dir, 'team.db'))
  migrate(db, { dir: old })
  db.exec(`
    INSERT INTO members (id, email, name, role, kind, created_at) VALUES (1, 'ed@x.org', 'Ed', 'editor', 'person', 0), (2, 'claude@x.org', 'Claude', 'member', 'agent', 0), (3, 'ana@x.org', 'Ana', 'member', 'person', 0);
    INSERT INTO areas (id, title, description) VALUES (1, 'Error', 'd');
    INSERT INTO messages (id, area_id, author_id, title, body, status, created_at) VALUES
      (1, 1, 3, 'm1', 'b', 'answered', 1), (2, 1, 3, 'm2', 'b', 'answered', 1), (3, 1, 3, 'm3', 'b', 'answered', 1),
      (4, 1, 3, 'm4', 'b', 'answered', 1), (5, 1, 3, 'm5', 'b', 'closed', 1), (6, 1, 3, 'm6', 'b', 'answered', 1);
    INSERT INTO message_assignees (message_id, member_id) VALUES (1, 2), (2, 2), (3, 2), (4, 2), (4, 1), (5, 2), (6, 2);
    INSERT INTO replies (message_id, author_id, body, kind, created_at) VALUES (1, 2, 'q1', 'answer', 1), (2, 2, 'q2', 'answer', 1);
    INSERT INTO execute_runs (job_id, attempt, message_id, started_at, finished_at, outcome, delivery_held) VALUES
      (1, 1, 1, 10, 11, 'needs_decision', NULL), (2, 1, 2, 10, 11, 'done', 1), (3, 1, 3, 10, 11, 'needs_decision', NULL),
      (4, 1, 3, 20, 21, 'done', 0), (5, 1, 4, 10, 11, 'needs_decision', NULL), (6, 1, 5, 10, 11, 'needs_decision', NULL),
      (7, 1, 6, 10, 11, 'not_mine', NULL);
    INSERT INTO jobs (kind, message_id, status, run_at, created_at) VALUES ('execute', 6, 'queued', 1, 1);
  `)
  // buriedHandoffs reads columns of later migrations (0027), so it runs only on the full schema.
  migrate(db, { dir: MIGRATIONS })
  assert.equal(db.prepare('SELECT escalation_member_id AS e FROM areas WHERE id = 1').get().e, 1, 'the area takes the first Editor')
  const assigned = (id) => db.prepare('SELECT member_id FROM message_assignees WHERE message_id = ? ORDER BY member_id').all(id).map((r) => r.member_id)
  const status = (id) => db.prepare('SELECT status FROM messages WHERE id = ?').get(id).status
  assert.deepEqual([assigned(1), status(1)], [[1], 'open'], 'needs_decision')
  assert.deepEqual([assigned(2), status(2)], [[1], 'open'], 'held delivery')
  assert.deepEqual([assigned(3), status(3)], [[2], 'answered'], 'a newer result supersedes')
  assert.deepEqual([assigned(4), status(4)], [[1, 2], 'answered'], 'a person already holds it')
  assert.deepEqual([assigned(5), status(5)], [[2], 'closed'], 'closed')
  assert.deepEqual([assigned(6), status(6)], [[2], 'answered'], 'someone asked the agent again')
  assert.deepEqual(db.prepare('SELECT kind FROM replies ORDER BY id').all().map((r) => r.kind), ['clarification', 'clarification'], 'the reply of the agent becomes the question')
  const audited = db.prepare("SELECT entity_id, detail_json FROM audit_log WHERE action = 'message.escalate' ORDER BY entity_id").all()
  assert.deepEqual(audited.map((a) => a.entity_id), [1, 2])
  assert.deepEqual(audited.map((a) => JSON.parse(a.detail_json)), [{ to: 1, source: 'migration 0021', result: 'needs_decision' }, { to: 1, source: 'migration 0021', result: 'delivery_held' }])
  assert.deepEqual(buriedHandoffs(db), [], 'the invariant is zero after the migration')
  assert.equal(db.prepare("SELECT name FROM sqlite_temp_master WHERE name = 'handoff_buried'").get(), undefined, 'the working table is gone')
  db.close()
  rmSync(dir, { recursive: true, force: true })
})
