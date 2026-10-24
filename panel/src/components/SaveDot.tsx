import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

/** Where an edit that saves by itself stands. Each one has its dot and always its word: the color is never the only signal. */
export type SaveTone = 'idle' | 'saving' | 'saved' | 'dirty' | 'error'

const DOT: Record<SaveTone, string> = {
  idle: 'bg-faint',
  saving: 'bg-accent',
  saved: 'bg-lime',
  dirty: 'bg-answered-led',
  error: 'bg-danger',
}

/** The state of the saving as a dot of color with its text: blue saving, green saved, amber unsaved, red failed, gray nothing to save. */
export function SaveDot({ tone, className, children, ...rest }: { tone: SaveTone } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span role="status" aria-live="polite" data-save-tone={tone} {...rest} className={cn('inline-flex items-center gap-2 text-sm', tone === 'error' ? 'text-danger' : 'text-muted', className)}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', DOT[tone])} />
      {children}
    </span>
  )
}
