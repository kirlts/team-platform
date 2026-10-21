// Aserción JavaScript de promptfoo: puntúa la propuesta con bench/score.js (aritmética de conjuntos).
// Pasa sólo si la descomposición es MECE por definición: cobertura 1 y ninguna repetición,
// mensaje de más, punto partido ni mensaje fusionado (informe 02, §5.2).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { score } from './score.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (caseId, name) => JSON.parse(readFileSync(join(here, 'cases', caseId, name), 'utf8'));

export default function assertMece(output, context) {
  const caseId = context.vars.case;
  let actual;
  try {
    actual = typeof output === 'string' ? JSON.parse(output) : output;
  } catch {
    return { pass: false, score: 0, reason: 'La salida no es JSON.' };
  }
  const input = read(caseId, 'input.json');
  const expected = read(caseId, 'expected.json');
  const result = score({ units: input.units, expected, actual });
  const { counts, rates } = result;
  return {
    pass: result.mece,
    score: rates.coverage,
    namedScores: {
      coverage: rates.coverage,
      repetition: rates.repetition,
      extra: rates.extra,
      split: rates.split,
      fused: rates.fused,
    },
    reason:
      `cobertura ${counts.covered}/${counts.expected_messages}, repetidos ${counts.repeated}, partidos ${counts.split}, ` +
      `fusionados ${counts.fused}, de más ${counts.extra}, solapes ${counts.overlap_units}, huecos ${counts.hole_units}`,
  };
}
