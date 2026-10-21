import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Columns of the 12-column board a view occupies (6 rem each, 72 rem in all). Every view starts at
 * the same left edge and ends on a column edge: 12 for dashboards and tables, 10 for lists and
 * 8 for reading and forms. See «Grilla» in panel/DISENO.md.
 */
const COLUMNS = { 12: 'max-w-[72rem]', 10: 'max-w-[60rem]', 8: 'max-w-[48rem]' } as const

/**
 * Content frame of a view: the page margin (20 px on a phone, 40 px from 768 px) and the vertical
 * rhythm between its blocks. From 768 px the frame is as tall as the region it is in and its blocks
 * share that height (UD-017: a view fits one screen); the one block that grows, a list, takes
 * what is left with `flex-1 min-h-0` and paginates inside it. `dense` tightens the rhythm (12 px between blocks, 16 px of margin) for a view
 * with more blocks than the others, Inicio.
 */
export function Page({ cols = 10, section = false, dense = false, children }: { cols?: keyof typeof COLUMNS; section?: boolean; dense?: boolean; children: ReactNode }) {
  return <div className={cn('flex w-full flex-col px-5 py-6 md:h-full md:min-h-0 md:px-10', dense ? 'gap-3 md:py-4' : 'md:py-5', COLUMNS[cols], !dense && (section ? 'gap-5' : 'gap-4'))}>{children}</div>
}
