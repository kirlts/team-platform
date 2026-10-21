import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Columns of the 12-column board a view occupies (6 rem each, 72 rem in all). Every view starts at
 * the same left edge and ends on a column edge: 12 for dashboards and tables, 10 for lists and
 * 8 for reading and forms. See «Grilla» in panel/DISENO.md.
 */
const COLUMNS = { inicio: 'mx-auto max-w-inicio', 12: 'max-w-[72rem]', 10: 'max-w-[60rem]', 8: 'max-w-[48rem]' } as const

/**
 * Content frame of a view: the page margin (20 px on a phone, 40 px from 768 px) and the vertical
 * rhythm between its blocks. From 768 px the frame is as tall as the region it is in and its blocks
 * share that height (UD-017: a view fits one screen); the one block that grows, a list, takes
 * what is left with `flex-1 min-h-0` and paginates inside it. `dense` tightens the rhythm (12 px between blocks, 16 px of margin) for a view
 * with more blocks than the others, Inicio.
 */
export function Page({ cols = 10, section = false, dense = false, airy = false, scrolls = false, children }: { cols?: keyof typeof COLUMNS; section?: boolean; dense?: boolean; airy?: boolean; scrolls?: boolean; children: ReactNode }) {
  // `airy` (Inicio, UD-110): the blocks are 24 px apart (16 px in a window lower than 800 px, 40 px in one 1000 px tall or more) and the frame grows with the window up to `max-w-inicio`.
  // `scrolls` lets the frame be taller than the region (a send is open): the region scrolls, as the page always has.
  return (
    <div
      className={cn(
        'flex w-full flex-col px-5 py-6 md:px-10',
        scrolls ? 'md:min-h-full' : 'md:h-full md:min-h-0',
        airy ? 'gap-block-compact md:py-block-compact [@media(min-height:800px)]:gap-block [@media(min-height:800px)]:md:py-block [@media(min-height:1000px)]:gap-section [@media(min-height:1000px)]:md:py-section' : dense ? 'gap-3 md:py-4' : 'md:py-5',
        COLUMNS[cols],
        !dense && !airy && (section ? 'gap-5' : 'gap-4'),
      )}
    >
      {children}
    </div>
  )
}
