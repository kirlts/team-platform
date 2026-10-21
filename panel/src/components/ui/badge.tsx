import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const tones = {
  neutral: 'border border-line bg-hover text-fg',
  accent: 'bg-accent-soft text-accent-deep',
  open: 'led bg-open-bg text-open-fg [--led:var(--color-open-led)]',
  answered: 'led bg-answered-bg text-answered-fg [--led:var(--color-answered-led)]',
  closed: 'led bg-closed-bg text-closed-fg [--led:var(--color-closed-led)]',
  danger: 'bg-danger-soft text-danger',
  outline: 'border border-line-strong text-muted',
  /** The state of a message inside a list row: the light and the word, with no pill, so a row has one filled mark (J2-A-05). */
  'open-quiet': 'led text-open-fg [--led:var(--color-open-led)]',
  'answered-quiet': 'led text-answered-fg [--led:var(--color-answered-led)]',
  'closed-quiet': 'led text-closed-fg [--led:var(--color-closed-led)]',
  /** What waits for a person: the one badge that is filled. */
  solid: 'bg-accent text-accent-fg',
} as const

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        'inline-flex min-h-5 max-w-full items-center rounded-full py-0.5 text-xs font-semibold leading-tight',
        !tone.endsWith('-quiet') && 'px-2',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
