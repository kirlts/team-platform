// What each capture declares (UD-268): `{ path, alt, place, as, masked }`. `path` is relative to `$TEAM_CAPTURES_DIR` when the file is inside it;
// `alt` is one line saying what the image shows; `place` is the route or menu that was looked at; `as` is who it was seen as; `masked` says whether the
// tool hid the data of people. The platform checks the form (`checkCaptures` in scripts/team.mjs) and never reads the image: `masked` is this tool's word.
import { resolve, sep } from 'node:path'

/** Every capture ends with a line `LOOK_CAPTURE {json}` on the standard output; the session puts those objects in the `captures` list of its reply. */
export const CAPTURE_MARKER = 'LOOK_CAPTURE'

// The platform keeps the first 120 characters of an alt (ALT_CHARS in scripts/team.mjs, a declared courtesy there); a longer one is cut here the same way.
const ALT_CHARS = 120

/** The path as the declaration carries it: relative to the captures folder of the job when the file is inside it, absolute otherwise. */
export function declaredPath (file, capturesDir) {
  const absolute = resolve(file)
  if (!capturesDir) return absolute
  const root = resolve(capturesDir)
  return absolute.startsWith(`${root}${sep}`) ? absolute.slice(root.length + 1) : absolute
}

/** One line: the title of the page and, when the title does not already say it, its first heading. */
export function defaultAlt (title, heading) {
  const t = String(title ?? '').replace(/\s+/g, ' ').trim()
  const h = String(heading ?? '').split('\n')[0].trim()
  return `${t}${h && !t.includes(h) ? ` · ${h}` : ''}`.slice(0, ALT_CHARS)
}

/** The place of a capture: a menu path as it was given, a route as the page ended up on it (path and query). */
export function placeOf (requested, url) {
  const isRoute = /^[/?#]/.test(requested)
  return requested.includes('>') || !isRoute ? requested : `${url.pathname}${url.search}`
}

/** @returns {{ path: string, alt: string, place: string, as: string, masked: boolean }} */
export function declaration ({ file, capturesDir, alt, place, as, masked }) {
  return { path: declaredPath(file, capturesDir), alt: String(alt).replace(/[\r\n]+/g, ' ').trim().slice(0, ALT_CHARS), place, as, masked: masked === true }
}

export const declarationLine = (captureDeclaration) => `${CAPTURE_MARKER} ${JSON.stringify(captureDeclaration)}`
