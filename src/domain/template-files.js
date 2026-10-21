// File copy of the edited templates, in the volume: DATA_DIR/templates/area-<id>/template-<id>.md.
// The database is the source (MASTER-SPEC §7.9: `templates` table); the copy keeps the templates readable and goes into
// the backup with attachments (`scripts/backup.sh`, WITH_FILES=1). If the write fails, saving does not stop.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const routePath = (config, areaId, templateId) => path.join(config.editedTemplatesDir, `area-${areaId}`, `template-${templateId}.md`)

export function mirrorTemplate (config, t) {
  const target = routePath(config, t.area_id, t.id)
  mkdirSync(path.dirname(target), { recursive: true })
  const tmpFile = `${target}.parcial`
  writeFileSync(tmpFile, t.body_markdown)
  renameSync(tmpFile, target) // atomic: a backup never sees a half-written file
}

export function removeTemplateMirror (config, areaId, templateId) {
  rmSync(routePath(config, areaId, templateId), { force: true })
}
