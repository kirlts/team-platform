import type { Guard, Message } from '@team-platform/client'
import { useAreas } from '@team-platform/client/react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * What the analyzer says a message touches (UD-295), on its card: one badge for each Guard of its area that the message touches, and one when the value that is missing is a person's.
 * Only a Guard is a yes or no: the estimates are continuous and live in the detail of the message. Nothing here is a control; the person changes it in the detail.
 */
export function AssessmentMarks({ message, className }: { message: Pick<Message, 'area_id' | 'assessment'>; className?: string }) {
  const t = useT()
  const areas = useAreas().data ?? []
  const guards: Guard[] = areas.find((a) => a.id === message.area_id)?.guards ?? []
  const touched = (message.assessment?.guards ?? []).map((id) => guards.find((g) => g.id === id)).filter((g): g is Guard => !!g)
  const person = message.assessment?.estimates?.value_holder === 'person'
  if (touched.length === 0 && !person) return null
  return (
    <span data-testid="assessment-marks" className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}>
      {touched.map((g) => (
        <span key={g.id} data-testid="guard-mark" data-person={g.person ? '' : undefined} title={g.mechanism ? `${g.text} · ${g.mechanism}` : g.text} className="guard-mark">
          {g.text}
        </span>
      ))}
      {person && <span data-testid="person-mark" className="guard-mark" data-person="">{t('assessment.person')}</span>}
    </span>
  )
}
