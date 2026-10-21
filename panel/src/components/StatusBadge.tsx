import { Badge } from '@/components/ui/badge'
import type { MessageStatus } from '@/lib/types'

export const STATUS_LABEL: Record<MessageStatus, string> = {
  open: 'Abierto',
  answered: 'Respondido',
  closed: 'Cerrado',
}

export function StatusBadge({ status }: { status: MessageStatus }) {
  return <Badge tone={status}>{STATUS_LABEL[status]}</Badge>
}

/** Area as a chrome tab: opposite rounded corners, as in the mockup. */
export function AreaBadge({ title }: { title: string }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-[3px_9px_3px_9px] border border-line-strong bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] px-2 text-xs font-semibold text-fg">
      {title}
    </span>
  )
}
