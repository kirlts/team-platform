// Tests of the H-77 measurement pieces: the bundle with team and project, the comparison table and the usefulness judge's
// pure parts. No network and no private data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle } from './lib.js';
import { compareResults, formatComparison, median } from './compare.js';
import { judgeUser, readRatings, RATINGS_SCHEMA, RUBRIC, seeded, shuffle, spread } from './judge-usefulness.mjs';
import { costOf } from './pricing.js';
import { score } from './score.js';

const input = { text: 'hello', attachments: [{ id: 1, kind: 'document', extracted: 'x' }] };

test('buildBundle carries members with their profile and the project exactly as the pipeline hands them over', () => {
  const fixtures = { areas: [], templates: [], members: [{ id: 1, name: 'A', profile: 'p' }], project: { name: 'Proj', description: '# d' } };
  const bundle = buildBundle(input, fixtures);
  assert.deepEqual(bundle.members, [{ id: 1, name: 'A', profile: 'p' }]);
  assert.deepEqual(bundle.project, { name: 'Proj', description: '# d' });
  assert.equal(bundle.language, 'es-419');
});

test('buildBundle sends no project key when there is no project', () => {
  const bundle = buildBundle(input, { areas: [], templates: [], members: [] });
  assert.equal('project' in bundle, false);
});

const units = [1, 2, 3];
const expected = { messages: [{ id: 'a', unit_ids: [1, 2], area_id: 2, template_id: 2, assignee_ids: [1] }, { id: 'b', unit_ids: [3], area_id: 3, template_id: 3, assignee_ids: [2] }] };
function fakeResult(variant, assignees, usefulnessScores) {
  const actual = { messages: [{ unit_ids: [1, 2], area_id: 2, template_id: 2, assignee_ids: assignees[0], title: 'Corregir la agenda', body: 'Texto simple.' }, { unit_ids: [3], area_id: 3, template_id: 3, assignee_ids: assignees[1], title: 'Agregar un botón', body: 'Se necesita un botón.' }] };
  return {
    file: `${variant}.json`,
    variant,
    context: { members: [{ id: 1, name: 'Martín Gil' }, { id: 2, name: 'Pablo Valencia' }] },
    cases: [{ case_id: 'c1', runs: [{ status: 'ok', total_ms: 4000, usage: { cost_usd: 0.01 }, proposal: actual, units: [], score: score({ units, expected, actual }) }] }],
    usefulness: usefulnessScores ? { cost_usd: 0.002, cases: [{ case_id: 'c1', scores: usefulnessScores.map((s, i) => ({ message_index: i + 1, score: s })), median: median(usefulnessScores) }] } : null,
  };
}

test('compare: aggregates variants side by side, with per-member assignment and usefulness', () => {
  const out = compareResults([fakeResult('name-only', [[1], [1]], null), fakeResult('profiles', [[1], [2]], [4, 5])]);
  const [a, b] = out.variants;
  assert.equal(a.coverage, 1);
  assert.equal(a.assignment.accuracy, 0.5);
  assert.equal(b.assignment.accuracy, 1);
  assert.equal(a.assignment.per_member['2'].recall, 0);
  assert.equal(b.assignment.per_member['2'].recall, 1);
  assert.equal(a.usefulness, null);
  assert.equal(b.usefulness.median, 4.5);
  assert.equal(a.cost_usd, 0.01);
  const text = formatComparison(out);
  assert.match(text, /\| Assignment: exact set \| 50\.0 % \[9–91\] \| 100\.0 % \[34–100\] \|/);
  assert.match(text, /Pablo Valencia: recall \| 0\.0 % \| 100\.0 % \|/);
  assert.match(text, /Usefulness: median of messages \(1 to 5\) \| n\/a \| 4\.5 \|/);
});

test('compare: a mark that the input contains verbatim is not counted as a tell', () => {
  const result = fakeResult('v', [[1], [2]], null);
  result.cases[0].runs[0].proposal.messages[0].body = 'Se necesita un panorama completo.';
  const withTell = compareResults([result]).variants[0];
  const verbatim = compareResults([result], { inputOf: () => 'el panorama completo' }).variants[0];
  assert.ok(withTell.tells > verbatim.tells);
});

test('judge: the user turn carries the cited source and the message, and nothing about variants or profiles', () => {
  const text = judgeUser({
    messages: [{ unit_ids: [2], title: 'T', fields: { steps: 'paso', empty: '' }, body: 'B' }],
    units: [{ id: 1, text: 'uno' }, { id: 2, text: 'dos' }],
  });
  assert.match(text, /\[2\] dos/);
  assert.doesNotMatch(text, /\[1\]/);
  assert.match(text, /steps: paso/);
  assert.doesNotMatch(text, /empty/);
  assert.doesNotMatch(text, /variant|profile|perfil/i);
  assert.doesNotMatch(RUBRIC, /variant|profile|perfil/i);
});

test('judge: ratings are validated against the messages asked for; repeated, out of range or invalid ones are dropped', () => {
  const { ratings, missing } = readRatings({ ratings: [{ index: 1, score: 5, reason: 'x' }, { index: 1, score: 1, reason: 'dup' }, { index: 4, score: 3, reason: 'out' }, { index: 2, score: 9, reason: 'bad' }] }, 3);
  assert.equal(ratings.get(1).score, 5);
  assert.deepEqual(missing, [2, 3]);
  assert.deepEqual(RATINGS_SCHEMA.properties.ratings.items.required, ['index', 'reason', 'score']);
});

test('withQueueRetries repeats a retryable error up to the attempts and gives up on others', async () => {
  const { withQueueRetries } = await import('./spend.mjs');
  let calls = 0;
  const flaky = () => { calls += 1; if (calls < 3) throw Object.assign(new Error('429'), { retryable: true, retryAfterMs: 1 }); return 'ok'; };
  assert.equal(await withQueueRetries(flaky), 'ok');
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(withQueueRetries(() => { calls += 1; throw Object.assign(new Error('bad'), { retryable: false }); }), /bad/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(withQueueRetries(() => { calls += 1; throw Object.assign(new Error('429'), { retryable: true, retryAfterMs: 1 }); }), /429/);
  assert.equal(calls, 3);
});

test('compare: the shared-pairs table scores only the expected messages every variant covered', () => {
  const a = fakeResult('a', [[1], [1]], null);
  const b = fakeResult('b', [[1], [2]], null);
  // Variant a loses the second point: one fused message covers only the first.
  a.cases[0].runs[0].proposal = { messages: [a.cases[0].runs[0].proposal.messages[0]] };
  a.cases[0].runs[0].score = score({ units, expected, actual: a.cases[0].runs[0].proposal });
  const [va, vb] = compareResults([a, b]).variants;
  assert.equal(va.shared_assignment.pairs, 1);
  assert.equal(vb.shared_assignment.pairs, 1);
  assert.equal(vb.assignment.pairs, 2);
  assert.match(formatComparison({ variants: [va, vb] }), /Pairs in common \| 1 \| 1 \|/);
});

test('poolResults concatenates the runs and the judged scores of a variant and its repetition', async () => {
  const { poolResults } = await import('./compare.js');
  const a = fakeResult('v', [[1], [2]], [4, 5]);
  const b = fakeResult('v-b', [[1], [1]], [2, 3]);
  const [pooled] = poolResults([a, b], (r) => r.variant.replace(/-b$/, ''));
  assert.equal(pooled.variant, 'v');
  assert.equal(pooled.cases[0].runs.length, 2);
  assert.equal(pooled.usefulness.cases[0].scores.length, 4);
  const v = compareResults([pooled]).variants[0];
  assert.equal(v.runs, 2);
  assert.equal(v.assignment.pairs, 4);
  assert.equal(v.usefulness.median, 3.5);
});

test('compare: pairs in common counts every pair that all variants produced', () => {
  const out = compareResults([fakeResult('a', [[1], [1]], null), fakeResult('b', [[1], [2]], null), fakeResult('c', [[2], [2]], null)]);
  for (const v of out.variants) assert.equal(v.shared_assignment.pairs, 2);
});

test('judge: spread keeps order and takes evenly; shuffle is a repeatable permutation', () => {
  const list = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(spread(list, 4), [0, 2, 5, 7]);
  assert.deepEqual(spread([1, 2], 4), [1, 2]);
  const a = shuffle(list, seeded('c01'));
  assert.deepEqual(a, shuffle(list, seeded('c01')));
  assert.deepEqual([...a].sort((x, y) => x - y), list);
  assert.notDeepEqual(a, shuffle(list, seeded('c02')));
});

test('pricing: Sonnet 5.5 is priced per the model list', () => {
  const usd = costOf({ model: 'claude-sonnet-5-5', usage: { input_tokens: 1_000_000, output_tokens: 1_000_000, cached_tokens: 1_000_000 } });
  assert.equal(Number(usd.toFixed(6)), 12.1); // 2 input + 10 output + 0.1 cache read per million (corrected 2026-10-23: the cache read is 0.10, not 0.20)
});

test('wilson: known values, bounds and the empty case', async () => {
  const { wilson } = await import('./compare.js');
  const [lo, hi] = wilson(50, 100);
  assert.ok(Math.abs(lo - 0.4038) < 0.001 && Math.abs(hi - 0.5962) < 0.001);
  const [l0, h0] = wilson(0, 10);
  assert.equal(l0, 0);
  assert.ok(h0 > 0.25 && h0 < 0.30);
  assert.deepEqual(wilson(10, 10).map((x) => Math.round(x * 100)), [72, 100]);
  assert.equal(wilson(0, 0), null);
});

test('labels: the second reader widens area and template and adds an alternative assignee set', async () => {
  const { mergeSecondLabeler, labelerAgreement } = await import('./labels.js');
  const a = { messages: [{ id: 'm1', unit_ids: [1], area_id: 2, template_id: 2, assignee_ids: [1] }, { id: 'm2', unit_ids: [2], area_id: [3, 4], template_id: 3, assignee_ids: [1, 4] }] };
  const b = { messages: [{ id: 'm1', area_id: 3, template_id: 3, assignee_ids: [4] }, { id: 'm2', area_id: 4, template_id: 3, assignee_ids: [1, 4] }] };
  const merged = mergeSecondLabeler(a, b);
  assert.deepEqual([merged.messages[0].area_id, merged.messages[0].template_id, merged.messages[0].assignee_ids_alt], [[2, 3], [2, 3], [4]]);
  assert.deepEqual([merged.messages[1].area_id, merged.messages[1].template_id], [[3, 4], 3]);
  assert.deepEqual(labelerAgreement(a, b), { messages: 2, area: 0, template: 1, assignees: 1 });
  assert.deepEqual(mergeSecondLabeler(a, { messages: [] }), a);
});

test('oracle: reference groups take the area and template most of their units got; exact drawings are counted', async () => {
  const { mapOntoReference, groupingNote } = await import('./oracle.mjs');
  const model = [{ unit_ids: [1], area_id: 2, template_id: 2 }, { unit_ids: [2], area_id: 3, template_id: 3 }, { unit_ids: [3, 4], area_id: 5, template_id: 5 }];
  const out = mapOntoReference(model, [{ id: 'a', unit_ids: [1, 2] }, { id: 'b', unit_ids: [3, 4] }, { id: 'c', unit_ids: [9] }]);
  assert.deepEqual(out.groups.map((g) => [g.area_id, g.template_id]), [[2, 2], [5, 5], [null, null]]);
  assert.equal(out.exact, 1);
  assert.equal(out.unmapped, 1);
  assert.match(groupingNote([{ unit_ids: [1, 2] }], [{ unit_ids: [4] }]), /Grupo 1: u1, u2\nDescartadas: u4/);
});

test('oracle: runOracleCase classifies the reference groups and decomposes each one with the model template', async () => {
  const { runOracleCase } = await import('./oracle.mjs');
  const { loadFixtures } = await import('./lib.js');
  const fixtures = await loadFixtures();
  const seen = [];
  const providers = {
    text: {
      model: 'claude-haiku-5-5',
      complete: async (req) => {
        seen.push(req);
        if (req.schema.properties.groups) {
          return { model: 'claude-haiku-5-5', usage: { input_tokens: 100, output_tokens: 10 }, json: { groups: [{ unit_ids: [1], area_id: 2, template_id: 2 }, { unit_ids: [2, 3], area_id: 3, template_id: 3 }], discarded: [] } };
        }
        return { model: 'claude-haiku-5-5', usage: { input_tokens: 50, output_tokens: 5 }, json: { messages: [{ unit_ids: [1], title: 'T', fields: {}, body: 'B', assignee_ids: [1, 99], attachment_ids: [] }, { unit_ids: [2], title: 'U', fields: {}, body: 'C', assignee_ids: [2], attachment_ids: [] }] } };
      },
    },
  };
  const run = await runOracleCase({
    providers,
    input: { text: 'uno.\n\ndos.\n\ntres.', attachments: [] },
    context: { areas: fixtures.areas, templates: fixtures.templates, members: [{ id: 1, name: 'A', profile: 'p' }, { id: 2, name: 'B', profile: 'q' }] },
    expected: { messages: [{ id: 'm1', unit_ids: [1] }, { id: 'm2', unit_ids: [2, 3] }], discarded: [] },
  });
  assert.equal(run.status, 'ok');
  assert.match(seen[0].messages[0].content, /Grupo 1: u1\nGrupo 2: u2, u3/);
  assert.equal(run.proposal.messages.length, 2);
  assert.deepEqual(run.proposal.messages[0].assignee_ids, [1, 2]); // 99 is not a member; the parts of a split group are joined
    assert.deepEqual(run.oracle, { groups: 2, exact_grouping: 2, split_groups: 2, failed: [] });
  assert.match(seen[1].messages[0].content, /Miembro 1: A/);
  assert.ok(run.usage.cost_usd > 0);
});

test('signTestP: symmetric, exact and bounded', async () => {
  const { signTestP } = await import('./compare.js');
  assert.equal(signTestP(0, 0), 1);
  assert.equal(signTestP(5, 5), 1);
  assert.ok(Math.abs(signTestP(9, 1) - 0.021484375) < 1e-9);
  assert.equal(signTestP(1, 9), signTestP(9, 1));
});
