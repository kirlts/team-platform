import { AlertTriangle, Check as CheckIcon, InfoDot } from '@/components/icons'
import { useT, type MessageKey } from '@/i18n'
import type { ConnectionStatus } from '@team-platform/client'
import { cn } from '@/lib/utils'

const LOOK: Record<ConnectionStatus, { Icon: typeof CheckIcon; tone: string }> = {
  no_key: { Icon: InfoDot, tone: 'text-muted' },
  configured: { Icon: CheckIcon, tone: 'text-accent-deep' },
  failing: { Icon: AlertTriangle, tone: 'text-danger' },
}

/** State of a key as icon and word: the color only reinforces what the word says. */
export function ConnectionStatusMark({ status, className }: { status: ConnectionStatus; className?: string }) {
  const t = useT()
  const { Icon, tone } = LOOK[status]
  return (
    <span data-status={status} className={cn('inline-flex items-center gap-1.5 text-sm font-semibold', tone, className)}>
      <Icon size={16} aria-hidden />
      {t(`providers.status.${status}` as MessageKey)}
    </span>
  )
}
