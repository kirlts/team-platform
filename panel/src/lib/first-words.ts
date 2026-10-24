/** The first `count` words of a text, as a label for a row. It cuts on a word and adds no ellipsis. */
export function firstWords(text: string, count = 12): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, count).join(' ')
}

/** A text written in Markdown as the plain words a row of a list shows: no emphasis marks, list bullets or link syntax. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/(?<![\w*])[*_]([^*_\s][^*_]*)[*_](?!\w)/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^#{1,4}\s+/gm, '')
}
