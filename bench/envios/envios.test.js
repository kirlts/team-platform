// The bank of 12 sends runs through the real analyzer with fake providers that answer like a perfect reader, so the battery
// proves the pipeline (cut pass, classification, split check, decomposition, validation) keeps one message per request, each with
// its own area, template, fields and attachments. With TEAM_LIVE_ENVIOS=1 the same bank runs against a real model through `claude -p`
// (the account's subscription, no API key); TEAM_LIVE_ENVIOS_MODEL picks the model (default claude-haiku-5-5).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze } from '../../src/analyze/index.js';
import { buildBundle } from '../lib.js';
import { createBenchProviders } from '../fake-providers.js';
import { createClaudeCliProviders } from '../claude-cli-provider.mjs';
import { ENVIOS, AREA_IDS } from './cases.js';
import { loadEnvioFixtures } from './fixtures.js';
import { scoreEnvio } from './score.js';

const fixtures = await loadEnvioFixtures();

async function run(testCase, providers) {
  const result = await analyze(buildBundle(testCase.input, fixtures), { providers, analyzer: 'api' });
  const proposal = result.proposal ?? { messages: result.draft?.messages ?? [], discarded: result.draft?.discarded ?? [] };
  return { result, s: scoreEnvio(testCase, { units: result.units, proposal, templates: fixtures.templates, status: result.status }) };
}

test('the bank has 12 sends with 1, 2, 3 and 5 requests, two areas or more, attachments, a voice note and run-on paragraphs', () => {
  assert.equal(ENVIOS.length, 12);
  const counts = new Set(ENVIOS.map((c) => c.expected.messages.length));
  for (const n of [1, 2, 3, 5]) assert.ok(counts.has(n), `a send with ${n} requests`);
  assert.ok(ENVIOS.some((c) => new Set(c.expected.messages.map((m) => m.area_id)).size >= 3), 'a send of three areas');
  assert.ok(ENVIOS.some((c) => c.expected.messages.length >= 2 && new Set(c.expected.messages.map((m) => m.area_id)).size === 1), 'a send of two requests of one area');
  assert.ok(ENVIOS.some((c) => c.input.attachments.some((a) => a.kind === 'audio')), 'a voice note');
  assert.ok(ENVIOS.some((c) => c.input.attachments.some((a) => a.kind === 'image')), 'a screenshot');
  assert.ok(ENVIOS.filter((c) => c.expected.cuts.length > 0).length >= 2, 'run-on paragraphs that need a cut');
  assert.ok(ENVIOS.some((c) => c.expected.messages.filter((m) => m.attachment_ids.includes(1)).length >= 2), 'an attachment shared by two messages');
  for (const c of ENVIOS) for (const m of c.expected.messages) assert.ok(AREA_IDS.includes(m.area_id) && m.template_id === m.area_id, `${c.id} ${m.id}: area and template of the test project`);
});

for (const testCase of ENVIOS) {
  test(`${testCase.id}: ${testCase.expected.messages.length} message(s) with their own area, template, fields and attachments`, async () => {
    const { result, s } = await run(testCase, createBenchProviders({ expected: testCase.expected, mode: 'perfect' }));
    assert.equal(result.status, 'ok');
    assert.deepEqual({ got: s.got, area: s.area_ok, template: s.template_ok, fields: s.fields_ok, attachments: s.attachments_ok, ordered: s.ordered, mece: s.mece }, { got: s.expected, area: s.expected, template: s.expected, fields: s.expected, attachments: s.expected, ordered: true, mece: true });
    assert.ok(s.pass);
  });
}

test('a run-on paragraph with three requests is one unit until the cut pass cuts it', async () => {
  const testCase = ENVIOS.find((c) => c.id === 'e04-tres-areas');
  const { result } = await run(testCase, createBenchProviders({ expected: testCase.expected, mode: 'perfect' }));
  assert.deepEqual(result.stats.cut_pass, { cut: 1, added: 2 });
  assert.equal(result.proposal.messages.length, 3);
});

test('the scorer fails a send that came out fused: one message where two requests were expected', async () => {
  const testCase = ENVIOS.find((c) => c.id === 'e02-dos-areas-distintas');
  const fused = { messages: [{ ...testCase.expected.messages[0], unit_ids: testCase.expected.messages.flatMap((m) => m.unit_ids), fields: {}, attachment_ids: [] }], discarded: [] };
  const units = [1, 2, 3, 4].map((id) => ({ id }));
  const s = scoreEnvio(testCase, { units, proposal: fused, templates: fixtures.templates, status: 'ok' });
  assert.equal(s.pass, false);
  assert.equal(s.count_ok, false);
});

test('live: the bank against a real model through claude -p', { skip: !process.env.TEAM_LIVE_ENVIOS, timeout: 1_800_000 }, async () => {
  const providers = createClaudeCliProviders({ model: process.env.TEAM_LIVE_ENVIOS_MODEL || 'claude-haiku-5-5' });
  const rows = await Promise.all(ENVIOS.map(async (c) => ({ id: c.id, ...(await run(c, providers)) })));
  const failed = rows.filter((r) => !r.s.pass).map((r) => `${r.id} (${r.s.got}/${r.s.expected} messages)`);
  assert.deepEqual(failed, []);
});
