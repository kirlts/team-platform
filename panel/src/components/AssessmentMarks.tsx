import type { Guard, Message } from '@team-platform/client'
import { useAreas } from '@team-platform/client/react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * What the analyzer says a message touches (UD-295), on its card: one badge for each Guard of its area that the message touches, and one when the value that is missing is a person's.
 * Only a Guard is a yes or no (Kairós): the estimates are continuous and live in the detail of the message. Nothing here is a control; the person changes it in the detail.
 */
export function AssessmentMarks({ message, className, oneLine = false }: { message: Pick<Message, 'area_id' | 'assessment'>; className?: string; /** In a row of a list every mark stays on one line and ends in «…»: the row keeps its height (UD-241). */ oneLine?: boolean }) {
  const t = useT()
  const areas = useAreas().data ?? []
  const guards: Guard[] = areas.find((a) => a.id === message.area_id)?.guards ?? []
  const touched = (message.assessment?.guards ?? []).map((id) => guards.find((g) => g.id === id)).filter((g): g is Guard => !!g)
  const person = message.assessment?.estimates?.value_holder === 'person'
  if (touched.length === 0 && !person) return null
  return (
    <span data-testid="assessment-marks" className={cn('inline-flex min-w-0 items-center gap-x-2 gap-y-1', oneLine ? 'flex-nowrap' : 'flex-wrap', className)}>
      {touched.map((g) => (
        <span key={g.id} data-testid="guard-mark" data-person={g.person ? '' : undefined} title={g.mechanism ? `${g.text} · ${g.mechanism}` : g.text} data-ellipsis-ok={oneLine ? 'UD-241' : undefined} className={cn('guard-mark', oneLine && 'truncate' /* justified: UD-241, a row of a list keeps one line */)}>
          {g.text}
        </span>
      ))}
      {person && <span data-testid="person-mark" title={t('assessment.person')} data-ellipsis-ok={oneLine ? 'UD-241' : undefined} className={cn('guard-mark', oneLine && 'truncate' /* justified: UD-241, a row of a list keeps one line */)} data-person="">{t('assessment.person')}</span>}
    </span>
  )
}
