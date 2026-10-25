// Screenshots of the interface in the replies of an `execute` session (UD-268, MASTER-SPEC §7.5 «Capturas»). The first reply (posted by the session
// with `team reply --captures`) carries the «before»; the closing reply carries the «after» next to that same «before». The session declares
// `captures` in its structured output; the files live in the job's `captures/` directory, which is deleted when the job ends, so the worker
// stores them in the volume while the directory exists and the closing reply attaches them later (also from the `deliver` job).
//
// The platform does not read images. What it checks is the form (type by first bytes, size, count, a path inside the directory) and what the
// tool declares: `masked`. See `checkCaptures` in scripts/team.mjs, which the `team` command shares.

import { createReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { all, get } from '../db/index.js'
import { captureLabels, captureName, checkCaptures } from '../../scripts/team.mjs'
import { blobPath, commit, ingest } from '../domain/storage.js'

/** The directory of a job where the session leaves its screenshots. */
export const capturesDir = (workdir) => join(workdir, 'captures')

/** The environment `team` and the screenshot tool read (UD-268). */
export function capturesEnv (config, workdir, language) {
  const c = config.execute.captures
  return {
    TEAM_CAPTURES_DIR: capturesDir(workdir), TEAM_CAPTURES_MAX: String(c.max), TEAM_CAPTURES_MAX_BYTES: String(config.uploads.maxImageBytes),
    TEAM_CAPTURES_OPEN_ZONE: c.openZone, TEAM_CAPTURES_UNMASKED: c.unmasked ? 'allowed' : 'denied', TEAM_LANGUAGE: language ?? 'es-419'
  }
}

/**
 * Checks the `captures` of the final output and stores the accepted files in the volume. Returns { stored, rejected }; `stored` items are
 * { sha256, size, mime, ext, alt, place, as, masked }. Never throws for a capture that does not comply: it is left out and `rejected` says why.
 */
export async function storeCaptures ({ config, output, workdir }) {
  const list = output?.captures
  if (!Array.isArray(list) || list.length === 0) return { stored: [], rejected: [] }
  const x = config.execute.captures
  const { accepted, rejected } = await checkCaptures(list, { dir: capturesDir(workdir), max: x.max, maxBytes: config.uploads.maxImageBytes, maxVideoBytes: config.uploads.maxVideoBytes, zone: output.zone ?? null, openZone: x.openZone, unmasked: x.unmasked })
  const stored = []
  for (const c of accepted) {
    try {
      const { tmp, sha256, size } = await ingest(config, createReadStream(c.file), { maxBytes: c.kind === 'video' ? config.uploads.maxVideoBytes : config.uploads.maxImageBytes, tooLargeMessage: 'La captura supera el tamaño máximo.' })
      await commit(config, tmp, sha256)
      stored.push({ sha256, size, mime: c.mime, ext: c.ext, kind: c.kind ?? 'image', alt: c.alt, place: c.place, as: c.as, masked: c.masked })
    } catch {
      rejected.push({ index: c.index, reason: 'not_stored' })
    }
  }
  return { stored, rejected }
}

/**
 * What the closing reply adds: the «before» (the images of the last reply of this agent that carries them, reused from the volume, no copy)
 * and the «after» (the stored ones; `label: 'proposal'` for a held delivery, UD-275: what the branch looks like, a video included), each named «<Label> - <alt>», plus one line per «after» with its place and the role it was seen as.
 * Returns { files, lines }; both empty when the session declared no «after».
 */
export function closingCaptures (db, { messageId, authorId, stored, language, label = 'after' }) {
  if (!stored?.length) return { files: [], lines: [] }
  const labels = captureLabels(language)
  const names = [...new Set(Object.values({ es: captureLabels('es-419'), en: captureLabels('en') }).map((l) => `${l.before} - %`))]
  const before = all(db, `SELECT ra.reply_id, ra.name, ra.mime, ra.size, ra.sha256 FROM reply_attachments ra JOIN replies r ON r.id = ra.reply_id
      WHERE r.message_id = ? AND r.author_id = ? AND r.deleted_at IS NULL AND ra.kind = 'image' AND (${names.map(() => 'ra.name LIKE ?').join(' OR ')})
      ORDER BY ra.reply_id DESC, ra.position, ra.id`, messageId, authorId, ...names)
  const last = before[0]?.reply_id
  const files = before.filter((b) => b.reply_id === last).reverse().map((b) => ({ kind: 'image', name: b.name, mime: b.mime, size: b.size, sha256: b.sha256 }))
  const lines = []
  for (const c of stored) {
    files.push({ kind: c.kind ?? 'image', name: captureName(labels[label], c.alt, c.ext), mime: c.mime, size: c.size, sha256: c.sha256 })
    lines.push(`**${labels[label]}**: ${c.alt}. ${c.place}, ${c.as}.`)
  }
  return { files, lines }
}

/** Width and height of a PNG from its header (bytes 16 to 24); null when the file is not a PNG. */
async function pngSize (file) {
  let handle
  try {
    handle = await open(file, 'r')
    const head = Buffer.alloc(24)
    await handle.read(head, 0, 24, 0)
    if (!head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) }
  } catch { return null } finally { await handle?.close() }
}

/** Whether a reply of this agent in the message carries a «before» capture (the attachments named «Antes - …» or «Before - …»). */
export function hasBefore (db, { messageId, authorId }) {
  const names = [...new Set(Object.values({ es: captureLabels('es-419'), en: captureLabels('en') }).map((l) => `${l.before} - %`))]
  return Boolean(get(db, `SELECT 1 AS ok FROM reply_attachments ra JOIN replies r ON r.id = ra.reply_id
      WHERE r.message_id = ? AND r.author_id = ? AND r.deleted_at IS NULL AND ra.kind = 'image' AND (${names.map(() => 'ra.name LIKE ?').join(' OR ')}) LIMIT 1`, messageId, authorId, ...names))
}

/**
 * Where the «before» of a message was taken: one { place, as, width, height } per image of the last reply of this agent that carries the «before»
 * (the lines the reply keeps under that label are «<Label>: <alt>. <place>, <as>.»; a place has no comma, the role it was seen as does). The host
 * takes the «after» from production at that same place, as that same role and at that same size (UD-268). Empty when there is no «before».
 */
export async function beforeOfMessage (db, config, { messageId, authorId }) {
  const names = [...new Set(Object.values({ es: captureLabels('es-419'), en: captureLabels('en') }).map((l) => `${l.before} - %`))]
  const rows = all(db, `SELECT ra.reply_id, ra.sha256, r.body FROM reply_attachments ra JOIN replies r ON r.id = ra.reply_id
      WHERE r.message_id = ? AND r.author_id = ? AND r.deleted_at IS NULL AND ra.kind = 'image' AND (${names.map(() => 'ra.name LIKE ?').join(' OR ')})
      ORDER BY ra.reply_id DESC, ra.position, ra.id`, messageId, authorId, ...names)
  const last = rows[0]?.reply_id
  const mine = rows.filter((r) => r.reply_id === last).reverse()
  if (!mine.length) return []
  const labelsAll = Object.values({ es: captureLabels('es-419'), en: captureLabels('en') }).map((l) => l.before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const lineRe = new RegExp(`^\\*\\*(?:${labelsAll.join('|')})\\*\\*: .+\\. ([^,]+), (.+)\\.$`)
  const found = String(mine[0].body ?? '').split('\n').map((l) => l.match(lineRe)).filter(Boolean)
  const out = []
  for (const [i, row] of mine.entries()) {
    const m = found[i]
    if (!m) continue
    out.push({ place: m[1].trim(), as: m[2].trim(), ...((await pngSize(blobPath(config, row.sha256))) ?? {}) })
  }
  return out
}

/** What the delivery command reports about the «after»: `##team capture {json}` lines (a capture it left in $TEAM_WORKDIR/captures) and `##team capture-failed <reason>`. */
export function deliveryCaptureLines (stdout) {
  const list = []
  const failed = []
  for (const line of String(stdout ?? '').split('\n')) {
    const t = line.trim()
    if (t.startsWith('##team capture-failed ')) { failed.push(t.slice('##team capture-failed '.length).slice(0, 300)); continue }
    if (!t.startsWith('##team capture ')) continue
    try { list.push(JSON.parse(t.slice('##team capture '.length))) } catch { /* a line that is not JSON is not a capture */ }
  }
  return { list, failed }
}

const NO_CAPTURE = {
  'es-419': { reason: (r) => `No incluye captura ni video: ${r}.`, none: 'la sesión no dejó ninguna' },
  en: { reason: (r) => `It carries no screenshot or video: ${r}.`, none: 'the session left none' }
}

// The reasons `checkCaptures` gives for leaving a capture out, in plain words for the person who reads the reply.
const REJECTED = {
  'es-419': {
    invalid: 'le faltaba un dato de la captura (ruta, descripción, lugar, rol o si oculta datos)',
    unmasked_sensitive: 'muestra datos de personas sin ocultarlos y esta instancia no permite adjuntarlas',
    missing: 'el archivo no existe',
    outside: 'el archivo está fuera de la carpeta de capturas',
    not_image: 'el archivo no es una imagen ni un video que se pueda adjuntar',
    too_many: 'superó el máximo de capturas de una respuesta',
    too_large: 'el archivo supera el tamaño máximo',
    not_stored: 'no se pudo guardar el archivo',
    other: 'no se pudo adjuntar',
    which: (n) => `la captura ${n}`,
    sentence: (count, list) => `la sesión tomó ${count === 1 ? 'una captura y el sistema no la adjuntó' : `${count} capturas y el sistema no las adjuntó`}: ${list}`,
    extra: (count, list) => `${count === 1 ? 'El sistema no adjuntó una captura' : `El sistema no adjuntó ${count} capturas`}: ${list}.`
  },
  en: {
    invalid: 'a piece of data of the capture was missing (path, description, place, role or whether it hides data)',
    unmasked_sensitive: 'it shows data of people without hiding it and this instance does not allow attaching those',
    missing: 'the file does not exist',
    outside: 'the file is outside the captures folder',
    not_image: 'the file is not an image or a video that can be attached',
    too_many: 'it went over the maximum of captures of a reply',
    too_large: 'the file is over the maximum size',
    not_stored: 'the file could not be saved',
    other: 'it could not be attached',
    which: (n) => `capture ${n}`,
    sentence: (count, list) => `the session took ${count === 1 ? 'one capture and the system did not attach it' : `${count} captures and the system did not attach them`}: ${list}`,
    extra: (count, list) => `${count === 1 ? 'The system did not attach one capture' : `The system did not attach ${count} captures`}: ${list}.`
  }
}

/**
 * The captures the system left out, with what a person needs to tell which one and why: `[{ index, reason, alt, path }]`. `rejected` is what `storeCaptures`
 * returns and `output.captures` the list the session declared (the index points into it). The panel reads alt and reason, never the index.
 */
export function describeRejected (output, rejected) {
  const list = Array.isArray(output?.captures) ? output.captures : []
  return (rejected ?? []).map((r) => ({ index: r.index, reason: r.reason, alt: typeof list[r.index]?.alt === 'string' ? list[r.index].alt.replace(/\s+/g, ' ').trim().slice(0, 120) : '', path: typeof list[r.index]?.path === 'string' ? list[r.index].path : '' }))
}

/**
 * UD-298: a job that changes what a person sees on a screen (`touches_screen`, a field of the session's output the system reads as a boolean) does not close
 * with a final reply that looks complete and shows nothing. When no capture or video is stored the reply says so, with the reason the session gave
 * (`no_capture_reason`) or, without one, that it left none. Empty when the job does not touch a screen or the reply carries at least one.
 * `rejected` (from `describeRejected`): the captures the session did take and the system left out. Then the reason is the true one, which and why, and never «the session left none»;
 * with some stored or no screen touched the same facts go in one line of their own.
 */
export function noCaptureLine (output, storedCount, language, rejected = []) {
  const t = NO_CAPTURE[language] ?? NO_CAPTURE['es-419']
  if (rejected.length > 0) {
    const r = REJECTED[language] ?? REJECTED['es-419']
    const list = rejected.map((x) => `«${x.alt || x.path || r.which(x.index + 1)}» (${r[x.reason] ?? r.other})`).join('; ')
    return output?.touches_screen === true && storedCount === 0 ? t.reason(r.sentence(rejected.length, list)) : r.extra(rejected.length, list)
  }
  if (output?.touches_screen !== true || storedCount > 0) return ''
  const given = typeof output.no_capture_reason === 'string' ? output.no_capture_reason.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '').slice(0, 300) : ''
  return t.reason(given || t.none)
}
