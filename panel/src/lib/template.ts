import type { Message, ProposalMessage } from '@team-platform/client'

/** One field a template asks for, as its frontmatter declares it. */
export interface TemplateField {
  name: string
  label: string
  required: boolean
}

/** Types an output entry may take (src/analyze/templates.js, OUTPUT_TYPES). */
export const OUTPUT_TYPES = ['text', 'list', 'number', 'boolean'] as const
export type OutputType = (typeof OUTPUT_TYPES)[number]

/** One entry of the output a template declares (MASTER-SPEC §7.9): what the harness delivers when it works the message. */
export interface TemplateOutputField {
  name: string
  label: string
  type: OutputType
  required: boolean
  enum?: string[]
}

/** The two entries every output carries even when the template does not declare them (UD-255): never edited, never written. */
export const OUTPUT_FIXED = ['summary', 'outcome'] as const

/** Splits `a: 1, b: "x, y", c: [p, q]` on the commas that are not inside quotes or brackets. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote = ''
  let depth = 0
  let escaped = false
  for (const ch of text) {
    if (quote) {
      // Inside double quotes a backslash escapes the next character (JSON strings written by buildTemplate).
      if (escaped) escaped = false
      else if (ch === '\\' && quote === '"') escaped = true
      else if (ch === quote) quote = ''
      current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === '[') {
      depth++
      current += ch
    } else if (ch === ']') {
      depth--
      current += ch
    } else if (ch === ',' && depth === 0) {
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
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
    try {
      return JSON.parse(t) as string
    } catch {
      return t.slice(1, -1)
    }
  }
  return t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'" ? t.slice(1, -1) : t
}

/**
 * The fields declared in the frontmatter of a template file (MASTER-SPEC §7.9):
 * `- { name: steps, label: Pasos para reproducir, required: true }`, one per line under `fields:`.
 * Anything that does not read as a field is skipped; the server validates the file itself.
 */
export function parseTemplateFields(markdown: string): TemplateField[] {
  return (flowEntries(markdown, 'fields') ?? []).filter((e) => e.name).map((e) => ({ name: e.name, label: e.label || e.name, required: e.required === 'true' }))
}

/** The flow entries `- { … }` under `key:` in the frontmatter, as raw text values; null when the key is absent. */
function flowEntries(markdown: string, key: string): Record<string, string>[] | null {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return null
  const end = lines.indexOf('---', 1)
  const front = lines.slice(1, end === -1 ? undefined : end)
  const start = front.findIndex((l) => new RegExp(`^${key}:\\s*(\\[\\s*\\])?\\s*$`).test(l))
  if (start === -1) return null
  const entries: Record<string, string>[] = []
  for (const line of front.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const flow = /^\s*-\s*\{(.*)\}\s*$/.exec(line)
    if (!flow) continue
    const entry: Record<string, string> = {}
    for (const pair of splitTopLevel(flow[1])) {
      const colon = pair.indexOf(':')
      if (colon > 0) entry[pair.slice(0, colon).trim()] = pair.slice(colon + 1).trim()
    }
    entries.push(Object.fromEntries(Object.entries(entry).map(([k, v]) => [k, k === 'enum' ? v : unquote(v)])))
  }
  return entries
}

/** `[a, "b, c"]` → ['a', 'b, c']. */
function flowList(text: string): string[] {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '')
  return splitTopLevel(inner).map(unquote).filter((v) => v !== '')
}

/**
 * The output block of a template file (MASTER-SPEC §7.9), one `- { name, label, type, required, enum? }` per line under
 * `output:`. Null when the template declares no output. The fixed `summary` and `outcome` are not in the list: they are not
 * declared. The server validates the file itself.
 */
export function parseTemplateOutput(markdown: string): TemplateOutputField[] | null {
  const entries = flowEntries(markdown, 'output')
  if (entries === null) return null
  return entries
    .filter((e) => e.name)
    .map((e) => {
      const type = (OUTPUT_TYPES as readonly string[]).includes(e.type) ? (e.type as OutputType) : 'text'
      const out: TemplateOutputField = { name: e.name, label: e.label || e.name, type, required: e.required === 'true' }
      if (e.enum) out.enum = flowList(e.enum)
      return out
    })
}

/** The instructions to the model: what follows the frontmatter, without the delimiters. */
export function templateInstructions(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  if (lines[0]?.trim() !== '---') return markdown.trim()
  const end = lines.indexOf('---', 1)
  return (end === -1 ? '' : lines.slice(end + 1).join('\n')).trim()
}

/** A schema key for a new field, from its label: lowercase ASCII with underscores, unique among `taken`. A key is a name, not a reading of the text. */
export function fieldKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const base =
    label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '')
      .slice(0, 40) || 'field'
  let key = base
  for (let n = 2; used.has(key); n++) key = `${base}_${n}`
  return key
}

/**
 * The file a template is stored as (MASTER-SPEC §7.9), built from the parts the panel edits: a form, never
 * the file itself. Strings go in double quotes with JSON escapes, which is valid YAML.
 */
export function buildTemplate({ name, description, fields, output = null, instructions }: { name: string; description: string; fields: readonly TemplateField[]; output?: readonly TemplateOutputField[] | null; instructions: string }): string {
  const q = (v: string) => JSON.stringify(v)
  const list = fields.length === 0 ? ['fields: []'] : ['fields:', ...fields.map((f) => `  - { name: ${f.name}, label: ${q(f.label)}, required: ${f.required} }`)]
  const enumOf = (o: TemplateOutputField) => (o.enum && o.enum.length > 0 ? `, enum: [${o.enum.map(q).join(', ')}]` : '')
  const out = output === null ? [] : output.length === 0 ? ['output: []'] : ['output:', ...output.map((o) => `  - { name: ${o.name}, label: ${q(o.label)}, type: ${o.type}, required: ${o.required}${enumOf(o)} }`)]
  return ['---', `name: ${q(name)}`, `description: ${q(description)}`, ...list, ...out, '---', instructions.trim(), ''].join('\n')
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
