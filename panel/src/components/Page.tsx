import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Columns of the 12-column board a view occupies (6 rem each, 72 rem in all). Every view starts at
 * the same left edge and ends on a column edge: 12 for dashboards and tables, 10 for lists and
 * 8 for reading and forms. See «Grilla» in panel/DISENO.md.
 */
const COLUMNS = { 12: 'max-w-[72rem]', 10: 'max-w-[60rem]', 8: 'max-w-[48rem]' } as const

/** Content frame of a view: the page margin (20 px on a phone, 40 px from 768 px) and the vertical rhythm between its blocks. */
export function Page({ cols = 10, section = false, children }: { cols?: keyof typeof COLUMNS; section?: boolean; children: ReactNode }) {
  return <div className={cn('flex w-full flex-col px-5 py-7 md:px-10 md:py-10', COLUMNS[cols], section ? 'gap-10' : 'gap-6')}>{children}</div>
}
