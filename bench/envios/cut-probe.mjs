#!/usr/bin/env node
// Measures only the cut pass: for every case of the public bench and of the bank, the units it cuts and where. A cut on a send whose
// reference declares no cut is over-cutting; a reference cut that is missing is under-cutting. One call per case, no other step.
//
//   node bench/envios/cut-probe.mjs --model claude-sonnet-5-5
import { parseArgs } from 'node:util';
import { loadCases } from '../lib.js';
import { numberUnits } from '../../src/analyze/units.js';
import { resolveConfig } from '../../src/analyze/config.js';
import { cutSystem, cutUser } from '../../src/analyze/prompts.js';
import { buildCutSchema } from '../../src/analyze/schema.js';
import { applyCuts, isCuttable, validateCuts } from '../../src/analyze/validate.js';
import { createClaudeCliProviders } from '../claude-cli-provider.mjs';
import { ENVIOS } from './cases.js';

const { values } = parseArgs({ options: { model: { type: 'string', default: 'claude-haiku-5-5' }, repeat: { type: 'string', default: '1' } } });
const config = resolveConfig({});
const providers = createClaudeCliProviders({ model: values.model });
const all = [...loadCases().map((c) => ({ id: c.id, input: c.input, expected: c.expected })), ...ENVIOS.map((c) => ({ id: c.id, input: c.input, expected: c.expected }))];

const rows = await Promise.all(all.map(async (c) => {
  const units = numberUnits({ text: c.input.text, attachments: c.input.attachments });
  const window = units.filter(isCuttable);
  const out = await providers.text.complete({ system: cutSystem({ language: 'es-419' }), messages: [{ role: 'user', content: cutUser({ units: window, language: 'es-419' }) }], schema: buildCutSchema(), effort: config.cutPassEffort });
  const check = validateCuts(out.json, { units, scope: new Set(window.map((u) => u.id)) });
  const applied = applyCuts(units, out.json.cuts);
  const wanted = c.expected.cuts?.length ?? 0;
  return { id: c.id, units: units.length, cut: applied.cut, added: applied.parts, wanted, valid: check.errors.length === 0, verdict: applied.cut === wanted ? 'ok' : applied.cut > wanted ? 'OVER' : 'UNDER' };
}));
rows.sort((a, b) => a.id.localeCompare(b.id));
console.log('case'.padEnd(42), 'units  cut  added  wanted  valid  verdict');
for (const r of rows) console.log(r.id.padEnd(42), String(r.units).padEnd(6), String(r.cut).padEnd(4), String(r.added).padEnd(6), String(r.wanted).padEnd(7), String(r.valid).padEnd(6), r.verdict);
console.log(`\nmodel ${values.model}: ${rows.filter((r) => r.verdict === 'ok').length}/${rows.length} as the reference says`);
