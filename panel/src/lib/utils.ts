import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// `text-read` (17 px, styles.css) is a font size of the panel's own scale; without telling the merger it
// would take it for a color and drop it next to `text-fg`.
const merge = extendTailwindMerge({ extend: { classGroups: { 'font-size': [{ text: ['read', 'emph'] }] } } })

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs))
}
