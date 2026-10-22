// Progress text (MASTER-SPEC §7.10, H-3722). Every progress event of the server carries a stable `code` of its catalogue
// (`src/domain/progress-phrases.js`) with its numeric `vars`, and the phrase already written in the author's language. The
// panel translates by `code` into the language of the account; an event without a code it knows (a server older than the
// codes, an extractor of a third party) is shown as the server wrote it. Nothing here reads the text of the phrase.
import type { MessageKey } from '@/i18n'

type Vars = Record<string, number>

/** Code of the server catalogue → key of the panel catalogue. `ui-voice.test.ts` checks that every code has one. */
export const PROGRESS_KEYS: Record<string, MessageKey> = {
  classify: 'progress.classify',
  classified: 'progress.classified',
  secondRead: 'progress.secondRead',
  decompose: 'progress.decompose',
  decomposeN: 'progress.decomposeN',
  groupDone: 'progress.groupDone',
  validate: 'progress.validate',
  fix: 'progress.fix',
  fixN: 'progress.fixN',
  proposalReady: 'progress.proposalReady',
  prepare: 'progress.prepare',
  claudeCode: 'progress.claudeCode',
  imagePrepare: 'progress.imagePrepare',
  imageDescribe: 'progress.imageDescribe',
  imageDone: 'progress.imageDone',
  linkDownload: 'progress.linkDownload',
  linkDownloaded: 'progress.linkDownloaded',
  linkMain: 'progress.linkMain',
  linkConverted: 'progress.linkConverted',
  docRead: 'progress.docRead',
  docReadDone: 'progress.docReadDone',
  docConverted: 'progress.docConverted',
  audioMeasure: 'progress.audioMeasure',
  transcribeN: 'progress.transcribeN',
  transcribeChunk: 'progress.transcribeChunk',
  videoMeasure: 'progress.videoMeasure',
  framesExtract: 'progress.framesExtract',
  framesExtracted: 'progress.framesExtracted',
  framesCompared: 'progress.framesCompared',
  framesDescribe: 'progress.framesDescribe',
  framesDescribed: 'progress.framesDescribed',
  attachment: 'progress.attachment',
  attachmentN: 'progress.attachmentN',
  waiting: 'progress.waiting',
  retry: 'progress.retry',
  review: 'progress.review',
  done: 'progress.done',
  answered: 'progress.answered',
  queued: 'analysis.queued',
  analyzing: 'analysis.analyzing',
  published: 'progress.published',
}

/** The catalogue key of a code, or null when the panel does not know it. */
export function progressKey(code: string | null | undefined): MessageKey | null {
  return code && Object.hasOwn(PROGRESS_KEYS, code) ? PROGRESS_KEYS[code] : null
}

/** A progress notice as the server sends it: the phrase, and since H-3722 its code and variables. */
export interface ProgressNotice {
  phrase?: string | null
  code?: string | null
  vars?: Vars | null
}

/** The notice in the language of the account; without a known code, the phrase as the server wrote it. */
export function progressText(notice: ProgressNotice, t: (key: MessageKey, vars?: Vars) => string): string {
  const key = progressKey(notice.code)
  return key ? t(key, notice.vars ?? {}) : (notice.phrase ?? '')
}
