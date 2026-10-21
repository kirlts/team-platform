// Juego inicial de áreas y plantillas (MASTER-SPEC §1.1 y §7.9): se siembra al instalar y se puede
// editar o borrar. Los ids son consecutivos desde 1; la base real asigna los suyos.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTemplate } from './templates.js';

export const DEFAULT_TEMPLATES_DIR = fileURLToPath(new URL('../../templates/', import.meta.url));

/**
 * Lee `templates/areas.json` y los archivos de plantilla que enumera.
 * @returns {Promise<{areas: object[], templates: object[]}>}
 */
export async function loadSeed(dir = DEFAULT_TEMPLATES_DIR) {
  const manifest = JSON.parse(await readFile(join(dir, 'areas.json'), 'utf8'));
  const areas = [];
  const templates = [];
  for (const [i, entry] of manifest.entries()) {
    const area = { id: i + 1, title: entry.title, description: entry.description, position: i + 1 };
    areas.push(area);
    const markdown = await readFile(join(dir, entry.template), 'utf8');
    const parsed = parseTemplate(markdown, { source: entry.template });
    templates.push({ id: i + 1, area_id: area.id, name: parsed.name, description: parsed.description, body_markdown: markdown });
  }
  return { areas, templates };
}
