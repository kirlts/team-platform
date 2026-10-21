// Pruebas del analizador `harness` con un ejecutable `claude` de mentira que habla el formato real
// de `claude -p --output-format json`. El proceso se lanza de verdad; sólo cambia lo que hay del otro lado.
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { analyze, HarnessError, HarnessUnavailableError } from './index.js';
import { makeBundle } from './testing/fixtures.js';

const FAKE_CLAUDE = fileURLToPath(new URL('./testing/fake-claude.mjs', import.meta.url));

describe('analyze (harness)', () => {
  let state;
  before(async () => { state = await mkdtemp(join(tmpdir(), 'team-harness-test-')); });
  after(() => rm(state, { recursive: true, force: true }));

  async function run(mode, extra = {}) {
    await rm(join(state, 'count'), { force: true });
    await rm(join(state, 'calls.jsonl'), { force: true });
    const bundle = await makeBundle();
    const result = await analyze(bundle, {
      analyzer: 'harness',
      config: { harnessBin: FAKE_CLAUDE, harnessEnv: { FAKE_CLAUDE_STATE: state, FAKE_CLAUDE_MODE: mode }, ...extra },
    }).catch((e) => e);
    let calls = [];
    try {
      calls = (await readFile(join(state, 'calls.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    } catch { /* el ejecutable no llegó a correr */ }
    return { result, calls };
  }

  it('llama a claude -p sin --bare, con salida JSON y el esquema del Proposal, desde un directorio propio con el bundle', async () => {
    const { result, calls } = await run('ok');
    assert.equal(result.status, 'ok');
    assert.equal(calls.length, 1);
    const { args, files, templates, cwd, stdin } = calls[0];
    assert.ok(args.includes('-p'));
    assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2), ['--output-format', 'json']);
    assert.ok(!args.includes('--bare'), 'sin --bare para usar la suscripción (UD-008)');
    const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
    assert.deepEqual(schema.required, ['area_id', 'template_id', 'messages', 'discarded']);
    assert.ok(args.includes('--tools=Read') && args.includes('--no-session-persistence'));
    assert.deepEqual(files, ['bundle.json', 'input.md', 'templates']);
    assert.deepEqual(templates, ['1.md', '2.md', '3.md', '4.md', '5.md']);
    assert.match(stdin, /input\.md/);
    assert.notEqual(cwd, process.cwd());
    await assert.rejects(access(cwd), 'el directorio de trabajo se borra al terminar');
  });

  it('lee structured_output, usage y total_cost_usd y pasa por el mismo validador', async () => {
    const { result } = await run('ok');
    assert.deepEqual(result.proposal.messages[0].unit_ids, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(result.proposal.messages[0].fields, { steps: 'Abrir', expected: 'Carga', actual: 'En blanco' });
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.calls[0], {
      step: 'harness', modality: 'text', provider: 'claude-code', model: 'claude-haiku-5-5',
      usage: { input_tokens: 31000, output_tokens: 410, cached_tokens: 2000, cache_creation_tokens: 500 },
      cost_usd: 0.0123, duration_ms: 4200, num_turns: 3, outcome: 'ok',
    });
  });

  it('una salida inválida reintenta una vez con el error en el prompt', async () => {
    const { result, calls } = await run('bad-then-ok');
    assert.equal(result.status, 'ok');
    assert.equal(calls.length, 2);
    assert.match(calls[1].stdin, /no fue válido/);
    assert.match(calls[1].stdin, /no están en ningún mensaje ni en discarded/);
    assert.deepEqual(result.calls.map((c) => c.step), ['harness', 'harness-retry']);
  });

  it('si el reintento también es inválido, falla con los errores', async () => {
    const { result, calls } = await run('always-bad');
    assert.equal(result.status, 'invalid');
    assert.equal(calls.length, 2);
    assert.match(result.errors.join('\n'), /las unidades 2, 3, 4, 5, 6 no están en ningún mensaje/);
  });

  it('un is_error del ejecutable se trata como salida inválida con su motivo', async () => {
    const { result } = await run('error');
    assert.equal(result.status, 'invalid');
    assert.match(result.errors[0], /error_max_turns/);
  });

  it('un rechazo (refusal) no se reintenta', async () => {
    const { result, calls } = await run('refusal');
    assert.equal(result.status, 'refusal');
    assert.equal(result.category, 'cyber');
    assert.equal(calls.length, 1);
  });

  it('si claude no está instalado, error tipado y claro', async () => {
    const { result } = await run('ok', { harnessBin: '/no/existe/claude' });
    assert.ok(result instanceof HarnessUnavailableError, String(result));
    assert.match(result.message, /Claude Code instalado/);
    assert.equal(result.bin, '/no/existe/claude');
  });

  it('un código de salida distinto de cero sin JSON es HarnessError con el mensaje de stderr', async () => {
    const { result } = await run('exit');
    assert.ok(result instanceof HarnessError);
    assert.match(result.message, /código 3.*sesión no iniciada/);
  });

  it('un plazo agotado mata al proceso lanzado y falla con HarnessError', async () => {
    const lento = join(state, 'lento.mjs');
    const { writeFile, chmod } = await import('node:fs/promises');
    await writeFile(lento, '#!/usr/bin/env node\nsetTimeout(() => {}, 60000);\nprocess.stdin.resume();\n');
    await chmod(lento, 0o755);
    const { result } = await run('ok', { harnessBin: lento, harnessTimeoutMs: 300 });
    assert.ok(result instanceof HarnessError);
    assert.match(result.message, /superó el plazo/);
  });
});
