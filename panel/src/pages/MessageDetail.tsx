import { ArrowLeft } from '@/components/icons'
import { Link, useParams, useSearchParams } from 'react-router'
import { AiMark } from '@/components/AiMark'
import { AreaPicker } from '@/components/AreaPicker'
import { AttachmentStrip } from '@/components/AttachmentStrip'
import { Avatar } from '@/components/Avatar'
import { EmptyState } from '@/components/EmptyState'
import { EditableText } from '@/components/EditableText'
import { useLookups } from '@/components/lookups'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { Recipients } from '@/components/Recipients'
import { RecipientsEditor } from '@/components/RecipientsEditor'
import { ReplyThread } from '@/components/ReplyThread'
import { StatusBadge } from '@/components/StatusBadge'
import { TemplateFields } from '@/components/TemplateFields'
import { UndoButtons } from '@/components/UndoButtons'
import { Button } from '@/components/ui/button'
import { useErrorText, useFormat, useT } from '@/i18n'
import { ApiError } from '@/lib/api'
import { useMe, useMessage, usePatchMessage, useSetClosed, useTemplates } from '@/lib/queries'
import { parseTemplateFields, remapFields } from '@/lib/template'
import type { MessageDetail as Detail, MessagePatch, Template } from '@/lib/types'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'

export function MessageDetail() {
  const t = useT()
  const errorText = useErrorText()
  const { id } = useParams()
  const [params] = useSearchParams()
  const message = useMessage(id)
  const undo = useUndoStack()

  if (message.isPending) {
    return (
      <Page cols={12}>
        <p className="text-sm text-muted">{t('common.loading')}</p>
      </Page>
    )
  }
  if (message.isError) {
    const missing = message.error instanceof ApiError && message.error.status === 404
    return (
      <Page cols={12}>
        <PageHeader title={t('nav.messages')} />
        <EmptyState
          alert
          className="glass leaf"
          action={
            <Button asChild>
              <Link to="/messages">{t('detail.backToMessages')}</Link>
            </Button>
          }
        >
          {missing ? t('detail.missing') : t('common.loadFailed', { reason: errorText(message.error) })}
        </EmptyState>
      </Page>
    )
  }

  return (
    <UndoProvider stack={undo}>
      <DetailBody message={message.data} focusReply={params.get('reply') === '1'} />
    </UndoProvider>
  )
}

function DetailBody({ message: m, focusReply }: { message: Detail; focusReply: boolean }) {
  const t = useT()
  const format = useFormat()
  const me = useMe().data
  const undo = useUndo()
  const setClosed = useSetClosed()
  const patchMessage = usePatchMessage()
  const { areaTitle, memberName } = useLookups()
  const templates = useTemplates(m.area_id)
  const template: Template | undefined = templates.data?.find((x) => x.id === m.template_id) ?? templates.data?.[0]
  const closed = m.status === 'closed'
  const canEdit = !!me && (me.id === m.author_id || me.role === 'editor')

  /** A change to the message: what is requested and what undoes it. */
  const change = (label: string, forward: MessagePatch, back: MessagePatch) =>
    undo.run({ label, redo: () => patchMessage.mutateAsync({ id: m.id, patch: forward }), undo: () => patchMessage.mutateAsync({ id: m.id, patch: back }) })

  const required = (v: string) => (v.trim() ? null : t('common.required'))

  return (
    <Page cols={12}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/messages" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
          <ArrowLeft size={13} aria-hidden /> {t('nav.messages')}
        </Link>
        {canEdit && <UndoButtons stack={undo} />}
      </div>

      <header className="grid grid-cols-1 items-start gap-x-4 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <h1 className="min-w-0">
          <EditableText value={m.title} label={t('detail.title')} canEdit={canEdit} validate={required} onSave={(v) => change(t('proposal.titleEdited'), { title: v }, { title: m.title })} displayClassName="font-sans text-lg font-semibold leading-snug md:text-[1.375rem]" />
        </h1>
        <Button
          variant="secondary"
          className="max-md:justify-self-start"
          disabled={setClosed.isPending}
          onClick={() =>
            // Closing is an operation of the screen like any edit: it shows in Deshacer, which takes it back (J1-A-28).
            void undo.run({
              label: closed ? t('detail.reopened') : t('detail.closed'),
              redo: () => setClosed.mutateAsync({ id: m.id, closed: !closed }),
              undo: () => setClosed.mutateAsync({ id: m.id, closed }),
            })
          }
        >
          {closed ? t('card.reopen') : t('card.close')}
        </Button>
      </header>
      {setClosed.isError && (
        <p role="alert" className="text-xs text-danger">
          {setClosed.error.message}
        </p>
      )}

      <div className="grid min-h-0 flex-1 md:grid-rows-[minmax(0,1fr)] gap-x-10 gap-y-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
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
              <span className="inline-flex min-h-6 items-center rounded-[3px_9px_3px_9px] border border-edge px-2 font-semibold text-fg">{areaTitle(m.area_id)}</span>
            )}
            <StatusBadge status={m.status} />
            <span data-repeat-ok="person" className="inline-flex items-center gap-1.5">
              <Avatar name={memberName(m.author_id) || '?'} size={20} />
              {memberName(m.author_id)}
            </span>
            <time dateTime={m.created_at} className="tabular-nums">
              {format.stamp(m.created_at)}
            </time>
            {m.input_id && <AiMark />}
          </div>

          {canEdit ? (
            <RecipientsEditor ids={m.assignee_ids} max={4} onChange={(ids) => void change(t('proposal.recipientsChanged'), { assignee_ids: ids }, { assignee_ids: m.assignee_ids })} />
          ) : (
            <Recipients ids={m.assignee_ids} max={4} />
          )}

          {/* A long text has no cap: the message column scrolls inside, and it is a declared lane. */}
          <div data-lane="message-body" className="scroll-thin flex min-h-0 flex-initial flex-col gap-3 overflow-y-auto px-1.5">
            <EditableText value={m.body} label={t('detail.body')} multiline prose canEdit={canEdit} validate={required} onSave={(v) => change(t('proposal.bodyEdited'), { body: v }, { body: m.body })} displayClassName="leading-relaxed" />
            <TemplateFields
              template={template}
              values={m.fields}
              canEdit={canEdit}
              onSave={(name, value) => change(t('proposal.fieldEdited'), { fields: { ...(m.fields ?? {}), [name]: value } }, { fields: m.fields ?? {} })}
            />
          </div>

          <AttachmentStrip items={m.attachments} px={44} className="shrink-0" />
        </div>

        <ReplyThread message={m} focusForm={focusReply} />
      </div>
    </Page>
  )
}
