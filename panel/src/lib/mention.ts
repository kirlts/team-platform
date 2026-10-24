// The «@» of a reply (UD-277). These functions only serve the list that opens while the person types: where the word they are writing starts, what it
// looks like once a member is picked, and which of the picked members the text still shows. The mention itself is the list of ids the person picked: the
// server never reads names out of the text.

/** The word being typed at `caret` when it starts with «@» at the beginning of the text or after a space: `{ start, query }`, or null. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1])) return null
  const query = before.slice(at + 1)
  if (/[\s@]/.test(query)) return null
  return { start: at, query }
}

/** The text with the word being typed replaced by the token of the member («@Name» and a space) and the caret after it. */
export function insertMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const token = `@${name} `
  return { text: text.slice(0, start) + token + text.slice(caret), caret: start + token.length }
}

/** The members the text still shows as a token: a token the person erased drops its mention. Order of the picks. */
export function activeMentions<T extends { name: string }>(text: string, picked: T[]): T[] {
  return picked.filter((m) => text.includes(`@${m.name}`))
}

/** Members that match what is typed after «@», by name, case and accents aside. */
export function matchMembers<T extends { name: string }>(members: T[], query: string): T[] {
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const q = fold(query)
  return members.filter((m) => fold(m.name).includes(q))
}

/** Splits `text` into plain pieces and the tokens of the members the reply mentions, to draw the tokens highlighted. */
export function splitMentions(text: string, names: string[]): { text: string; mention: boolean }[] {
  const tokens = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length)
  if (tokens.length === 0) return [{ text, mention: false }]
  const pattern = new RegExp(`(${tokens.map((n) => `@${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|')})`, 'g')
  // With one capturing group, `split` puts the matches at the odd positions.
  return text.split(pattern).map((t, i) => ({ text: t, mention: i % 2 === 1 })).filter((p) => p.text !== '')
}
