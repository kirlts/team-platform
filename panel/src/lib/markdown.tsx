import type { ReactNode } from 'react'
import { splitMentions } from './mention'

// A small markdown renderer (UD-024): headings, paragraphs, bulleted and numbered lists, block quotes,
// fenced code, rules, and inline bold, italic, code and links. It builds React nodes, never HTML, so
// nothing in the source can inject markup, and links only keep http, https and mailto addresses.
// Anything else it does not know is shown as plain text.

const SAFE_LINK = /^(https?:|mailto:)/i

/** Inline spans: `code`, **bold**, *italic* or _italic_, [text](address). */
/** Plain text with the tokens of the members a reply mentions drawn highlighted (UD-277). */
function plain(text: string, mentions: string[], key: string): ReactNode[] {
  if (mentions.length === 0) return [text]
  return splitMentions(text, mentions).map((p, i) => (p.mention ? <mark key={`${key}m${i}`} data-mention className="rounded-sm bg-accent-soft px-1 font-semibold text-accent-deep">{p.text}</mark> : p.text))
}

export function renderInline(text: string, keyBase = 'i', mentions: string[] = []): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*)\*(?!\w)|(?<![\w_])_([^_\s][^_]*)_(?!\w)|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  let n = 0
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0
    if (at > last) out.push(...plain(text.slice(last, at), mentions, `${keyBase}p${n}`))
    const key = `${keyBase}${n++}`
    if (m[1] !== undefined) out.push(<code key={key} className="rounded-sm bg-accent-soft px-1 font-mono text-[0.92em]">{m[1]}</code>)
    else if (m[2] !== undefined) out.push(<strong key={key}>{renderInline(m[2], `${key}b`, mentions)}</strong>)
    else if (m[3] !== undefined || m[4] !== undefined) out.push(<em key={key}>{renderInline((m[3] ?? m[4]) as string, `${key}e`, mentions)}</em>)
    else if (SAFE_LINK.test(m[6])) out.push(<a key={key} href={m[6]} target="_blank" rel="noreferrer" className="text-accent underline">{renderInline(m[5], `${key}l`, mentions)}</a>)
    else out.push(m[0])
    last = at + m[0].length
  }
  if (last < text.length) out.push(...plain(text.slice(last), mentions, `${keyBase}z`))
  return out
}

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'rule' }

/** Splits the source into blocks; exported so the rules can be tested without rendering. */
export function parseBlocks(source: string, { breaks = false }: { breaks?: boolean } = {}): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }
    if (/^```/.test(line)) {
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++])
      i += 1
      blocks.push({ type: 'code', text: body.join('\n') })
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      i += 1
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: 'rule' })
      i += 1
      continue
    }
    const bullet = /^\s*[-*+]\s+/
    const numbered = /^\s*\d+[.)]\s+/
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line)
      const marker = ordered ? numbered : bullet
      const items: string[] = []
      while (i < lines.length && marker.test(lines[i])) items.push(lines[i++].replace(marker, '').trim())
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    if (/^>\s?/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) quoted.push(lines[i++].replace(/^>\s?/, ''))
      blocks.push({ type: 'quote', text: quoted.join(' ') })
      continue
    }
    const para: string[] = [line.trim()]
    i += 1
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*[-*+]\s|\s*\d+[.)]\s|>)/.test(lines[i])) para.push(lines[i++].trim())
    blocks.push({ type: 'paragraph', text: para.join(breaks ? '\n' : ' ') })
  }
  return blocks
}

const HEADING = ['', 'text-lg', 'text-base', 'text-sm', 'text-sm'] as const

/** The source as React nodes. Paragraphs and lists use the shared `prose-block` class (UD-022). */
/** A document a person wrote: the root carries `data-user-text`, which the interface detectors do not judge as interface text. */
export function Markdown({ source, className, breaks = false, mentions = [] }: { source: string; className?: string; /** Names of the members the reply mentions: their «@Name» tokens are drawn highlighted (UD-277). */ mentions?: string[]; /** A line break inside a paragraph stays a line break (replies, written line by line). */ breaks?: boolean }) {
  return (
    <div className={className} data-user-text>
      {parseBlocks(source, { breaks }).map((b, i) => {
        switch (b.type) {
          case 'heading':
            return (
              <p key={i} role="heading" aria-level={b.level + 1} className={`mt-2 font-sans font-semibold first:mt-0 ${HEADING[b.level]}`}>
                {renderInline(b.text, `h${i}`, mentions)}
              </p>
            )
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul'
            return (
              <Tag key={i} className={`my-1.5 pl-5 ${b.ordered ? 'list-decimal' : 'list-disc'}`}>
                {b.items.map((item, j) => (
                  <li key={j} className="prose-block">
                    {renderInline(item, `l${i}-${j}`, mentions)}
                  </li>
                ))}
              </Tag>
            )
          }
          case 'quote':
            return (
              <blockquote key={i} className="prose-block my-1.5 border-l-2 border-line-strong pl-3 text-muted">
                {renderInline(b.text, `q${i}`, mentions)}
              </blockquote>
            )
          case 'code':
            return (
              <pre key={i} className="my-1.5 whitespace-pre-wrap break-words rounded-md bg-accent-soft p-2 font-mono text-xs">
                {b.text}
              </pre>
            )
          case 'rule':
            return <hr key={i} className="my-2 border-line-strong" />
          default:
            return (
              <p key={i} className={`prose-block my-1.5 first:mt-0${breaks ? ' whitespace-pre-line' : ''}`}>
                {renderInline(b.text, `p${i}`, mentions)}
              </p>
            )
        }
      })}
    </div>
  )
}
