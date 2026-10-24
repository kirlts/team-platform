// promptfoo JavaScript assertion: scores the proposal with bench/score.js (set arithmetic).
// Passes only if the decomposition is MECE by definition: coverage 1 and no repetition,
// extra message, split point or fused message (report 02, §5.2). The classification is
// reported separately and does not decide the result (MASTER-SPEC §7.11).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tellsOfProposal } from './ai-tells.js';
import { score } from './score.js';

const here = dirname(fileURLToPath(import.meta.url));

// A case that declares `max_messages` is a case where the reference is one piece and the model may
// publish up to that many (a feature described in steps). It passes when every unit of the reference
// message is in some published message and there are no more messages than the cap; a split inside
// the cap does not fail it.
function withinCap(expected, proposal, cap) {
  const published = proposal?.messages ?? [];
  const cited = new Set(published.flatMap((m) => m.unit_ids ?? []));
  const covered = expected.messages.every((m) => m.unit_ids.every((id) => cited.has(id)));
  return covered && published.length <= cap;
}

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
  const cap = expected.max_messages;
  // Marks of generated writing per message (UD-019): reported, it does not decide the result.
  const inputText = [run.units?.map((u) => u.text).join('\n') ?? ''].join('');
  const tells = tellsOfProposal(run.proposal ?? { messages: [] }, { input: inputText });
  return {
    pass: run.status === 'ok' && (cap ? withinCap(expected, run.proposal, cap) : result.mece),
    score: rates.coverage,
    namedScores: {
      coverage: rates.coverage,
      repetition: rates.repetition,
      extra: rates.extra,
      split: rates.split,
      fused: rates.fused,
      classification: rates.classification_accuracy ?? 0,
      tells_per_message: tells.perMessage,
    },
    reason:
      `status ${run.status}; coverage ${counts.covered}/${counts.expected_messages}, repeated ${counts.repeated}, ` +
      `split ${counts.split}, fused ${counts.fused}, extra ${counts.extra}, overlaps ${counts.overlap_units}, ` +
      `holes ${counts.hole_units}, classification ${counts.both_correct}/${counts.units} units, ` +
      `${tells.total} marks of generated writing in ${tells.messages} messages`,
  };
}
