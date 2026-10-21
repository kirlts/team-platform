import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const tones = {
  neutral: 'bg-closed-bg text-closed-fg',
  accent: 'bg-accent-soft text-accent-deep',
  open: 'led bg-open-bg text-open-fg [--led:var(--color-open-led)]',
  answered: 'led bg-answered-bg text-answered-fg [--led:var(--color-answered-led)]',
  closed: 'led bg-closed-bg text-closed-fg [--led:var(--color-closed-led)]',
  danger: 'bg-danger-soft text-danger',
  outline: 'border border-line-strong text-muted',
} as const

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center whitespace-nowrap rounded-full px-2 text-xs font-semibold leading-none',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
