// H-1000: hypotheses 1 and 2 together.
import { additions as a4, rule as r4 } from './v4-tramo.mjs';
import { additions as a5, rule as r5 } from './v5-estado.mjs';
import { addBorder } from './_lib.mjs';
const merged = Object.fromEntries([...new Set([...Object.keys(a4), ...Object.keys(a5)])].map((k) => [k, [a4[k], a5[k]].filter(Boolean).join(' ')]));
export default {
  areas: (areas) => addBorder(areas, merged),
  instructions: (text) => `${text}\n11. ${r4}\n12. ${r5}`,
};
