// Tests of the `harness` analyzer with a fake `claude` executable that speaks the real format
// of `claude -p --output-format json`. The process is really launched; only what is on the other side changes.
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { analyze, HarnessError, HarnessUnavailableError } from './index.js';
import { makeBundle, MULTI_TEXT } from './testing/fixtures.js';

const FAKE_CLAUDE = fileURLToPath(new URL('./testing/fake-claude.mjs', import.meta.url));

describe('analyze (harness)', () => {
  let state;
  before(async () => { state = await mkdtemp(join(tmpdir(), 'team-harness-test-')); });
  after(() => rm(state, { recursive: true, force: true }));

  async function run(mode, extra = {}, bundleOverrides = {}) {
    await rm(join(state, 'count'), { force: true });
    await rm(join(state, 'calls.jsonl'), { force: true });
    const bundle = await makeBundle(bundleOverrides);
    const result = await analyze(bundle, {
      analyzer: 'harness',
      config: { harnessBin: FAKE_CLAUDE, harnessEnv: { FAKE_CLAUDE_STATE: state, FAKE_CLAUDE_MODE: mode }, ...extra },
    }).catch((e) => e);
    let calls = [];
    try {
      calls = (await readFile(join(state, 'calls.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    } catch { /* the executable never ran */ }
    return { result, calls };
  }

  it('calls claude -p without --bare, with JSON output and the Proposal schema, from its own directory with the bundle', async () => {
    const { result, calls } = await run('ok');
    assert.equal(result.status, 'ok');
    assert.equal(calls.length, 1);
    const { args, files, templates, cwd, stdin } = calls[0];
    assert.ok(args.includes('-p'));
    assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2), ['--output-format', 'json']);
    assert.ok(!args.includes('--bare'), 'no --bare, to use the subscription (UD-008)');
    const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]);
    assert.deepEqual(schema.required, ['messages', 'discarded']);
    assert.deepEqual(schema.properties.messages.items.required.slice(0, 3), ['unit_ids', 'area_id', 'template_id']);
    assert.ok(args.includes('--tools=Read') && args.includes('--no-session-persistence'));
    assert.deepEqual(files, ['bundle.json', 'input.md', 'templates']);
    assert.deepEqual(templates, ['1.md', '2.md', '3.md', '4.md', '5.md']);
    assert.match(stdin, /input\.md/);
    assert.notEqual(cwd, process.cwd());
    await assert.rejects(access(cwd), 'the working directory is deleted when done');
  });

  it('reads structured_output, usage and total_cost_usd and goes through the same validator', async () => {
    const { result } = await run('ok');
    assert.ok(!('area_id' in result.proposal), 'area and template belong to each message');
    assert.deepEqual(result.proposal.messages[0].unit_ids, [1, 2, 3, 4, 5, 6]);
    assert.equal(result.proposal.messages[0].area_id, 2);
    assert.deepEqual(result.proposal.messages[0].fields, { steps: 'Abrir', expected: 'Carga', actual: 'En blanco' });
    assert.equal(result.calls.length, 1);
    assert.deepEqual(result.calls[0], {
      step: 'harness', modality: 'text', provider: 'claude-code', model: 'claude-haiku-5-5',
      usage: { input_tokens: 31000, output_tokens: 410, cached_tokens: 2000, cache_creation_tokens: 500 },
      cost_usd: 0.0123, duration_ms: 4200, num_turns: 3, outcome: 'ok',
    });
  });

  it('an input with several areas: each message is validated against the fields of its own template', async () => {
    const { result } = await run('multi', {}, { text: MULTI_TEXT, attachments: [] });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal.messages.map((m) => [m.unit_ids, m.area_id, m.template_id]), [[[2], 2, 2], [[3], 1, 1], [[4], 5, 5]]);
    assert.deepEqual(result.proposal.messages[1].fields, { idea: 'Agrupar', motivation: 'No indicado' });
    assert.deepEqual(result.proposal.discarded, [{ unit_ids: [1, 5], reason: 'charla' }]);
  });

  it('an invalid output retries once with the error in the prompt', async () => {
    const { result, calls } = await run('bad-then-ok');
    assert.equal(result.status, 'ok');
    assert.equal(calls.length, 2);
    assert.match(calls[1].stdin, /was not valid/);
    assert.match(calls[1].stdin, /are in no place/);
    assert.deepEqual(result.calls.map((c) => c.step), ['harness', 'harness-retry']);
  });

  it('if the retry is also invalid, it fails with the errors', async () => {
    const { result, calls } = await run('always-bad');
    assert.equal(result.status, 'invalid');
    assert.equal(calls.length, 2);
    assert.match(result.errors.join('\n'), /units 2, 3, 4, 5, 6 are in no place/);
  });

  it('an is_error from the executable is treated as invalid output with its reason', async () => {
    const { result } = await run('error');
    assert.equal(result.status, 'invalid');
    assert.match(result.errors[0], /error_max_turns/);
  });

  it('a refusal is not retried', async () => {
    const { result, calls } = await run('refusal');
    assert.equal(result.status, 'refusal');
    assert.equal(result.category, 'cyber');
    assert.equal(calls.length, 1);
  });

  it('if claude is not installed, a typed and clear error', async () => {
    const { result } = await run('ok', { harnessBin: '/no/existe/claude' });
    assert.ok(result instanceof HarnessUnavailableError, String(result));
    assert.match(result.message, /Claude Code instalado/);
    assert.equal(result.bin, '/no/existe/claude');
  });

  it('a non-zero exit code with no JSON is a HarnessError with the stderr message', async () => {
    const { result } = await run('exit');
    assert.ok(result instanceof HarnessError);
    assert.match(result.message, /código 3.*session not started/);
  });

  it('an expired timeout kills the launched process and fails with HarnessError', async () => {
    const lento = join(state, 'lento.mjs');
    const { writeFile, chmod } = await import('node:fs/promises');
    await writeFile(lento, '#!/usr/bin/env node\nsetTimeout(() => {}, 60000);\nprocess.stdin.resume();\n');
    await chmod(lento, 0o755);
    const { result } = await run('ok', { harnessBin: lento, harnessTimeoutMs: 300 });
    assert.ok(result instanceof HarnessError);
    assert.match(result.message, /superó el plazo/);
  });
});
