// `run-private.mjs run --plan`: the dry run of the private bench. It must say whether the real run could start, call no
// provider and need no key, and refuse a model without a price (the spending cap would not see its calls).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./run-private.mjs', import.meta.url));

function fixture({ extracted = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'plan-'));
  const caseDir = join(dir, 'private', 'x01-case');
  mkdirSync(join(dir, 'private', '.cache'), { recursive: true });
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, 'manifest.json'), JSON.stringify({ id: 'x01-case', title: 'Case', kind: 'text', source: 'made up', text: 'Hola' }));
  writeFileSync(join(caseDir, 'expected.json'), JSON.stringify({ messages: [{ id: 'm1', unit_ids: [1] }], discarded: [] }));
  if (extracted) writeFileSync(join(dir, 'private', '.cache', 'x01-case.json'), JSON.stringify({ input: { text: 'Hola', attachments: [] } }));
  writeFileSync(join(dir, 'project.md'), '# Proyecto\nTexto de prueba.');
  return dir;
}

function plan(dir, env = {}, extra = []) {
  const clean = { PATH: process.env.PATH, HOME: dir, ...env }; // no ANTHROPIC_API_KEY, no GROQ_API_KEY
  return spawnSync('node', [script, 'run', '--plan', '--private-dir', join(dir, 'private'), '--results-dir', join(dir, 'results'), '--project', join(dir, 'project.md'), ...extra], { env: clean, encoding: 'utf8' });
}

test('plan: a ready case with the default model is executable, with no key and no provider call', () => {
  const dir = fixture();
  try {
    const r = plan(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Modelo de texto: anthropic claude-haiku-5-5/);
    assert.match(r.stdout, /Proyecto: 27 caracteres/);
    assert.match(r.stdout, /x01-case\s+listo/);
    assert.match(r.stdout, /Plan: ejecutable \(no se llamó a ningún proveedor\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan: a model without a price is refused because the spending cap would not count it', () => {
  const dir = fixture();
  try {
    const r = plan(dir, { TEXT_PROVIDER: 'deepseek', TEXT_MODEL: 'deepseek-flash' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /SIN TARIFA/);
    assert.match(r.stdout, /Plan: NO ejecutable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('plan: Sonnet 5.5 has a price; a case that is not extracted stops the plan', () => {
  const ready = fixture();
  const bare = fixture({ extracted: false });
  try {
    assert.equal(plan(ready, { TEXT_MODEL: 'claude-sonnet-5-5' }).status, 0);
    const r = plan(bare);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /x01-case\s+sin extraer/);
    assert.match(r.stdout, /ningún caso está listo/);
  } finally {
    rmSync(ready, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});

test('plan: a spending ledger at the cap stops the plan before the first case', () => {
  const dir = fixture();
  try {
    mkdirSync(join(dir, 'results'), { recursive: true });
    writeFileSync(join(dir, 'results', 'private-spend.jsonl'), `${JSON.stringify({ at: '2026-10-21T00:00:00Z', label: 'earlier', usd: 4.6, unpriced: 0 })}\n`);
    const r = plan(dir, {}, ['--budget', '5']);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /ya está en el tope/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
