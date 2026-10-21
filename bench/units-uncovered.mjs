#!/usr/bin/env node
// H-1600: rate of units with actionable content (cited by a message of the reference) that end in no message of the
// proposal, because the model discarded them or left them out. Reads the result files of run-private.mjs and
// bench/private/<case>/expected.json (either reader: a unit counts as actionable when reader A or reader B puts it in a message).
//
//   BENCH_PRIVATE_DIR=bench/private node bench/units-uncovered.mjs <label>=<file>[,<file>...] ...
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.BENCH_PRIVATE_DIR ?? 'bench/private';
const expectedUnits = (id) => {
  const set = new Set();
  for (const f of ['expected.json', 'expected-b.json']) {
    const p = join(dir, id, f);
    if (existsSync(p)) for (const m of JSON.parse(readFileSync(p, 'utf8')).messages ?? []) for (const u of m.unit_ids) set.add(u);
  }
  return set;
};

for (const arg of process.argv.slice(2)) {
  const i = arg.indexOf('=');
  const files = arg.slice(i + 1).split(',').filter(Boolean);
  const perRun = [];
  for (const f of files) {
    for (const c of JSON.parse(readFileSync(f, 'utf8')).cases) {
      const want = expectedUnits(c.case_id);
      c.runs.forEach((run, r) => {
        const messages = run.proposal?.messages ?? run.draft?.messages ?? [];
        const got = new Set(messages.flatMap((m) => m.unit_ids));
        const lost = [...want].filter((u) => !got.has(u)).length;
        (perRun[r] ??= { lost: 0, want: 0 });
        perRun[r].lost += lost; perRun[r].want += want.size;
      });
    }
  }
  const lost = perRun.reduce((a, x) => a + x.lost, 0); const want = perRun.reduce((a, x) => a + x.want, 0);
  console.log(`${arg.slice(0, i).padEnd(28)} unidades accionables sin mensaje ${lost} de ${want} (${(100 * lost / want).toFixed(2)} %); por repetición ${perRun.map((x) => (100 * x.lost / x.want).toFixed(2)).join('; ')}`);
}
