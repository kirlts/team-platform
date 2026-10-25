// Test project of the bank: 4 areas, each with the template of the initial set, and the fictional team of bench/fixtures.json.
import { loadFixtures } from '../lib.js';
import { AREA_IDS } from './cases.js';

export async function loadEnvioFixtures() {
  const all = await loadFixtures();
  return {
    ...all,
    areas: all.areas.filter((a) => AREA_IDS.includes(a.id)),
    templates: all.templates.filter((t) => AREA_IDS.includes(t.area_id)),
  };
}
