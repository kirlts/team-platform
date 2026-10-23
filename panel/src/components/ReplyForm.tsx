import { useState } from 'react'
import { Check } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { useErrorText, useT, type MessageKey } from '@/i18n'
import type { ReplyKind } from '@team-platform/client'
import { useReply } from '@team-platform/client/react'
import { useMediaDraft } from '@/lib/useMediaDraft'
import { CaptureButtons, ClipMenu, MediaDraftList, RecordingStatus } from './MediaDraft'
import { Segmented } from './Segmented'

export const KIND_KEY: Record<ReplyKind, MessageKey> = {
  answer: 'reply.kind.answer',
  fix: 'reply.kind.fix',
  clarification: 'reply.kind.clarification',
}

const KINDS = Object.keys(KIND_KEY) as ReplyKind[]

/** Reply to a message: text, type and, as in the send bar, clip, camera and microphone. */
export function ReplyForm({ messageId, onSent, autoFocus, children }: { messageId: string; onSent?: () => void; autoFocus?: boolean; children?: React.ReactNode }) {
  const t = useT()
  // Sending is confirmed in the form itself, until the next word is typed: a notice floats over the bottom of a phone, exactly where this form sits (J4-flow-04).
  const [sent, setSent] = useState(false)
  const errorText = useErrorText()
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<ReplyKind>('answer')
  const draft = useMediaDraft()
  const reply = useReply(messageId)

  const submit = () => {
    if (!body.trim() || reply.isPending || draft.recording) return
    reply.mutate(
      { body: body.trim(), kind, files: draft.locals.map((l) => l.file), links: draft.links },
      {
        onSuccess: () => {
          setBody('')
          setKind('answer')
          draft.clear()
          setSent(true)
          onSent?.()
        },
      },
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onDrop={draft.onDrop}
      onDragOver={(e) => e.preventDefault()}
      className="flex flex-col gap-2"
    >
      <div className="glass leaf relative overflow-hidden">
        {draft.recording ? (
          <RecordingStatus seconds={draft.recording.seconds} />
        ) : (
          <Textarea
            aria-label={t('reply.label')}
            id="reply-field"
            placeholder={t('reply.placeholder')}
            autoFocus={autoFocus}
            rows={2}
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              setSent(false)
            }}
            onPaste={draft.onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                submit()
              }
            }}
            className="!rounded-none !border-0 bg-transparent !shadow-none"
          />
        )}
        <MediaDraftList draft={draft} busy={reply.isPending} />
        {/* The media buttons belong to the text they attach to: inside its frame, so the line below carries only the type and Responder (J2-A-22). */}
        <div className="flex flex-wrap items-center gap-0.5 px-1.5 pb-1">
          <ClipMenu draft={draft} disabled={reply.isPending} size="icon-sm" labeled />
          <CaptureButtons draft={draft} disabled={reply.isPending} size="icon-sm" labeled />
        </div>
        {/* The confirmation is drawn over the empty corner of the field, inside its frame: it takes no row, so nothing below it moves (J5-flow-reply-close). */}
        {sent && (
          <p role="status" className="pointer-events-none absolute right-3 top-2.5 flex items-center gap-1.5 text-xs text-muted">
            <Check size={14} aria-hidden className="text-accent" />
            {t('reply.sent')}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* The group says what it chooses; the type is a property of this reply and does not close the message (J4-detail-01, J4-flow-02). */}
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden className="text-xs text-muted">
            {t('reply.kind.short')}
          </span>
          <Segmented label={t('reply.kind.label')} size="sm" value={kind} onChange={setKind} options={KINDS.map((value) => ({ value, label: t(KIND_KEY[value]) }))} />
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-4">
          {children}
          <Button type="submit" variant="primary" disabled={!body.trim() || reply.isPending || !!draft.recording}>
            {t('reply.send')}
          </Button>
        </div>
      </div>
      {reply.isError && (
        <p role="alert" className="text-xs text-danger">
          {errorText(reply.error)}
        </p>
      )}
    </form>
  )
}
