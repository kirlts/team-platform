import type { ReactNode } from 'react'
import type { Guard, MessageDetail } from '@team-platform/client'
import { useAreas, useMe, useSetAssessment } from '@team-platform/client/react'
import { EditableText } from '@/components/EditableText'
import { Fold } from '@/components/Fold'
import { NativeSelect, ON_PAGE_FIELD } from '@/components/NativeSelect'
import { useT, type MessageKey } from '@/i18n'

const DIMENSIONS = [
  ['understand_vs_create', 'assessment.create'],
  ['irreversibility', 'assessment.irreversibility'],
  ['certainty', 'assessment.certainty'],
] as const

/**
 * «Evaluación» of the detail of a message (UD-295): what the analyzer expects of Claude in its own words, the Guards of the area it touches, who holds the value that is missing and
 * its estimates with their reason. The expectation, the Guards and the holder are edited in place by any person of the team; the estimates are the analyzer's reading and are shown, not
 * set. Folded: it is what the analysis says, not what the sender asked.
 */
export function Assessment({ message, bare = false }: { message: MessageDetail; /** Without its own fold: «Detalles» holds it (UD-307). */ bare?: boolean }) {
  const t = useT()
  const me = useMe().data
  const set = useSetAssessment()
  const areas = useAreas().data ?? []
  const guards: Guard[] = areas.find((a) => a.id === message.area_id)?.guards ?? []
  const a = message.assessment
  const canEdit = !!me && me.kind !== 'agent' && me.active !== false
  if (!a || (!a.expectation && !a.estimates && guards.length === 0)) return null
  const touched = new Set(a.guards)
  const toggle = (id: number) => set.mutate({ id: message.id, guards: guards.map((g) => g.id as number).filter((g) => (g === id ? !touched.has(g) : touched.has(g))) })
  const Wrap = bare ? Bare : Fold
  return (
    <Wrap title={t('assessment.title')} className="shrink-0">
      <div data-testid="assessment" className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-1">
          <span className="rotulo">{t('assessment.expectation')}</span>
          <EditableText value={a.expectation} label={t('assessment.expectation')} multiline canEdit={canEdit} onSave={(v) => set.mutateAsync({ id: message.id, expectation: v })} emptyLabel={t('assessment.none')} placeholder={t('assessment.none')} />
        </div>
        {guards.length > 0 && (
          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="rotulo p-0">{t('assessment.guards')}</legend>
            {guards.map((g) => (
              <label key={g.id} className="flex min-h-6 items-start gap-2">
                <input type="checkbox" className="mt-1" checked={touched.has(g.id as number)} disabled={!canEdit || set.isPending} onChange={() => toggle(g.id as number)} data-testid={`guard-${g.id}`} />
                <span className="min-w-0 break-words">{g.text}{g.mechanism ? <span className="text-muted"> · {g.mechanism}</span> : null}</span>
              </label>
            ))}
          </fieldset>
        )}
        {a.estimates && (
          <div className="flex flex-col gap-3">
            <label className="flex w-full min-w-0 flex-col items-start gap-2 sm:w-56">
              <span className="rotulo">{t('assessment.holder')}</span>
              {canEdit ? (
                <NativeSelect className={ON_PAGE_FIELD} value={a.estimates.value_holder} onChange={(e) => set.mutate({ id: message.id, value_holder: e.target.value as 'person' | 'model' })} aria-label={t('assessment.holder')} data-testid="value-holder">
                  <option value="person">{t('assessment.holder.person')}</option>
                  <option value="model">{t('assessment.holder.model')}</option>
                </NativeSelect>
              ) : (
                <span className="font-semibold">{t(`assessment.holder.${a.estimates.value_holder}` as MessageKey)}</span>
              )}
            </label>
            <dl className="flex flex-wrap gap-x-6 gap-y-1" data-testid="estimates">
              {DIMENSIONS.map(([key, label]) => (
                <div key={key} className="flex items-baseline gap-1.5">
                  <dt className="text-muted">{t(label)}</dt>
                  <dd className="m-0 tabular-nums">{a.estimates ? a.estimates[key].toFixed(2) : ''}</dd>
                </div>
              ))}
            </dl>
            {a.estimates.reason && <p className="m-0 break-words text-muted">{a.estimates.reason}</p>}
          </div>
        )}
      </div>
    </Wrap>
  )
}

/** The content of a fold drawn in the open, under its name, inside the one fold that holds it. */
export function Bare({ title, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className="rotulo">{title}</h3>
      {children}
    </section>
  )
}
