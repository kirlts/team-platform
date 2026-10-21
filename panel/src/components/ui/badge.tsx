import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const tones = {
  neutral: 'bg-closed-bg text-closed-fg',
  accent: 'bg-accent-soft text-accent',
  open: 'bg-open-bg text-open-fg',
  answered: 'bg-answered-bg text-answered-fg',
  closed: 'bg-closed-bg text-closed-fg',
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
        'inline-flex h-5 items-center whitespace-nowrap rounded-sm px-1.5 text-xs font-medium leading-none',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
