// Aserción JavaScript de promptfoo: puntúa la propuesta con bench/score.js (aritmética de conjuntos).
// Pasa sólo si la descomposición es MECE por definición: cobertura 1 y ninguna repetición,
// mensaje de más, punto partido ni mensaje fusionado (informe 02, §5.2). La clasificación se
// informa aparte y no decide el resultado (MASTER-SPEC §7.11).
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
    return { pass: false, score: 0, reason: 'La salida no es JSON.' };
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
      `estado ${run.status}; cobertura ${counts.covered}/${counts.expected_messages}, repetidos ${counts.repeated}, ` +
      `partidos ${counts.split}, fusionados ${counts.fused}, de más ${counts.extra}, solapes ${counts.overlap_units}, ` +
      `huecos ${counts.hole_units}, clasificación ${counts.both_correct}/${counts.units} unidades`,
  };
}
