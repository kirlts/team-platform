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

/** Área como pestaña de cromo: esquinas opuestas redondeadas, como en la maqueta. Un título largo pasa a una segunda línea. */
export function AreaBadge({ title }: { title: string }) {
  return (
    <span className="inline-flex min-h-5 max-w-full items-center rounded-[3px_9px_3px_9px] border border-line-strong bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] px-2 py-0.5 text-xs font-semibold leading-tight text-fg">
      {title}
    </span>
  )
}
