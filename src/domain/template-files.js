// Copia en archivos de las plantillas editadas, en el volumen: DATA_DIR/templates/area-<id>/template-<id>.md.
// La base es la fuente (MASTER-SPEC §7.9: tabla `templates`); la copia deja las plantillas legibles y entra en el
// respaldo con adjuntos (`scripts/backup.sh`, WITH_FILES=1). Si falla la escritura el guardado no se detiene.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ruta = (config, areaId, templateId) => path.join(config.editedTemplatesDir, `area-${areaId}`, `template-${templateId}.md`)

export function mirrorTemplate (config, t) {
  const destino = ruta(config, t.area_id, t.id)
  mkdirSync(path.dirname(destino), { recursive: true })
  const temporal = `${destino}.parcial`
  writeFileSync(temporal, t.body_markdown)
  renameSync(temporal, destino) // atómico: un respaldo nunca ve un archivo a medio escribir
}

export function removeTemplateMirror (config, areaId, templateId) {
  rmSync(ruta(config, areaId, templateId), { force: true })
}
