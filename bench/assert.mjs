// promptfoo JavaScript assertion: scores the proposal with bench/score.js (set arithmetic).
// Passes only if the decomposition is MECE by definition: coverage 1 and no repetition,
// extra message, split point or fused message (report 02, §5.2). The classification is
// reported separately and does not decide the result (MASTER-SPEC §7.11).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score } from './score.js';

const here = dirname(fileURLToPath(import.meta.url));

export default function assertMece(output, context) {
  let run;
  try {
    run = typeof output === 'string' ? JSON.parse(output) : output;
  } catch {
    return { pass: false, score: 0, reason: 'The output is not JSON.' };
  }
  const expected = JSON.parse(readFileSync(join(here, 'cases', context.vars.case, 'expected.json'), 'utf8'));
  const result = score({ units: run.units, expected, actual: run.proposal ?? { messages: [] } });
  const { counts, rates } = result;
  return {
    pass: run.status === 'ok' && result.mece,
    score: rates.coverage,
    namedScores: {
      coverage: rates.coverage,
      repetition: rates.repetition,
      extra: rates.extra,
      split: rates.split,
      fused: rates.fused,
      classification: rates.classification_accuracy ?? 0,
    },
    reason:
      `status ${run.status}; coverage ${counts.covered}/${counts.expected_messages}, repeated ${counts.repeated}, ` +
      `split ${counts.split}, fused ${counts.fused}, extra ${counts.extra}, overlaps ${counts.overlap_units}, ` +
      `holes ${counts.hole_units}, classification ${counts.both_correct}/${counts.units} units`,
  };
}
