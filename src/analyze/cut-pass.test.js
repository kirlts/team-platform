// UD-294: a unit that holds several requests (a dictated paragraph with no full stop, a sentence that says «a bug and, besides, an idea»)
// is cut where the model quotes the start of each later request, so each request can be its own message. The model says where; the
// system checks that the words are in the unit exactly once and never reads what they mean.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFakeProviders } from '../providers/index.js';
import { resolveConfig } from './config.js';
import { analyze } from './index.js';
import { cutBlock, cutInstructions } from './prompts-en.js';
import { cutBlock as cutBlockEs, cutInstructions as cutInstructionsEs } from './prompts-es.js';
import { bugMessage, makeBundle, unitIdsIn } from './testing/fixtures.js';
import { numberUnits } from './units.js';
import { addOwnedAttachments, applyCuts, validateCuts } from './validate.js';

const RUN_ON = 'the stops repeat on the route screen and another thing how many routes does the server hold because I need it for the quote and I think we could group deliveries by building';
const units = numberUnits({ text: `Hello team.\n\n${RUN_ON}`, attachments: [] });
const scope = new Set(units.map((u) => u.id));
const isCut = (req) => Boolean(req.schema.properties.cuts);
const isClassify = (req) => Boolean(req.schema.properties.groups);
const STARTS = ['another thing how many routes', 'and I think we could'];

describe('applyCuts cuts a unit at the words quoted and numbers every unit again', () => {
  it('a run-on unit becomes one unit per request, in order, with new consecutive ids', () => {
    const out = applyCuts(units, [{ unit_id: 2, starts: STARTS }]);
    assert.deepEqual(out.units.map((u) => u.id), [1, 2, 3, 4]);
    assert.equal(out.cut, 1);
    assert.equal(out.parts, 2);
    assert.equal(out.units[1].text, 'the stops repeat on the route screen and');
    assert.equal(out.units[2].text, 'another thing how many routes does the server hold because I need it for the quote');
    assert.equal(out.units[3].text, 'and I think we could group deliveries by building');
    assert.equal(units[1].text, RUN_ON, 'the input units are not mutated');
  });

  it('a voice unit keeps its time label on every part, and a chat unit its sender', () => {
    const voice = numberUnits({ attachments: [{ id: 1, kind: 'audio', extracted: '[00:00-00:20] Voz: the map is blank on mondays and also I want a voice note on each stop' }] });
    const out = applyCuts(voice, [{ unit_id: 1, starts: ['and also I want'] }]);
    assert.deepEqual(out.units.map((u) => u.text), ['[00:00-00:20] Voz: the map is blank on mondays', '[00:00-00:20] Voz: and also I want a voice note on each stop']);
    assert.deepEqual(out.units.map((u) => u.kind), ['voice', 'voice']);
    assert.deepEqual(out.units.map((u) => u.time), ['00:00-00:20', '00:00-00:20']);
    const chat = numberUnits({ text: '[09:12] Ana: the button is gray and I wish the map showed live position' });
    const cutChat = applyCuts(chat, [{ unit_id: 1, starts: ['and I wish the map'] }]);
    assert.deepEqual(cutChat.units.map((u) => u.text), ['[09:12] Ana: the button is gray', 'Ana: and I wish the map showed live position']);
  });

  it('words that are not in the unit, are in it twice, are at its start, or sit on a frame or an empty unit are skipped', () => {
    assert.equal(applyCuts(units, [{ unit_id: 2, starts: ['nothing like this'] }]).cut, 0);
    assert.equal(applyCuts(units, [{ unit_id: 2, starts: ['the'] }]).cut, 0, '«the» appears more than once');
    assert.equal(applyCuts(units, [{ unit_id: 2, starts: ['the stops repeat'] }]).cut, 0, 'the start of the unit is not a cut');
    const frame = numberUnits({ text: 'Hello there', attachments: [{ id: 3, kind: 'image', extracted: 'A map and also a list of routes' }] });
    assert.equal(applyCuts(frame, [{ unit_id: 2, starts: ['and also a list'] }]).cut, 0, 'an image description is never cut');
    assert.equal(applyCuts(units, [{ unit_id: 99, starts: ['x'] }]).cut, 0);
    const mixed = applyCuts(units, [{ unit_id: 2, starts: ['nothing like this', STARTS[0]] }]);
    assert.equal(mixed.parts, 1, 'the valid start still cuts');
  });
});

describe('validateCuts checks the form of what the model quoted', () => {
  it('a valid cut passes; an unknown unit, a bad quote or a repeated unit are errors the retry sees', () => {
    assert.deepEqual(validateCuts({ cuts: [{ unit_id: 2, starts: STARTS }] }, { units, scope }), { errors: [] });
    assert.deepEqual(validateCuts({ cuts: [] }, { units, scope }), { errors: [] });
    const bad = validateCuts({ cuts: [{ unit_id: 9, starts: ['x'] }, { unit_id: 2, starts: ['nothing like this'] }, { unit_id: 2, starts: [STARTS[0]] }] }, { units, scope });
    assert.equal(bad.errors.length, 3);
    assert.match(bad.errors[0], /unit 9 is not in the units/);
    assert.match(bad.errors[1], /is not inside the text of u2/);
    assert.match(bad.errors[2], /already has a cut/);
    assert.ok(bad.repairable, 'a bad cut never fails the input');
    assert.ok(validateCuts({ cuts: [{ unit_id: 2, starts: [] }] }, { units, scope }).errors.length === 0, 'no starts is a no-op');
    assert.ok(validateCuts({ nothing: true }, { units, scope }).errors.length > 0);
  });
});

describe('the analysis cuts before it classifies, so the groups cite the new units', () => {
  const script = (cuts) => (req) => {
    if (isCut(req)) return { cuts };
    if (isClassify(req)) {
      const ids = unitIdsIn(req);
      return { split_at: [], groups: ids.length === 4 ? [{ unit_ids: [2], area_id: 2, template_id: 2, requests: ['fix'], recap_unit_ids: [] }, { unit_ids: [3], area_id: 2, template_id: 2, requests: ['answer'], recap_unit_ids: [] }, { unit_ids: [4], area_id: 2, template_id: 2, requests: ['idea'], recap_unit_ids: [] }] : [{ unit_ids: ids.filter((id) => id !== 1), area_id: 2, template_id: 2, requests: ['fix'], recap_unit_ids: [] }], discarded: [{ unit_ids: [1], reason: 'greeting' }] };
    }
    return { messages: [bugMessage(unitIdsIn(req), `Handle ${unitIdsIn(req).join('-')}`)] };
  };

  it('one run-on unit with three requests comes out as three messages', async () => {
    const fake = createFakeProviders({ text: script([{ unit_id: 2, starts: STARTS }]) });
    const result = await analyze(await makeBundle({ text: `Hello team.\n\n${RUN_ON}`, attachments: [] }), { providers: fake, config: { coveragePasses: 0, splitPass: false } });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.stats.cut_pass, { cut: 1, added: 2 });
    assert.equal(result.stats.units, 4);
    assert.deepEqual(result.units.map((u) => u.id), [1, 2, 3, 4]);
    assert.deepEqual(result.proposal.messages.map((m) => [m.area_id, m.unit_ids]), [[2, [2]], [2, [3]], [2, [4]]]);
    const cutCalls = fake.calls.text.filter(isCut);
    assert.equal(cutCalls.length, 1);
    assert.equal(cutCalls[0].effort, 'low');
    assert.equal(cutCalls[0].thinking, 'disabled');
    assert.match(JSON.stringify(cutCalls[0].messages), /\[u2\]/);
  });

  it('with nothing to cut the units stay as numbered and the stats carry no cut', async () => {
    const fake = createFakeProviders({ text: script([]) });
    const result = await analyze(await makeBundle({ text: `Hello team.\n\n${RUN_ON}`, attachments: [] }), { providers: fake, config: { coveragePasses: 0, splitPass: false } });
    assert.equal(result.status, 'ok');
    assert.equal(result.stats.cut_pass, undefined);
    assert.equal(result.units.length, 2);
  });

  it('a cut the system cannot apply leaves the input as it was and does not fail it', async () => {
    const fake = createFakeProviders({ text: script([{ unit_id: 2, starts: ['words that are not there'] }]) });
    const result = await analyze(await makeBundle({ text: `Hello team.\n\n${RUN_ON}`, attachments: [] }), { providers: fake, config: { coveragePasses: 0, splitPass: false } });
    assert.equal(result.status, 'ok');
    assert.equal(result.units.length, 2);
  });

  it('cutPass false makes no cut call', async () => {
    const fake = createFakeProviders({ text: script([]) });
    await analyze(await makeBundle({ text: `Hello team.\n\n${RUN_ON}`, attachments: [] }), { providers: fake, config: { coveragePasses: 0, splitPass: false, cutPass: false } });
    assert.equal(fake.calls.text.filter(isCut).length, 0);
  });
});

describe('the knobs and the prompts of the cut pass', () => {
  it('defaults are on, effort low and thinking disabled; wrong values are rejected', () => {
    const config = resolveConfig({});
    assert.equal(config.cutPass, true);
    assert.equal(config.cutPassEffort, 'low');
    assert.equal(config.cutPassThinking, 'disabled');
    assert.throws(() => resolveConfig({ cutPass: 'yes' }), /cutPass/);
    assert.throws(() => resolveConfig({ cutPassEffort: 'huge' }), /cutPassEffort/);
    assert.throws(() => resolveConfig({ cutPassThinking: 'on' }), /cutPassThinking/);
  });

  it('both languages carry the same rules: copy the words, cut only requests that can be taken apart, never cut what justifies, doubt means no cut', () => {
    const en = cutInstructions(null);
    const es = cutInstructionsEs(null);
    for (const text of [en, es]) {
      assert.match(text, /cuts/);
      assert.match(text, /starts/);
      assert.match(text, /unit_id/);
    }
    assert.match(en, /Do not cut what only justifies/);
    assert.match(en, /When in doubt, do not cut/);
    assert.match(es, /No cortes lo que solo justifica/);
    assert.match(es, /En la duda, no cortes/);
    assert.match(cutBlock(units), /\[u2\]/);
    assert.match(cutBlockEs(units), /\[u2\]/);
  });
});

describe('a message carries the attachments its units come from (UD-294)', () => {
  const audio = numberUnits({ attachments: [{ id: 4, kind: 'audio', extracted: '[00:00-00:05] Voz: one\n[00:05-00:10] Voz: two' }, { id: 5, kind: 'image', extracted: 'A screen' }] });

  it('the attachment of each unit is added; what the model added as context stays; the ids are sorted and unique', () => {
    const out = addOwnedAttachments([{ unit_ids: [1], attachment_ids: [9] }, { unit_ids: [2, 3], attachment_ids: [4] }], audio);
    assert.deepEqual(out.map((m) => m.attachment_ids), [[4, 9], [4, 5]]);
  });

  it('the analysis returns it even when the decomposition left attachment_ids empty', async () => {
    const fake = createFakeProviders({
      text: (req) => {
        if (isClassify(req)) return { split_at: [], groups: [{ unit_ids: [1], area_id: 2, template_id: 2, requests: ['a'], recap_unit_ids: [] }, { unit_ids: [2], area_id: 2, template_id: 2, requests: ['b'], recap_unit_ids: [] }], discarded: [] };
        return { messages: [bugMessage(unitIdsIn(req), `Handle ${unitIdsIn(req).join('-')}`)] };
      },
    });
    const result = await analyze(await makeBundle({ text: '', attachments: [{ id: 4, kind: 'audio', extracted: '[00:00-00:05] Voz: one\n[00:05-00:10] Voz: two' }] }), { providers: fake, config: { coveragePasses: 0, splitPass: false, cutPass: false } });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.proposal.messages.map((m) => m.attachment_ids), [[4], [4]]);
  });
});
