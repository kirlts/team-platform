// H-1900 and H-1003: the coverage pass over the discarded units, the read-only context before each window and the draws of the
// first classification. The model is a fake; what is tested is the mechanics and that the system only validates form.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeProviders, ProviderRefusalError } from '../providers/index.js';
import { analyze, classifyInput, resolveConfig } from './index.js';
import { bugMessage, lastUserText, makeBundle, unitIdsIn } from './testing/fixtures.js';

const TEXT = ['El botón Enviar falla.', 'Hola equipo.', 'El CSV exportado trae las fechas en formato americano.', 'Gracias.'].join('\n\n');
const isClassify = (req) => Boolean(req.schema.properties.groups);
const isCoverage = (req) => /Review of what was set aside/.test(lastUserText(req));
const group = (ids) => ({ unit_ids: ids, area_id: 2, template_id: 2 });
const decompose = (req) => ({ messages: [bugMessage(unitIdsIn(req), `Corregir ${unitIdsIn(req).join('-')}`)] });

/** First reading keeps u1 and sets u2 to u4 apart; the coverage reading recovers u3. */
const script = (onCoverage) => (req) => {
  if (!isClassify(req)) return decompose(req);
  if (isCoverage(req)) return onCoverage(req);
  return { groups: [group([1])], discarded: [{ unit_ids: [2, 3, 4], reason: 'charla' }] };
};

describe('analyze (api): coverage pass (H-1900)', () => {
  it('the units set apart are read again alone, and the model groups what it finds', async () => {
    const fake = createFakeProviders({ text: script((req) => ({ groups: [group([3])], discarded: [{ unit_ids: [2, 4], reason: 'charla' }] })) });
    const result = await analyze(await makeBundle({ text: TEXT, attachments: [] }), { providers: fake, config: { coveragePasses: 1 } });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[1], [3]]);
    assert.deepEqual(result.proposal.discarded.flatMap((d) => d.unit_ids).sort(), [2, 4]);
    const coverage = fake.calls.text.filter((r) => isClassify(r) && isCoverage(r));
    assert.equal(coverage.length, 1);
    assert.deepEqual(unitIdsIn(coverage[0]), [2, 3, 4], 'only the units set apart, with their original numbers');
    assert.deepEqual(result.stats.coverage_pass, { units: 3, regrouped: 1, failed_sections: 0 });
    assert.ok(result.calls.some((c) => c.step === 'coverage'));
  });

  it('with the pass turned off there is no extra call', async () => {
    const fake = createFakeProviders({ text: script(() => { throw new Error('must not be called'); }) });
    const result = await analyze(await makeBundle({ text: TEXT, attachments: [] }), { providers: fake, config: { coveragePasses: 0 } });
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[1]]);
    assert.equal(result.stats.coverage_pass, undefined);
  });

  it('a pass that is refused is not a reason to fail: the first-reading discards stay', async () => {
    const fake = createFakeProviders({ text: script(() => new ProviderRefusalError('no', { category: 'x' })) });
    const result = await analyze(await makeBundle({ text: TEXT, attachments: [] }), { providers: fake, config: { coveragePasses: 1 } });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[1]]);
    assert.deepEqual(result.proposal.discarded.flatMap((d) => d.unit_ids).sort(), [2, 3, 4]);
    assert.equal(result.stats.coverage_pass.failed_sections, 1);
  });

  it('a unit the second reading groups between two units of a group joins that group, as in the first reading', async () => {
    const fake = createFakeProviders({
      text: (req) => {
        if (!isClassify(req)) return decompose(req);
        if (isCoverage(req)) return { groups: [group([2])], discarded: [{ unit_ids: [3], reason: 'charla' }] };
        return { groups: [group([1, 4])], discarded: [{ unit_ids: [2, 3], reason: 'charla' }] };
      },
    });
    // u2 and u3 lie inside the span of the group [1, 4]: the first reading already closes the stretch, so nothing is left to read again.
    const result = await analyze(await makeBundle({ text: TEXT, attachments: [] }), { providers: fake, config: { coveragePasses: 1 } });
    assert.deepEqual(result.proposal.messages.map((m) => m.unit_ids), [[1, 2, 3, 4]]);
    assert.equal(result.stats.coverage_pass, undefined);
  });
});

describe('analyze (api): context units before each window (H-1003)', () => {
  const long = Array.from({ length: 6 }, (_, i) => `Párrafo ${i + 1} con una falla distinta.`).join('\n\n');
  /** Each window answers with one group of its own units; records the header (notes and context) and the own units of every request. */
  const recorder = (seen) => (req) => {
    if (!isClassify(req)) return decompose(req);
    const [head, body] = lastUserText(req).split('Input\n');
    const own = [...body.matchAll(/\[u(\d+)\]/g)].map((m) => Number(m[1]));
    seen.push({ head, own });
    return { groups: [group(own)], discarded: [] };
  };

  it('each window after the first carries the units that precede it, read-only, and a window cites only its own units', async () => {
    const seen = [];
    const fake = createFakeProviders({ text: recorder(seen) });
    const result = await analyze(await makeBundle({ text: long, attachments: [] }), { providers: fake, config: { classifyWindowUnits: 3, classifyContextUnits: 2, coveragePasses: 0 } });
    assert.equal(result.status, 'ok');
    const byStart = seen.sort((a, b) => a.own[0] - b.own[0]);
    assert.deepEqual(byStart.map((s) => s.own), [[1, 2, 3], [4, 5, 6]]);
    assert.doesNotMatch(byStart[0].head, /already classified/);
    assert.match(byStart[1].head, /units u2 to u3 come right before this stretch and are already classified/);
    assert.match(byStart[1].head, /\[u2\][\s\S]*\[u3\]/);
  });

  it('with the context turned off the windows carry no preceding units', async () => {
    const seen = [];
    const fake = createFakeProviders({ text: recorder(seen) });
    await analyze(await makeBundle({ text: long, attachments: [] }), { providers: fake, config: { classifyWindowUnits: 3, classifyContextUnits: 0, coveragePasses: 0 } });
    assert.equal(seen.length, 2);
    assert.ok(seen.every((s) => !/already classified/.test(s.head)));
  });
});

describe('classifyInput: draws of the first classification (H-1003)', () => {
  const g = (area, ...ids) => ({ unit_ids: ids, area_id: area, template_id: area });
  const draws = [
    { groups: [g(2, 1, 2), g(2, 3, 4)], discarded: [] },
    { groups: [g(2, 1, 2), g(1, 3, 4)], discarded: [] },
    { groups: [g(2, 1), g(1, 2, 3), g(1, 4)], discarded: [] },
  ];

  it('several draws are asked in parallel; the system keeps the one that agrees most, with the area the majority gave', async () => {
    let n = 0;
    const fake = createFakeProviders({ text: () => { const out = draws[n % draws.length]; n += 1; return out; } });
    const stage = await classifyInput(await makeBundle({ text: TEXT, attachments: [] }), { providers: fake, config: resolveConfig({ classifyDraws: 3, coveragePasses: 0, splitPass: false }) });
    assert.equal(fake.calls.text.length, 3);
    assert.equal(stage.ctx.stats.classification_draws, 3);
    assert.deepEqual(stage.groups.map((x) => [x.area_id, x.unit_ids]), [[2, [1, 2]], [1, [3, 4]]], 'u3 and u4 went to area 1 in two of the three draws');
  });

  it('a single draw is the classification as it comes', async () => {
    const fake = createFakeProviders({ text: [draws[0]] });
    const stage = await classifyInput(await makeBundle({ text: TEXT, attachments: [] }), { providers: fake, config: resolveConfig({ classifyDraws: 1, coveragePasses: 0, splitPass: false }) });
    assert.equal(fake.calls.text.length, 1);
    assert.deepEqual(stage.groups, draws[0].groups);
    assert.equal(stage.ctx.stats.classification_draws, undefined);
  });

  it('the knobs are validated', () => {
    assert.throws(() => resolveConfig({ classifyDraws: 0 }), /classifyDraws/);
    assert.throws(() => resolveConfig({ coveragePasses: -1 }), /coveragePasses/);
    assert.throws(() => resolveConfig({ classifyContextUnits: 1.5 }), /classifyContextUnits/);
  });
});
