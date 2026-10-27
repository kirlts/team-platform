import { X } from '@/components/icons'
import { useT } from '@/i18n'

/** A failure said by shape and word, never by color alone: the cross and «Falló», the same mark the stretches of the work of an agent use. */
export function FailedMark() {
  const t = useT()
  return (
    <span data-failed-mark className="inline-flex items-center gap-1 text-danger">
      <X size={14} aria-hidden className="shrink-0" />
      {t('timing.state.failed')}
    </span>
  )
}
