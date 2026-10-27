import { ArrowLeft, MessageSquare, Trash2, X } from '@/components/icons'
import { useRef, type ClipboardEvent, type DragEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { AreaChip } from '@/components/AreaChip'
import { AreaPicker } from '@/components/AreaPicker'
import { AddTile, MediaGallery } from '@/components/MediaGallery'
import { RecordAudioButton } from '@/components/MediaDraft'
import { Details } from '@/components/Details'
import { Badge } from '@/components/ui/badge'
import { toGalleryItems } from '@/lib/gallery'
import { Avatar } from '@/components/Avatar'
import { EmptyState } from '@/components/EmptyState'
import { EditableText } from '@/components/EditableText'
import { ForwardMessage } from '@/components/ForwardMessage'
import { LoadState } from '@/components/LoadState'
import { useLookups } from '@/components/lookups'
import { canReplyTo } from '@/lib/handoff'
import { Page } from '@/components/Page'
import { ReviewPending } from '@/components/ReviewPending'
import { AgentWork } from '@/components/AgentWork'
import { Recipients } from '@/components/Recipients'
import { RecipientsEditor } from '@/components/RecipientsEditor'
import { ReplyThread } from '@/components/ReplyThread'
import { StatusBadge } from '@/components/StatusBadge'
import { TemplateFields } from '@/components/TemplateFields'
import { UndoButtons } from '@/components/UndoButtons'
import { Button } from '@/components/ui/button'
import { useErrorText, useFormat, useT } from '@/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys, TeamApiError, type MessageDetail as Detail, type MessagePatch, type Template } from '@team-platform/client'
import { useAddAttachments, useDeleteMessage, useMe, useMessage, usePatchMessage, useRestoreMessage, useTemplates } from '@team-platform/client/react'
import { useNotices } from '@/lib/notices'
import { parseTemplateFields, remapFields } from '@/lib/template'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'
import { useDesktop } from '@/lib/useDesktop'

/** The way back to the list: a target of 44 px on a phone and never under 24 (WCAG 2.5.8). */
function BackLink() {
  const t = useT()
  return (
    <div className="flex items-center">
      <Link to="/messages" className="inline-flex min-h-6 items-center gap-1 text-xs text-muted hover:text-fg max-md:min-h-11 pointer-coarse:min-h-11">
        <ArrowLeft size={13} aria-hidden /> {t('nav.messages')}
      </Link>
    </div>
  )
}

export function MessageDetail() {
  const t = useT()
  const { id } = useParams()
  const [params] = useSearchParams()
  const message = useMessage(id)
  const undo = useUndoStack()

  // The waiting and failing states keep the frame of the sheet (the way back, the two columns), so nothing is rearranged when the message arrives (B2).
  if (message.isPending) {
    return (
      <Page cols="fill">
        <BackLink />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-x-8 gap-y-4 md:grid-cols-[minmax(0,1fr)_clamp(26rem,28%,28rem)]">
          <div className="glass leaf">
            <LoadState query={message} rows={3} />
          </div>
          <div className="glass leaf max-md:hidden">
            <LoadState query={message} rows={2} />
          </div>
        </div>
      </Page>
    )
  }
  if (message.isError) {
    const missing = message.error instanceof TeamApiError && message.error.status === 404
    return (
      <Page cols="fill">
        <BackLink />
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
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-x-8 gap-y-4 md:grid-cols-[minmax(0,1fr)_clamp(26rem,28%,28rem)]">
            <div className="glass leaf">
              <LoadState query={message} />
            </div>
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
  const del = useDeleteMessage()
  const restore = useRestoreMessage()
  const notices = useNotices()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { memberName, members } = useLookups()
  const templates = useTemplates(m.area_id)
  const template: Template | undefined = templates.data?.find((x) => x.id === m.template_id) ?? templates.data?.[0]
  // On a phone two chips fit before the rest fold behind «+N»: a name takes a whole row (J2-A-21).
  const desktop = useDesktop()
  const closed = m.status === 'closed'
  // Only the sender edits a published message, the Editor included (UD-071).
  const canEdit = !!me && me.id === m.author_id
  const canReply = canReplyTo(m, me?.id, members) // the sender too, while they hold the question of a handoff (UD-269)
  // The sender or any person of the team deletes (UD-240, UD-287). No dialog: it is done, the list this came from is shown again, and the strip carries Deshacer.
  const canDelete = !!me
  const remove = async () => {
    await del.mutateAsync(m.id)
    // Back to the list this was opened from; without a page behind (a pasted address), to Mensajes.
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1)
    else navigate('/messages')
    notices.show({
      text: t('detail.deleted'),
      action: {
        label: t('undo.undo'),
        run: async () => {
          await restore.mutateAsync(m.id)
          notices.show({ text: t('detail.restored'), link: { to: `/messages/${m.id}`, label: m.title } })
        },
      },
    })
  }

  /** A change to the message: what is requested and what undoes it. */
  const change = (label: string, forward: MessagePatch, back: MessagePatch) =>
    undo.run({ label, redo: () => patchMessage.mutateAsync({ id: m.id, patch: forward }), undo: () => patchMessage.mutateAsync({ id: m.id, patch: back }) })

  const required = (v: string) => (v.trim() ? null : t('common.required'))

  // Files and links join the end of the message and count as an edit (UD-071). They are not on the Deshacer stack
  // (the server has no call that deletes a file), but each one can be removed afterwards with «Quitar».
  const addFiles = useAddAttachments()
  const errorText = useErrorText()
  const picker = useRef<HTMLInputElement>(null)
  const add = (files: File[], links: string[] = []) => {
    if (!files.length && !links.length) return
    addFiles.mutate({ id: m.id, files, links }, { onError: (err) => notices.show({ text: errorText(err) }) })
  }
  const onDrop = (e: DragEvent) => {
    const files = [...e.dataTransfer.files]
    if (!canEdit || !files.length) return
    e.preventDefault()
    add(files)
  }
  const onPaste = (e: ClipboardEvent) => {
    if (!canEdit || (e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return
    const files = [...e.clipboardData.files]
    const text = e.clipboardData.getData('text').trim()
    const link = /^https?:\/\/\S+$/.test(text) ? [text] : []
    if (!files.length && !link.length) return
    e.preventDefault()
    add(files, link)
  }
  /** Takes one file out of the message. The ids come from the cache at that moment, so what others added in between is kept. */
  const idsNow = () => (qc.getQueryData(queryKeys.message(m.id)) as Detail | undefined)?.attachments.map((a) => a.id) ?? m.attachments.map((a) => a.id)
  const removeAttachment = (attId: string) =>
    undo
      .run({
        label: t('proposal.attachmentsChanged'),
        redo: () => patchMessage.mutateAsync({ id: m.id, patch: { attachment_ids: idsNow().filter((x) => x !== attId) } }),
        undo: () => patchMessage.mutateAsync({ id: m.id, patch: { attachment_ids: idsNow().includes(attId) ? idsNow() : [...idsNow(), attId] } }),
      })
      .catch((err) => notices.show({ text: errorText(err) }))

  /** The count of the thread: a label and its number. */
  const counter = (
    <span data-testid="reply-count" className="inline-flex shrink-0 items-center gap-1.5 self-center text-sm text-muted">
      <span>{t('replies.title')}</span>
      <Badge tone="neutral" className="tabular-nums">
        {m.replies.length}
      </Badge>
    </span>
  )
  /** Reenviar and Borrar: with their words beside the title, as icons with a name on a phone, where the row of the way back has room for them. */
  const actions = (
    <>
      {m.status !== 'closed' && <ForwardMessage messageId={m.id} iconOnly={!desktop} />}
      {canDelete && (
        <Button size={desktop ? 'sm' : 'icon'} variant="ghost" className="hover:text-danger max-md:h-11 max-md:w-11" aria-label={t('detail.delete')} title={t('detail.delete')} disabled={del.isPending} onClick={() => void remove()}>
          <Trash2 size={14} aria-hidden /> {desktop && t('detail.delete')}
        </Button>
      )}
    </>
  )

  return (
    <Page cols="fill">
      {/* The top row keeps the way back and what undoes; the actions on the message sit in the title row (UD-309). On a phone they come up to this row as icons of 44 px, so the title is the second line and the text of the message starts higher. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Link to="/messages" className="inline-flex min-h-6 items-center gap-1 text-xs text-muted hover:text-fg max-md:min-h-11 pointer-coarse:min-h-11">
          <ArrowLeft size={13} aria-hidden /> {t('nav.messages')}
        </Link>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {/* The thread and the message come before the field (the page is about 1.9 windows long on a phone): a way to it from the first screen. */}
          {!desktop && canReply && (
            <a
              href="#reply-field"
              onClick={(e) => {
                e.preventDefault()
                document.getElementById('reply-field')?.focus()
              }}
              className="btn btn-ghost h-8 gap-1 px-4 text-sm max-md:h-11" /* the same face as «Reenviar» and «Borrar»: one hierarchy, one look */
            >
              <MessageSquare size={14} aria-hidden /> {t('reply.jump')}
            </a>
          )}
          {!desktop && actions}
          {/* The author of a reply edits it here too (UD-253): the history is theirs as well. */}
          {(canEdit || (!!me && m.replies.some((r) => r.author_id === me.id))) && <UndoButtons stack={undo} compact={!desktop} />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-[16rem] items-baseline gap-2">
          {/* The number of the message, as a tracker shows it next to the title (#115): the team refers to messages by it. */}
          <span data-testid="detail-number" className="shrink-0 text-sm tabular-nums text-muted md:text-base">#{m.id}</span>
          {/* The title takes the whole row while its field is open (CSS, in the same frame: no jump); otherwise the reply counter sits right after its last word. */}
          <h1 className="min-w-0 flex-1 has-[textarea]:mr-3 md:flex-none md:has-[textarea]:flex-1">
            <EditableText value={m.title} label={t('detail.title')} canEdit={canEdit} validate={required} onSave={(v) => change(t('proposal.titleEdited'), { title: v }, { title: m.title })} displayClassName="font-sans text-[length:var(--h1-size)] font-[number:var(--h1-weight)] leading-snug" />
          </h1>
          {/* The count of the thread, next to the title on a wide window; on a phone it joins the line of state and author below. */}
          {desktop && counter}
        </div>
        {desktop && <div className="ml-auto flex shrink-0 items-center gap-x-3">{actions}</div>}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] gap-x-8 gap-y-4 md:grid-cols-[minmax(0,1fr)_clamp(26rem,28%,28rem)]">
        {/* The column is the lane (UD-299): from 768 px the screen keeps its height and the whole column scrolls, so the text of the message is never the block that shrinks to a line. */}
        <div data-lane="message-column" className="scroll-thin flex min-h-0 min-w-0 flex-col gap-3 md:overflow-y-auto md:pr-1 [&>*]:shrink-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
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
            {m.sent_by_id && m.sent_by_id !== m.author_id && <span data-testid="sent-by">{t('published.sentBy', { name: memberName(m.sent_by_id) })}</span>}
            <time dateTime={m.created_at} className="tabular-nums">
              {format.stamp(m.created_at)}
            </time>
            {!desktop && counter}
            {m.edited_at && (
              <time dateTime={m.edited_at} data-testid="edited-mark" className="tabular-nums">
                {t('published.edited', { when: format.stamp(m.edited_at) })}
              </time>
            )}
            {/* The recipients share the line of the badges while they fit and wrap right under them when they do not. */}
            {canEdit ? (
            <RecipientsEditor compact ids={m.assignee_ids} authorId={m.author_id} max={desktop ? 4 : 2} onChange={(ids) => void change(t('proposal.recipientsChanged'), { assignee_ids: ids }, { assignee_ids: m.assignee_ids })} />
          ) : (
            <Recipients ids={m.assignee_ids} max={desktop ? 4 : 2} touch />
          )}
          </div>

          <AgentWork message={m} />
          <ReviewPending message={m} />

          {/* What was attached comes before the words (mockup: «Previsualización de»): the gallery shows the medium and its siblings. */}
          <div className="flex min-w-0 shrink-0 flex-col gap-2" onDragOver={canEdit ? (e) => e.preventDefault() : undefined} onDrop={onDrop} onPaste={onPaste}>
            {m.attachments.length > 0 && (
              <MediaGallery
                items={toGalleryItems(m.attachments)}
                onAdd={canEdit ? () => picker.current?.click() : undefined}
                adding={addFiles.isPending}
                renderAction={
                  canEdit
                    ? (item) => (
                        <button
                          type="button"
                          data-testid="detach-attachment"
                          aria-label={t('media.remove', { name: item.name ?? t('media.attachments') })}
                          title={t('media.removeShort')}
                          disabled={patchMessage.isPending}
                          onClick={() => void removeAttachment(item.id)}
                          className="hit inline-flex items-center justify-center gap-1 rounded-md px-1.5 font-semibold text-muted hover:bg-hover hover:text-danger disabled:opacity-50 max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                        >
                          <X size={13} aria-hidden /> {t('media.removeShort')}
                        </button>
                      )
                    : undefined
                }
              />
            )}
            {canEdit && (
              <>
                <input
                  ref={picker}
                  type="file"
                  multiple
                  hidden
                  data-testid="detail-files"
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])]
                    e.target.value = ''
                    add(files)
                  }}
                />
                {/* The «+» square and the microphone are one row of ways to add: apart, the square stood alone over a button indented by another rule. */}
                <div data-testid="detail-add-row" className="flex items-center gap-2">
                  {m.attachments.length === 0 && <AddTile onAdd={() => picker.current?.click()} busy={addFiles.isPending} />}
                  <RecordAudioButton disabled={addFiles.isPending} onRecorded={(file) => add([file])} onProblem={(p) => notices.show({ text: t(p === 'microphone' ? 'media.noMicrophone' : 'media.recordFailed') })} />
                </div>
              </>
            )}
          </div>

          {/* The text takes the height it needs: no cap and no scroll of its own. */}
          <div data-message-body className="flex flex-col gap-3 px-1.5 py-1">
            <EditableText value={m.body} label={t('detail.body')} multiline canEdit={canEdit} validate={required} onSave={(v) => change(t('proposal.bodyEdited'), { body: v }, { body: m.body })} displayClassName="text-read" />
            <TemplateFields
              template={template}
              values={m.fields}
              canEdit={canEdit}
              closed={closed}
              onSave={(name, value) => change(t('proposal.fieldEdited'), { fields: { ...(m.fields ?? {}), [name]: value } }, { fields: m.fields ?? {} })}
            />
          </div>

          <Details message={m} template={template} />
        </div>

        <ReplyThread message={m} focusForm={focusReply} />
      </div>
    </Page>
  )
}
