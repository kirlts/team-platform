// Progress phrases (MASTER-SPEC §7.10, H-3722). Every progress event carries a stable `code` (with its numeric `vars`) and
// the phrase written in the language of the author of the input (UD-018). The panel translates by `code`; the phrase is
// what a client without a catalogue shows. Emitters name a step with `step(code, vars)` and never write the text.
//
// `codeOfPhrase` reads a phrase written before the codes existed (rows of `job_events` from older versions, an extractor
// of a third party that still sends text) and recovers its code. It is compatibility with old data, not interpretation of
// what a person wrote: the phrases are this catalogue's own texts.

import { DEFAULT_LANGUAGE } from './language.js'

const both = (es, en) => ({ 'es-419': es, en })

export const PROGRESS_PHRASES = Object.freeze({
  queued: both('En cola', 'Queued'),
  analyzing: both('Analizando', 'Analyzing'),
  attachment: both('Lectura de adjunto', 'Attachment reading'),
  attachmentN: both('Lectura de adjunto {n} de {total}', 'Attachment {n} of {total}: reading'),
  classify: both('Clasificación', 'Classification'),
  classified: both('Clasificado', 'Classified'),
  secondRead: both('Segunda lectura', 'Second read'),
  review: both('Revisión de lo apartado', 'Review of set-aside parts'),
  decompose: both('Descomposición', 'Decomposition'),
  decomposeN: both('Descomposición: {n} grupos', 'Decomposition: {n} groups'),
  groupDone: both('Grupo descompuesto', 'Group decomposed'),
  validate: both('Validación de la propuesta', 'Proposal validation'),
  fix: both('Corrección de la propuesta', 'Proposal correction'),
  fixN: both('Corrección: {n} unidades en conflicto', 'Correction: {n} conflicting units'),
  proposalReady: both('Propuesta lista', 'Proposal ready'),
  published: both('Publicado', 'Published'),
  prepare: both('Preparación', 'Preparation'),
  claudeCode: both('Análisis con Claude Code', 'Analysis with Claude Code'),
  imagePrepare: both('Preparación de la imagen', 'Image preparation'),
  imageDescribe: both('Descripción de la imagen', 'Image description'),
  imageDone: both('Imagen descrita', 'Image described'),
  linkDownload: both('Descarga del enlace', 'Link download'),
  linkDownloaded: both('Enlace descargado', 'Link downloaded'),
  linkMain: both('Contenido principal leído', 'Main content read'),
  linkConverted: both('Enlace convertido', 'Link converted'),
  docRead: both('Lectura del documento', 'Document reading'),
  docReadDone: both('Documento leído', 'Document read'),
  docConverted: both('Documento convertido', 'Document converted'),
  audioMeasure: both('Medición del audio', 'Audio measurement'),
  transcribeN: both({ one: 'Transcripción: {n} trozo', other: 'Transcripción: {n} trozos' }, { one: 'Transcription: {n} chunk', other: 'Transcription: {n} chunks' }),
  transcribeChunk: both('Transcripción: trozo {n} de {total}', 'Transcription: chunk {n} of {total}'),
  videoMeasure: both('Medición del video', 'Video measurement'),
  framesExtract: both('Extracción de fotogramas', 'Frame extraction'),
  framesExtracted: both('Fotogramas extraídos', 'Frames extracted'),
  framesCompared: both('Fotogramas comparados', 'Frames compared'),
  framesDescribe: both('Descripción de fotogramas', 'Frame description'),
  framesDescribed: both('Fotogramas descritos', 'Frames described'),
  waiting: both('En espera: cupo de transcripción', 'On hold: transcription quota'),
  budgetWait: both('En espera: tope diario de gasto', 'On hold: daily spend cap'),
  retry: both('Intento {n} de {total} fallido; se reintenta', 'Attempt {n} of {total} failed; retrying'),
  done: both('Listo', 'Done'),
  answered: both('Respondido', 'Replied')
})

export const PROGRESS_CODES = Object.freeze(Object.keys(PROGRESS_PHRASES))

/** A step of progress: its code and numeric variables. An unknown code is a programming error and throws. */
export function step (code, vars = {}) {
  if (!(code in PROGRESS_PHRASES)) throw new Error(`Unknown progress code: ${code}`)
  return Object.freeze({ code, vars: Object.freeze({ ...vars }) })
}

export const isStep = (value) => Boolean(value && typeof value === 'object' && typeof value.code === 'string' && value.code in PROGRESS_PHRASES)

const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''))

/** The phrase of a code in a language; an unknown language falls back to the default (UD-018). */
export function renderPhrase (code, vars = {}, language = DEFAULT_LANGUAGE) {
  const entry = PROGRESS_PHRASES[code]
  if (!entry) return null
  const message = entry[language] ?? entry[DEFAULT_LANGUAGE]
  return fill(typeof message === 'string' ? message : message[vars.n === 1 ? 'one' : 'other'], vars)
}

/** A step or a legacy text, as the phrase in a language. */
export const phraseOf = (value, language = DEFAULT_LANGUAGE) => (isStep(value) ? renderPhrase(value.code, value.vars, language) : value ?? null)

/** A stable key of a step or a text: two equal notices are not written twice. */
export const keyOf = (value) => (isStep(value) ? `${value.code}:${JSON.stringify(value.vars)}` : value ?? null)

// Every rendering of every code, in both languages, as an anchored pattern with its variables. Built once.
const LEGACY = []
for (const [code, entry] of Object.entries(PROGRESS_PHRASES)) {
  for (const message of Object.values(entry)) {
    for (const template of typeof message === 'string' ? [message] : [message.one, message.other]) {
      const names = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
      const source = template.split(/\{\w+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(\\d+)')
      LEGACY.push({ code, names, pattern: new RegExp(`^${source}$`) })
    }
  }
}

/** The code of a phrase written without one (an old event), or null when it is not one of the catalogue's texts. */
export function codeOfPhrase (phrase) {
  if (typeof phrase !== 'string') return null
  for (const { code, names, pattern } of LEGACY) {
    const m = pattern.exec(phrase)
    if (m) return { code, vars: Object.fromEntries(names.map((name, i) => [name, Number(m[i + 1])])) }
  }
  return null
}
