import { Badge } from '@/components/ui/badge'
import { useT, type MessageKey } from '@/i18n'
import type { MessageStatus } from '@/lib/types'

export const STATUS_KEY: Record<MessageStatus, MessageKey> = {
  open: 'status.open',
  answered: 'status.answered',
  closed: 'status.closed',
}

export function StatusBadge({ status }: { status: MessageStatus }) {
  const t = useT()
  return <Badge tone={status}>{t(STATUS_KEY[status])}</Badge>
}

/** Area as a chrome tab: opposite corners rounded, as in the mockup. A long title wraps to a second line. */
export function AreaBadge({ title }: { title: string }) {
  return (
    <span className="inline-flex min-h-5 max-w-full items-center rounded-[3px_9px_3px_9px] border border-line-strong bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] px-2 py-0.5 text-xs font-semibold leading-tight text-fg">
      {title}
    </span>
  )
}
