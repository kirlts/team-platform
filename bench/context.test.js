// Tests of the H-77 measurement pieces: the bundle with team and project, the comparison table and the usefulness judge's
// pure parts. No network and no private data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBundle } from './lib.js';
import { compareResults, formatComparison, median } from './compare.js';
import { judgeUser, readRatings, RATINGS_SCHEMA, RUBRIC } from './judge-usefulness.mjs';
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
  assert.match(text, /\| Assignment: exact set \| 50\.0 % \(1\/2\) \| 100\.0 % \(2\/2\) \|/);
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
