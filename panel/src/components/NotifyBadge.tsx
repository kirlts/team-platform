import { AlertTriangle, Clock, InfoDot } from '@/components/icons'
import { useT, type MessageKey } from '@/i18n'
import { topTone, toneTotal, type Tone, type ToneCounts } from '@/lib/priority'
import { cn } from '@/lib/utils'

const ICON = { red: AlertTriangle, yellow: Clock, blue: InfoDot } as const
export const TONE_WORD: Record<Tone, MessageKey> = { red: 'tone.red', yellow: 'tone.yellow', blue: 'tone.blue' }

/** The shape of a priority (triangle, clock, dot), for places that draw their own pill. */
export function ToneIcon({ tone, size = 14 }: { tone: Tone; size?: number }) {
  const Icon = ICON[tone]
  return <Icon size={size} aria-hidden strokeWidth={2.2} />
}

/** The mark of one priority: its shape, its word and (optionally) a count. The shape and the word say it without the color. */
export function ToneMark({ tone, n, className, showWord = true }: { tone: Tone; n?: number; className?: string; showWord?: boolean }) {
  const t = useT()
  const Icon = ICON[tone]
  return (
    <span data-tone={tone} data-testid="tone-mark" className={cn('inline-flex min-h-6 items-center gap-1 rounded-full border-2 px-2 text-xs font-bold leading-none', className)}>
      <Icon size={13} aria-hidden strokeWidth={2.2} />
      {showWord && <span>{t(TONE_WORD[tone])}</span>}
      {n !== undefined && <span className="tabular-nums">{n}</span>}
    </span>
  )
}

/**
 * The big count badge: its fill is the highest priority present (red > yellow > blue), it carries the shape of
 * that priority and the total as a number, and its accessible name says both. Nothing present renders nothing.
 */
export function NotifyBadge({ counts, size = 'lg', className, ...rest }: { counts: ToneCounts; size?: 'lg' | 'md'; className?: string; 'data-testid'?: string }) {
  const t = useT()
  const tone = topTone(counts)
  const total = toneTotal(counts)
  if (!tone) return null
  const Icon = ICON[tone]
  return (
    <span
      {...rest}
      data-tone={tone}
      data-count={total}
      role="img"
      aria-label={t('notify.label', { n: total, tone: t(TONE_WORD[tone]) })}
      className={cn('inline-flex shrink-0 items-center justify-center gap-1 rounded-full border-2 font-bold leading-none shadow-glass', size === 'lg' ? 'h-8 min-w-12 px-2.5 text-sm' : 'h-6 min-w-9 px-2 text-xs', className)}
    >
      <Icon size={size === 'lg' ? 16 : 13} aria-hidden strokeWidth={2.2} />
      <span className="tabular-nums">{total}</span>
    </span>
  )
}
