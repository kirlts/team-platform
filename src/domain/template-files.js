// Copia en archivos de las plantillas editadas, en el volumen: DATA_DIR/templates/area-<id>/template-<id>.md.
// La base es la fuente (MASTER-SPEC §7.9: tabla `templates`); la copia deja las plantillas legibles y entra en el
// respaldo con adjuntos (`scripts/backup.sh`, WITH_FILES=1). Si falla la escritura el guardado no se detiene.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const routePath = (config, areaId, templateId) => path.join(config.editedTemplatesDir, `area-${areaId}`, `template-${templateId}.md`)

export function mirrorTemplate (config, t) {
  const target = routePath(config, t.area_id, t.id)
  mkdirSync(path.dirname(target), { recursive: true })
  const tmpFile = `${target}.parcial`
  writeFileSync(tmpFile, t.body_markdown)
  renameSync(tmpFile, target) // atómico: un respaldo nunca ve un archivo a medio escribir
}

export function removeTemplateMirror (config, areaId, templateId) {
  rmSync(routePath(config, areaId, templateId), { force: true })
}
