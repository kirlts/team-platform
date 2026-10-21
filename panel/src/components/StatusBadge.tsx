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

export function AreaBadge({ title }: { title: string }) {
  return <Badge tone="outline">{title}</Badge>
}
