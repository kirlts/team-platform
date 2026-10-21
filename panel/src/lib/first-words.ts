/** The first `count` words of a text, as a label for a row. It cuts on a word and adds no ellipsis. */
export function firstWords(text: string, count = 12): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, count).join(' ')
}
