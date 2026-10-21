// The progress phrases the server writes (analyze, extract and the pipeline) are fixed Spanish texts that
// carry no code. The panel shows them in the language of the account by mapping each one to a catalogue
// key. `ui-voice.test.ts` checks that every phrase the server can write has an entry here (H-1502).
import type { MessageKey } from '@/i18n'

type Vars = Record<string, number>
type Entry = { key: MessageKey; pattern: RegExp; vars: string[] }

const entries: Entry[] = [
  { key: 'progress.classify', pattern: /^Clasificación$/, vars: [] },
  { key: 'progress.classified', pattern: /^Clasificado$/, vars: [] },
  { key: 'progress.secondRead', pattern: /^Segunda lectura$/, vars: [] },
  { key: 'progress.decompose', pattern: /^Descomposición$/, vars: [] },
  { key: 'progress.decomposeN', pattern: /^Descomposición: (\d+) grupos$/, vars: ['n'] },
  { key: 'progress.groupDone', pattern: /^Grupo descompuesto$/, vars: [] },
  { key: 'progress.validate', pattern: /^Validación de la propuesta$/, vars: [] },
  { key: 'progress.fix', pattern: /^Corrección de la propuesta$/, vars: [] },
  { key: 'progress.fixN', pattern: /^Corrección: (\d+) unidades en conflicto$/, vars: ['n'] },
  { key: 'progress.proposalReady', pattern: /^Propuesta lista$/, vars: [] },
  { key: 'progress.prepare', pattern: /^Preparación$/, vars: [] },
  { key: 'progress.claudeCode', pattern: /^Análisis con Claude Code$/, vars: [] },
  { key: 'progress.imagePrepare', pattern: /^Preparación de la imagen$/, vars: [] },
  { key: 'progress.imageDescribe', pattern: /^Descripción de la imagen$/, vars: [] },
  { key: 'progress.imageDone', pattern: /^Imagen descrita$/, vars: [] },
  { key: 'progress.linkDownload', pattern: /^Descarga del enlace$/, vars: [] },
  { key: 'progress.linkDownloaded', pattern: /^Enlace descargado$/, vars: [] },
  { key: 'progress.linkMain', pattern: /^Contenido principal leído$/, vars: [] },
  { key: 'progress.linkConverted', pattern: /^Enlace convertido$/, vars: [] },
  { key: 'progress.docRead', pattern: /^Lectura del documento$/, vars: [] },
  { key: 'progress.docReadDone', pattern: /^Documento leído$/, vars: [] },
  { key: 'progress.docConverted', pattern: /^Documento convertido$/, vars: [] },
  { key: 'progress.audioMeasure', pattern: /^Medición del audio$/, vars: [] },
  { key: 'progress.transcribeN', pattern: /^Transcripción: (\d+) trozos?$/, vars: ['n'] },
  { key: 'progress.transcribeChunk', pattern: /^Transcripción: trozo (\d+) de (\d+)$/, vars: ['n', 'total'] },
  { key: 'progress.videoMeasure', pattern: /^Medición del video$/, vars: [] },
  { key: 'progress.framesExtract', pattern: /^Extracción de fotogramas$/, vars: [] },
  { key: 'progress.framesExtracted', pattern: /^Fotogramas extraídos$/, vars: [] },
  { key: 'progress.framesCompared', pattern: /^Fotogramas comparados$/, vars: [] },
  { key: 'progress.framesDescribe', pattern: /^Descripción de fotogramas$/, vars: [] },
  { key: 'progress.framesDescribed', pattern: /^Fotogramas descritos$/, vars: [] },
  { key: 'progress.attachment', pattern: /^Lectura de adjunto$/, vars: [] },
  { key: 'progress.attachmentN', pattern: /^Lectura de adjunto (\d+) de (\d+)$/, vars: ['n', 'total'] },
  { key: 'progress.waiting', pattern: /^En espera: cupo de transcripción$/, vars: [] },
  { key: 'progress.retry', pattern: /^Intento (\d+) de (\d+) fallido; se reintenta$/, vars: ['n', 'total'] },
  { key: 'progress.review', pattern: /^Revisión de lo apartado$/, vars: [] },
  { key: 'progress.done', pattern: /^Listo$/, vars: [] },
  { key: 'analysis.queued', pattern: /^En cola$/, vars: [] },
  { key: 'analysis.analyzing', pattern: /^Analizando$/, vars: [] },
]

/** The catalogue key and variables of a server phrase, or null when the panel does not know it. */
export function progressKey(phrase: string): { key: MessageKey; vars: Vars } | null {
  for (const entry of entries) {
    const m = entry.pattern.exec(phrase)
    if (!m) continue
    const vars: Vars = {}
    entry.vars.forEach((name, i) => (vars[name] = Number(m[i + 1])))
    return { key: entry.key, vars }
  }
  return null
}

/** The phrase in the language of the account; an unknown phrase is shown as the server wrote it. */
export function progressText(phrase: string, t: (key: MessageKey, vars?: Vars) => string): string {
  const known = progressKey(phrase)
  return known ? t(known.key, known.vars) : phrase
}
