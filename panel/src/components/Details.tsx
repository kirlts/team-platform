import type { MessageDetail, Template } from '@team-platform/client'
import { useAreas, useMessageTiming } from '@team-platform/client/react'
import { Assessment, Bare, hasAssessment } from '@/components/Assessment'
import { Fold } from '@/components/Fold'
import { useLookups } from '@/components/lookups'
import { Observed } from '@/components/Observed'
import { DetailBody, JudgmentBody, TimingBody } from '@/components/Timing'
import { useT } from '@/i18n'

/**
 * «Detalles» of a message (UD-309): the one fold that holds what the analysis and the agent say about it (the observations of a video, the
 * evaluation, the times, the technical detail and the adequacy of the work). Each part is drawn only when it has something to say; with none,
 * the fold is not drawn either. The parts are named inside, never folds of their own: one level is hidden, never two.
 */
export function Details({ message, template }: { message: MessageDetail; template?: Template }) {
  const { members } = useLookups()
  const attended = message.assignee_ids.some((id) => members.find((m) => m.id === id)?.kind === 'agent')
  return attended ? <WithTiming message={message} template={template} /> : <Shell message={message} template={template} timing={null} />
}

/** An agent works the message: its figures are asked once, to know which parts have something to say. */
function WithTiming({ message, template }: { message: MessageDetail; template?: Template }) {
  const timing = useMessageTiming(message.id)
  return <Shell message={message} template={template} timing={timing} />
}

type TimingQuery = ReturnType<typeof useMessageTiming>

function Shell({ message, template, timing }: { message: MessageDetail; template?: Template; timing: TimingQuery | null }) {
  const t = useT()
  const areas = useAreas().data ?? []
  const guards = areas.find((a) => a.id === message.area_id)?.guards ?? []
  const evaluation = hasAssessment(message, guards, template)
  const data = timing?.data
  const rows = (data?.detail?.entries?.length ?? 0) + (data?.detail?.delivery_ref ? 1 : 0)
  const parts = {
    observed: !!message.observed?.length,
    evaluation,
    timing: !!data,
    detail: rows > 0,
    judgment: !!data?.judgment,
  }
  if (!Object.values(parts).some(Boolean)) return null
  return (
    <Fold title={t('details.title')} className="shrink-0">
      <div data-testid="details" className="flex flex-col gap-3 pt-2">
        {parts.observed && (
          <Bare title={t('observed.title')}>
            <Observed items={message.observed} bare />
          </Bare>
        )}
        {parts.evaluation && <Assessment message={message} template={template} bare />}
        {parts.timing && (
          <div data-timing className="contents">
            <Bare title={t('timing.title')}>
              <TimingBody messageId={message.id} />
            </Bare>
            {parts.detail && (
              <Bare title={t('timing.detail')}>
                <DetailBody messageId={message.id} />
              </Bare>
            )}
            {parts.judgment && (
              <Bare title={t('judgment.title')}>
                <JudgmentBody messageId={message.id} />
              </Bare>
            )}
          </div>
        )}
      </div>
    </Fold>
  )
}
