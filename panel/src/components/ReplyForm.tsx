import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { useErrorText, useT, type MessageKey } from '@/i18n'
import { useReply } from '@/lib/queries'
import type { ReplyKind } from '@/lib/types'
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
export function ReplyForm({ messageId, onSent, autoFocus }: { messageId: string; onSent?: () => void; autoFocus?: boolean }) {
  const t = useT()
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
      <div className="glass leaf overflow-hidden">
        {draft.recording ? (
          <RecordingStatus seconds={draft.recording.seconds} />
        ) : (
          <Textarea
            aria-label={t('reply.label')}
            placeholder={t('reply.label')}
            autoFocus={autoFocus}
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
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
        <div className="flex items-center gap-0.5 px-1.5 pb-1">
          <ClipMenu draft={draft} disabled={reply.isPending} size="icon-sm" />
          <CaptureButtons draft={draft} disabled={reply.isPending} size="icon-sm" />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label={t('reply.kind.label')} size="sm" value={kind} onChange={setKind} options={KINDS.map((value) => ({ value, label: t(KIND_KEY[value]) }))} />
        <Button type="submit" variant="primary" disabled={!body.trim() || reply.isPending || !!draft.recording}>
          {t('reply.send')}
        </Button>
      </div>
      {reply.isError && (
        <p role="alert" className="text-xs text-danger">
          {errorText(reply.error)}
        </p>
      )}
    </form>
  )
}
