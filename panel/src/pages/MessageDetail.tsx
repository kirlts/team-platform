import { ArrowLeft, MessageSquare } from '@/components/icons'
import { Link, useParams, useSearchParams } from 'react-router'
import { AiMark } from '@/components/AiMark'
import { AreaChip } from '@/components/AreaChip'
import { AreaPicker } from '@/components/AreaPicker'
import { MediaGallery } from '@/components/MediaGallery'
import { toGalleryItems } from '@/lib/gallery'
import { Avatar } from '@/components/Avatar'
import { EmptyState } from '@/components/EmptyState'
import { EditableText } from '@/components/EditableText'
import { LoadState } from '@/components/LoadState'
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
import { useFormat, useT } from '@/i18n'
import { ApiError } from '@/lib/api'
import { useMe, useMessage, usePatchMessage, useTemplates } from '@/lib/queries'
import { parseTemplateFields, remapFields } from '@/lib/template'
import type { MessageDetail as Detail, MessagePatch, Template } from '@/lib/types'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'
import { useDesktop } from '@/lib/useDesktop'

export function MessageDetail() {
  const t = useT()
  const { id } = useParams()
  const [params] = useSearchParams()
  const message = useMessage(id)
  const undo = useUndoStack()

  if (message.isPending) {
    return (
      <Page cols={12}>
        <div className="glass leaf">
          <LoadState query={message} rows={2} />
        </div>
      </Page>
    )
  }
  if (message.isError) {
    const missing = message.error instanceof ApiError && message.error.status === 404
    return (
      <Page cols={12}>
        <PageHeader title={t('nav.messages')} />
        {missing ? (
          <EmptyState
            alert
            className="glass leaf"
            action={
              <Button asChild>
                <Link to="/messages">{t('detail.backToMessages')}</Link>
              </Button>
            }
          >
            {t('detail.missing')}
          </EmptyState>
        ) : (
          <div className="glass leaf">
            <LoadState query={message} />
          </div>
        )}
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
  const patchMessage = usePatchMessage()
  const { memberName } = useLookups()
  const templates = useTemplates(m.area_id)
  const template: Template | undefined = templates.data?.find((x) => x.id === m.template_id) ?? templates.data?.[0]
  // On a phone two chips fit before the rest fold behind «+N»: a name takes a whole row (J2-A-21).
  const desktop = useDesktop()
  const closed = m.status === 'closed'
  // Only the sender edits a published message, the Editor included (UD-071).
  const canEdit = !!me && me.id === m.author_id
  const canReply = !!me && me.id !== m.author_id && !closed

  /** A change to the message: what is requested and what undoes it. */
  const change = (label: string, forward: MessagePatch, back: MessagePatch) =>
    undo.run({ label, redo: () => patchMessage.mutateAsync({ id: m.id, patch: forward }), undo: () => patchMessage.mutateAsync({ id: m.id, patch: back }) })

  const required = (v: string) => (v.trim() ? null : t('common.required'))

  return (
    <Page cols={12}>
      {/* The actions of the screen share the top row, on the right, so on a phone nothing sits between the title and what it is about (J2-A-21). */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <Link to="/messages" className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
          <ArrowLeft size={13} aria-hidden /> {t('nav.messages')}
        </Link>
        <div className="flex items-center gap-3">
          {/* The thread and the message come before the field (the page is about 1.9 windows long on a phone): a way to it from the first screen. */}
          {!desktop && canReply && (
            <a
              href="#reply-field"
              onClick={(e) => {
                e.preventDefault()
                document.getElementById('reply-field')?.focus()
              }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              <MessageSquare size={13} aria-hidden /> {t('reply.jump')}
            </a>
          )}
          {canEdit && <UndoButtons stack={undo} compact={!desktop} />}
        </div>
      </div>

      <h1 className="min-w-0">
        <EditableText value={m.title} label={t('detail.title')} canEdit={canEdit} validate={required} onSave={(v) => change(t('proposal.titleEdited'), { title: v }, { title: m.title })} displayClassName="font-sans text-lg font-semibold leading-snug md:text-[1.375rem]" />
      </h1>

      <div className="grid min-h-0 flex-1 md:grid-rows-[minmax(0,1fr)] gap-x-8 gap-y-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
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
              <AreaChip areaId={m.area_id} />
            )}
            {/* The state keeps the light and the word, no pill (J2-A-05); one size up so that the area chip, which keeps its color (UD-045), does not outweigh it. */}
            <StatusBadge status={m.status} quiet className="text-sm" />
            <span data-repeat-ok="person" className="inline-flex items-center gap-1.5">
              <Avatar name={memberName(m.author_id) || '?'} size={20} />
              {memberName(m.author_id)}
            </span>
            <time dateTime={m.created_at} className="tabular-nums">
              {format.stamp(m.created_at)}
            </time>
            {m.edited_at && (
              <time dateTime={m.edited_at} data-testid="edited-mark" className="tabular-nums">
                {t('published.edited', { when: format.stamp(m.edited_at) })}
              </time>
            )}
            {m.input_id && <AiMark />}
          </div>

          {canEdit ? (
            <RecipientsEditor ids={m.assignee_ids} max={desktop ? 4 : 2} onChange={(ids) => void change(t('proposal.recipientsChanged'), { assignee_ids: ids }, { assignee_ids: m.assignee_ids })} />
          ) : (
            <Recipients ids={m.assignee_ids} max={desktop ? 4 : 2} />
          )}

          {/* What was attached comes before the words (mockup: «Previsualización de»): the gallery shows the medium and its siblings. */}
          <MediaGallery items={toGalleryItems(m.attachments)} className="shrink-0" />

          {/* A long text has no cap: the message column scrolls inside, and it is a declared lane. */}
          <div data-lane="message-body" className="scroll-thin flex min-h-0 flex-initial flex-col gap-3 overflow-y-auto px-1.5 py-1">
            <EditableText value={m.body} label={t('detail.body')} multiline prose canEdit={canEdit} validate={required} onSave={(v) => change(t('proposal.bodyEdited'), { body: v }, { body: m.body })} displayClassName="text-read" />
            <TemplateFields
              template={template}
              values={m.fields}
              canEdit={canEdit}
              closed={closed}
              onSave={(name, value) => change(t('proposal.fieldEdited'), { fields: { ...(m.fields ?? {}), [name]: value } }, { fields: m.fields ?? {} })}
            />
          </div>

        </div>

        <ReplyThread message={m} focusForm={focusReply} />
      </div>
    </Page>
  )
}
