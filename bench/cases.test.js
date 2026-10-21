// The reference itself must be MECE: each unit the analyzer numbers, in exactly one
// expected message or discarded. If the segmentation in src/analyze/units.js changes, these tests
// fail and expected.json is renumbered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCases, loadFixtures, unitsOf } from './lib.js';
import { score } from './score.js';

const cases = loadCases();
const fixtures = await loadFixtures();

test('there are at least six cases', () => {
  assert.ok(cases.length >= 6, `there are ${cases.length}`);
});

for (const c of cases) {
  const units = unitsOf(c.input);
  const ids = units.map((u) => u.id);

  test(`${c.id}: the reference covers each numbered unit exactly once`, () => {
    const seen = new Map();
    const place = (id, where) => {
      assert.ok(ids.includes(id), `${where} cites ${id}, which does not exist`);
      assert.ok(!seen.has(id), `${id} is in ${where} and in ${seen.get(id)}`);
      seen.set(id, where);
    };
    for (const m of c.expected.messages) {
      assert.ok(m.unit_ids.length > 0, `${m.id} has no units`);
      for (const id of m.unit_ids) place(id, m.id);
    }
    for (const d of c.expected.discarded) {
      assert.ok(d.reason, `${d.unit_ids} discarded without a reason`);
      for (const id of d.unit_ids) place(id, 'discarded');
    }
    assert.equal(seen.size, ids.length, 'there are unassigned units');
  });

  test(`${c.id}: the expected area and template of each message exist in the initial set and match`, () => {
    for (const m of c.expected.messages) {
      const areas = [].concat(m.area_id);
      const templates = [].concat(m.template_id);
      assert.equal(areas.length, templates.length, `${m.id}: mismatched areas and templates`);
      areas.forEach((area, i) => {
        assert.ok(fixtures.areas.some((a) => a.id === area), `${m.id}: area ${area}`);
        const template = fixtures.templates.find((t) => t.id === templates[i]);
        assert.ok(template, `${m.id}: template ${templates[i]}`);
        assert.equal(template.area_id, area, `${m.id}: template ${template.id} does not belong to area ${area}`);
      });
    }
  });

  test(`${c.id}: the input attachments carry extracted text`, () => {
    for (const a of c.input.attachments) assert.ok(a.extracted?.trim(), `attachment ${a.id} without text`);
    assert.ok(c.input.text.trim() || c.input.attachments.length > 0);
  });

  test(`${c.id}: the reference used as output scores MECE with full classification`, () => {
    const actual = {
      messages: c.expected.messages.map((m) => ({ ...m, area_id: [].concat(m.area_id)[0], template_id: [].concat(m.template_id)[0] })),
      discarded: c.expected.discarded,
    };
    const r = score({ units, expected: c.expected, actual });
    assert.equal(r.mece, true);
    assert.equal(r.rates.classification_accuracy, 1);
  });
}

test('the 40-point case has 40 expected messages', () => {
  const c = cases.find((x) => x.id === '02-docx-40-puntos');
  assert.equal(c.expected.messages.length, 40);
});

test('the monologue reaches ten minutes and one of its references is not contiguous', () => {
  const c = cases.find((x) => x.id === '03-monologo-prueba');
  assert.match(unitsOf(c.input).at(-1).text, /^\[09:48\]/);
  const gaps = c.expected.messages.some((m) => m.unit_ids.some((v, i) => i > 0 && v - m.unit_ids[i - 1] > 1));
  assert.ok(gaps);
});

test('the mixed case has messages from three distinct areas', () => {
  const c = cases.find((x) => x.id === '06-mensaje-mezclado');
  assert.equal(new Set(c.expected.messages.map((m) => m.area_id)).size, 3);
});

test('no case carries real contact data', () => {
  const text = JSON.stringify(cases.map((c) => c.input));
  assert.equal(/@[\w-]+\.\w+/.test(text), false, 'there is an email address');
  assert.equal(/\+\d{1,3}[\s-]?\d{6,}|\b\d{3}[\s-]\d{3}[\s-]\d{3,4}\b/.test(text), false, 'there is a phone number');
});
