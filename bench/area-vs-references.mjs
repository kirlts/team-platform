#!/usr/bin/env node
// Area accuracy of one or more private-bench result files against the two blind readers of the references (H-91):
//   node bench/area-vs-references.mjs <result.json> [<result.json> ...]
// Per unit that got a message, the area of its message is compared with the area set the first reader (expected.json) and the
// second reader (expected-b.json) gave it. «Union» accepts a label that either reader accepts. «Ceiling» is the best an
// analyzer could do against BOTH readers at once: the share of units where their sets intersect. Units with no message are
// not counted (that is coverage, not classification). Reads bench/private/, which never enters git.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const privateDir = process.env.BENCH_PRIVATE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'private');

function areaByUnit(file) {
  if (!existsSync(file)) return null;
  const expected = JSON.parse(readFileSync(file, 'utf8'));
  const map = new Map();
  for (const m of expected.messages ?? []) for (const id of m.unit_ids) map.set(id, new Set([].concat(m.area_id)));
  return map;
}

const only = process.env.AREA_CASES ? new Set(process.env.AREA_CASES.split(',')) : null; // restrict to some cases, to compare files that ran different sets
const files = process.argv.slice(2);
if (files.length === 0) throw new Error('Usage: node bench/area-vs-references.mjs <result.json> ...');

for (const file of files) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const total = { units: 0, a: 0, b: 0, union: 0, both: 0, ceiling: 0, withB: 0 };
  for (const { runs } of data.cases) {
    const id = runs[0].case_id;
    if (only && !only.has(id)) continue;
    const a = areaByUnit(join(privateDir, id, 'expected.json'));
    const b = areaByUnit(join(privateDir, id, 'expected-b.json'));
    if (!a) continue;
    for (const run of runs) {
      for (const message of run.proposal?.messages ?? []) {
        for (const unit of message.unit_ids) {
          const ea = a.get(unit);
          if (!ea) continue;
          total.units += 1;
          const hitA = ea.has(message.area_id);
          if (hitA) total.a += 1;
          const eb = b?.get(unit);
          if (!eb) continue;
          total.withB += 1;
          const hitB = eb.has(message.area_id);
          if (hitB) total.b += 1;
          if (hitA || hitB) total.union += 1;
          if (hitA && hitB) total.both += 1;
          if ([...ea].some((x) => eb.has(x))) total.ceiling += 1;
        }
      }
    }
  }
  const pct = (n, d) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)} %`);
  console.log(`${file}`);
  console.log(`  units with a message: ${total.units} (${total.withB} also read by the second reader)`);
  console.log(`  vs first reader: ${pct(total.a, total.units)}   vs second reader: ${pct(total.b, total.withB)}   union: ${pct(total.union, total.withB)}   both: ${pct(total.both, total.withB)}   ceiling for both: ${pct(total.ceiling, total.withB)}`);
}
