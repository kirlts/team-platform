import { ChevronRight } from '@/components/icons'
import { Link } from 'react-router'
import { useErrorText, useFormat, useT } from '@/i18n'
import { useMe, useMessage, usePatchMessage, useTemplates } from '@/lib/queries'
import { parseTemplateFields, remapFields } from '@/lib/template'
import type { InputRecord, MessageDetail, MessagePatch, Template } from '@/lib/types'
import { useUndo } from '@/lib/undo'
import { AiMark } from './AiMark'
import { AreaChip, useAreaStyle } from './AreaChip'
import { AreaPicker } from './AreaPicker'
import { AttachmentPicker } from './AttachmentPicker'
import { EditableText } from './EditableText'
import { RecipientsEditor } from './RecipientsEditor'
import { StatusBadge } from './StatusBadge'
import { TemplateFields } from './TemplateFields'
import { UndoButtons } from './UndoButtons'

/**
 * What a send became once the analysis ended (UD-070): its messages, already published to the team, each in its own box in the color of
 * its area. The sender edits them right here (UD-071): the same controls the proposal had, saving on the published message with the version that
 * was read. Nobody else sees the controls. There is no confirmation step; a message that is wrong is corrected, and the history above takes a change back.
 */
export function PublishedPane({ input }: { input: InputRecord }) {
  const t = useT()
  const stack = useUndo()
  const ids = input.message_ids ?? input.messages?.map((m) => m.id) ?? []
  return (
    <section aria-label={t('analysis.title')} data-testid="published-pane" className="@container flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
        <h2>{t('analysis.title')}</h2>
        <AiMark />
        <span className="text-xs font-semibold text-muted">{t('tray.state.published')}</span>
        <UndoButtons stack={stack} />
      </div>
      {/* The messages of a send have no maximum length: the list is a lane with its own scroll, declared, and no box is ever cut. */}
      <ul data-lane="published-messages" className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {ids.map((id) => (
          <PublishedMessage key={id} id={id} input={input} />
        ))}
      </ul>
    </section>
  )
}

function PublishedMessage({ id, input }: { id: string; input: InputRecord }) {
  const t = useT()
  const query = useMessage(id)
  if (!query.data) {
    return (
      <li role="status" className="rounded-md border border-line px-3 py-4 text-sm text-muted">
        {t('published.loading')}
      </li>
    )
  }
  return <Box m={query.data} input={input} />
}

function Box({ m, input }: { m: MessageDetail; input: InputRecord }) {
  const t = useT()
  const format = useFormat()
  const errorText = useErrorText()
  const me = useMe().data
  const undo = useUndo()
  const patchMessage = usePatchMessage()
  const style = useAreaStyle(m.area_id)
  const templates = useTemplates(m.area_id)
  const template: Template | undefined = templates.data?.find((x) => x.id === m.template_id) ?? templates.data?.[0]
  // Only the sender edits (UD-071), the Editor included: for anyone else the box is read-only.
  const canEdit = !!me && me.id === m.author_id
  const required = (v: string) => (v.trim() ? null : t('common.required'))
  const change = (label: string, forward: MessagePatch, back: MessagePatch) =>
    undo.run({ label, redo: () => patchMessage.mutateAsync({ id: m.id, patch: forward }), undo: () => patchMessage.mutateAsync({ id: m.id, patch: back }) })

  return (
    <li data-testid="published-message" data-area-id={m.area_id} style={style} className="area-tint area-box flex list-none flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {canEdit ? (
          <AreaPicker
            areaId={m.area_id}
            templateName={template?.name}
            onChange={(area_id, next) =>
              change(
                t('proposal.areaChanged'),
                { area_id, ...(next ? { template_id: next.id } : {}), fields: remapFields(m.fields, parseTemplateFields(next?.body_markdown ?? '')) },
                { area_id: m.area_id, ...(m.template_id ? { template_id: m.template_id } : {}), fields: m.fields ?? {} },
              )
            }
          />
        ) : (
          <AreaChip areaId={m.area_id} />
        )}
        <StatusBadge status={m.status} quiet />
        {m.edited_at && (
          <time dateTime={m.edited_at} data-testid="edited-mark" className="text-xs text-muted">
            {t('published.edited', { when: format.stamp(m.edited_at) })}
          </time>
        )}
        <Link to={`/messages/${m.id}`} aria-label={t('published.open', { title: m.title })} className="ml-auto inline-flex items-center gap-0.5 text-xs font-semibold hover:underline">
          {t('published.openShort')}
          <ChevronRight size={13} aria-hidden />
        </Link>
      </div>
      <EditableText
        value={m.title}
        label={t('proposal.title')}
        canEdit={canEdit}
        validate={required}
        onSave={(v) => change(t('proposal.titleEdited'), { title: v }, { title: m.title })}
        displayClassName="text-read font-bold"
      />
      <EditableText value={m.body} label={t('proposal.body')} multiline prose canEdit={canEdit} validate={required} onSave={(v) => change(t('proposal.bodyEdited'), { body: v }, { body: m.body })} displayClassName="text-read text-fg" className="py-1" />
      <TemplateFields
        boxed={false}
        template={template}
        values={m.fields}
        canEdit={canEdit}
        onSave={(name, value) => change(t('proposal.fieldEdited'), { fields: { ...(m.fields ?? {}), [name]: value } }, { fields: m.fields ?? {} })}
      />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {canEdit ? (
          <RecipientsEditor ids={m.assignee_ids} onChange={(ids) => void change(t('proposal.recipientsChanged'), { assignee_ids: ids }, { assignee_ids: m.assignee_ids })} />
        ) : null}
        {canEdit && (
          <AttachmentPicker
            all={input.attachments}
            selected={m.attachments.map((a) => a.id)}
            onChange={(ids) => void change(t('proposal.attachmentsChanged'), { attachment_ids: ids }, { attachment_ids: m.attachments.map((a) => a.id) })}
          />
        )}
      </div>
      {patchMessage.isError && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {errorText(patchMessage.error)}
        </p>
      )}
    </li>
  )
}
