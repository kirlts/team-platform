import { useT, type MessageKey } from '@/i18n'
import type { ConnectionStatus } from '@team-platform/client'
import { cn } from '@/lib/utils'

const LOOK: Record<ConnectionStatus, { dot: string; text: string }> = {
  no_key: { dot: 'bg-faint', text: 'text-muted' },
  configured: { dot: 'bg-lime', text: 'text-fg' },
  failing: { dot: 'bg-danger', text: 'text-danger' },
}

/** State of a key as a colored dot and its word: the color only reinforces what the word says. */
export function ConnectionStatusMark({ status, className }: { status: ConnectionStatus; className?: string }) {
  const t = useT()
  const { dot, text } = LOOK[status]
  return (
    <span data-status={status} className={cn('inline-flex items-center gap-2 text-sm font-semibold', text, className)}>
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full shadow-[0_0_0_1px_oklch(0_0_0/0.2)]', dot)} />
      {t(`providers.status.${status}` as MessageKey)}
    </span>
  )
}
