// Initial set of areas and templates (MASTER-SPEC §1.1 and §7.9): seeded on install and can be
// edited or deleted. The ids are consecutive from 1; the real database assigns its own.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTemplate } from './templates.js';

export const DEFAULT_TEMPLATES_DIR = fileURLToPath(new URL('../../templates/', import.meta.url));

/**
 * Reads `templates/areas.json` and the template files it lists.
 * @returns {Promise<{areas: object[], templates: object[]}>}
 */
export async function loadSeed(dir = DEFAULT_TEMPLATES_DIR) {
  const manifest = JSON.parse(await readFile(join(dir, 'areas.json'), 'utf8'));
  const areas = [];
  const templates = [];
  for (const [i, entry] of manifest.entries()) {
    // The id follows the file order; `position` (optional) is the order in which the catalog lists the areas in the prompt and the panel.
    const area = { id: i + 1, title: entry.title, description: entry.description, position: Number.isInteger(entry.position) ? entry.position : i + 1 };
    areas.push(area);
    const markdown = await readFile(join(dir, entry.template), 'utf8');
    const parsed = parseTemplate(markdown, { source: entry.template });
    templates.push({ id: i + 1, area_id: area.id, name: parsed.name, description: parsed.description, body_markdown: markdown });
  }
  return { areas, templates };
}
