// UD-014: the analysis leaves its tree of spans (analyze, classify, decompose, validate, rescue, harness) with
// job_id and input_id taken from the bundle. Telemetry is global to the process: this file starts it once.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import { createFakeProviders } from '../providers/index.js';
import { traceOfJob } from '../telemetry/trace.js';
import { makeEnv } from '../testing/helpers.js';
import { analyze } from './index.js';
import { bugMessage, CLASSIFY_ERRORS, goodDecomposition, makeBundle } from './testing/fixtures.js';

const FAKE_CLAUDE = fileURLToPath(new URL('./testing/fake-claude.mjs', import.meta.url));

const walk = (nodes) => nodes.flatMap((n) => [n, ...walk(n.children)]);

describe('analyzer telemetry', () => {
  let env;
  before(async () => { env = await makeEnv({ telemetry: true }); });
  after(() => env.close?.());

  async function spansOf(jobId) {
    await env.telemetry.flush();
    return walk(traceOfJob(env.db, jobId).roots);
  }

  it('api: analyze contains classify, decompose per group and validate, with job_id and input_id from the bundle', async () => {
    const bundle = await makeBundle({ job_id: 501, input_id: 31 });
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] });
    await analyze(bundle, { providers: fake });
    const spans = await spansOf(501);
    const root = spans.find((s) => s.name === 'analyze');
    assert.equal(root.attributes['team.step'], 'analyze');
    assert.equal(root.attributes['team.job_id'], 501);
    assert.equal(root.attributes['team.input_id'], 31);
    assert.equal(root.attributes['team.status'], 'ok');
    assert.equal(root.attributes['team.messages'], 3);
    const names = spans.map((s) => s.name);
    for (const expected of ['classify', 'decompose', 'validate']) assert.ok(names.includes(expected), `missing span «${expected}»`);
    const decompose = spans.find((s) => s.name === 'decompose');
    assert.deepEqual(
      [decompose.attributes['team.group_index'], decompose.attributes['team.area_id'], decompose.attributes['team.template_id'], decompose.attributes['team.units']],
      [0, 2, 2, 4],
    );
    // classify and decompose hang from analyze; validate, from the structured call it validates.
    assert.ok(root.children.some((c) => c.name === 'classify'));
    assert.ok(root.children.some((c) => c.name === 'decompose'));
    assert.ok(spans.filter((s) => s.name === 'validate').every((s) => s.attributes['team.valid'] === true));
  });

  it('validate carries the errors when the output is invalid, and rescue appears when there is a conflict', async () => {
    const mala = goodDecomposition();
    mala.messages[1].unit_ids = [3, 4];
    const bundle = await makeBundle({ job_id: 502 });
    const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, mala, { messages: [bugMessage([2, 3, 4], 'Corregir ingreso y fechas')] }] });
    await analyze(bundle, { providers: fake });
    const spans = await spansOf(502);
    const rescue = spans.find((s) => s.name === 'rescue');
    assert.equal(rescue.attributes['team.overlaps'], 1);
    assert.equal(rescue.attributes['team.units'], 3);
    const invalid = spans.filter((s) => s.name === 'validate').find((s) => s.attributes['team.valid'] === false);
    assert.equal(invalid.attributes['team.conflicts'], 1);

    const referencia = goodDecomposition();
    referencia.messages[0].assignee_ids = [99];
    const fake2 = createFakeProviders({ text: [CLASSIFY_ERRORS, referencia, goodDecomposition()] });
    await analyze(await makeBundle({ job_id: 503 }), { providers: fake2 });
    const spans2 = await spansOf(503);
    const withErrors = spans2.find((s) => s.name === 'validate' && s.attributes['team.valid'] === false);
    assert.match(withErrors.attributes['team.errors'].join(' '), /member 99 does not exist/);
  });

  it('harness: one span per invocation with the real cost from total_cost_usd', async () => {
    const stateDir = env.dir;
    const bundle = await makeBundle({ job_id: 504, input_id: 9 });
    await analyze(bundle, {
      analyzer: 'harness',
      config: { harnessBin: FAKE_CLAUDE, harnessEnv: { FAKE_CLAUDE_STATE: stateDir, FAKE_CLAUDE_MODE: 'ok' } },
    });
    const spans = await spansOf(504);
    const harness = spans.find((s) => s.name === 'harness');
    assert.equal(harness.attributes['team.step'], 'harness');
    assert.equal(harness.attributes['team.cost_usd'], 0.0123);
    assert.equal(harness.attributes['gen_ai.provider.name'], 'claude-code');
    assert.equal(harness.attributes['gen_ai.usage.output_tokens'], 410);
    assert.equal(harness.events[0].name, 'gen_ai.client.inference.operation.details');
    assert.ok(spans.find((s) => s.name === 'analyze').children.some((c) => c.name === 'harness'));
    assert.ok(spans.some((s) => s.name === 'validate' && s.attributes['team.validated_step'] === 'harness'));
  });
});
