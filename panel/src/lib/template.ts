import type { Message, ProposalMessage } from './types'

/** One field a template asks for, as its frontmatter declares it. */
export interface TemplateField {
  name: string
  label: string
  required: boolean
}

/** Splits `a: 1, b: "x, y"` on the commas that are not inside quotes. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote = ''
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = ''
      current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === ',') {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  return parts
}

const unquote = (v: string) => {
  const t = v.trim()
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0] ? t.slice(1, -1) : t
}

/**
 * The fields declared in the frontmatter of a template file (MASTER-SPEC §7.9):
 * `- { name: steps, label: Pasos para reproducir, required: true }`, one per line under `fields:`.
 * Anything that does not read as a field is skipped; the server validates the file itself.
 */
export function parseTemplateFields(markdown: string): TemplateField[] {
  const lines = markdown.split('\n')
  if (lines[0]?.trim() !== '---') return []
  const end = lines.indexOf('---', 1)
  const front = lines.slice(1, end === -1 ? undefined : end)
  const start = front.findIndex((l) => /^fields:\s*$/.test(l))
  if (start === -1) return []
  const fields: TemplateField[] = []
  for (const line of front.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const flow = /^\s*-\s*\{(.*)\}\s*$/.exec(line)
    if (!flow) continue
    const entry: Record<string, string> = {}
    for (const pair of splitTopLevel(flow[1])) {
      const colon = pair.indexOf(':')
      if (colon > 0) entry[pair.slice(0, colon).trim()] = unquote(pair.slice(colon + 1))
    }
    if (entry.name) fields.push({ name: entry.name, label: entry.label || entry.name, required: entry.required === 'true' })
  }
  return fields
}

/**
 * The values a message keeps when its area (and so its template) changes: the fields whose names
 * the new template also has keep their value; the rest are dropped; the new template's other fields
 * start empty so the person sees them, required or not, and fills them in place.
 */
export function remapFields(old: Record<string, string | null> | null | undefined, next: readonly TemplateField[]): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const f of next) out[f.name] = old?.[f.name] ?? ''
  return out
}

/** Names of the required fields that are empty. */
export function missingRequired(fields: Record<string, string | null> | null | undefined, template: readonly TemplateField[]): string[] {
  return template.filter((f) => f.required && !(fields?.[f.name] ?? '').trim()).map((f) => f.name)
}

export type WithFields = Pick<ProposalMessage | Message, 'fields'>
