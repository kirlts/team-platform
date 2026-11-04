import { useState } from 'react'
import { Check } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useErrorText, useT } from '@/i18n'
import { useMe, useReply } from '@team-platform/client/react'
import type { Member } from '@team-platform/client'
import { activeMentions } from '@/lib/mention'
import { DRAFT_PREFIX, useDraft } from '@/lib/useDraft'
import { useLeaveWarning } from '@/lib/useLeaveWarning'
import { useMediaDraft } from '@/lib/useMediaDraft'
import { useLookups } from './lookups'
import { MentionTextarea } from './MentionTextarea'
import { CaptureButtons, ClipMenu, MediaDraftList, RecordingStatus } from './MediaDraft'

/** What a reply holds that can be kept across a visit to another screen: the text and the people picked in it (TP-04). */
interface ReplyDraft {
  body: string
  picked: Member[]
}
const EMPTY_REPLY: ReplyDraft = { body: '', picked: [] }

/** Reply to a message: text and, as in the send bar, clip, camera and microphone. */
export function ReplyForm({ messageId, onSent, autoFocus, children, senderMode = false }: { messageId: string; onSent?: () => void; autoFocus?: boolean; children?: React.ReactNode; /** The sender of the message writes only to call someone (UD-278): without a mention there is nothing to send. */ senderMode?: boolean }) {
  const t = useT()
  // Sending is confirmed in the form itself, until the next word is typed: a notice floats over the bottom of a phone, exactly where this form sits (J4-flow-04).
  const [sent, setSent] = useState(false)
  const errorText = useErrorText()
  const draft = useMediaDraft()
  const reply = useReply(messageId)
  const me = useMe().data
  const { activeMembers } = useLookups()
  // The text outlives the form: a link of the sidebar or Atrás unmounts it. The files cannot be kept, so leaving by reload asks first.
  const text = useDraft<ReplyDraft>(`${DRAFT_PREFIX}reply:${messageId}`, EMPTY_REPLY, me?.id)
  const { body, picked } = text.value
  const setBody = (next: string) => text.setValue((previous) => ({ ...previous, body: next }))
  const setPicked = (next: Member[]) => text.setValue((previous) => ({ ...previous, picked: next }))
  useLeaveWarning(!draft.empty || !!draft.recording)
  const mentions = activeMentions(body, picked) // a token the person erased is no longer a mention
  const noMention = senderMode && mentions.length === 0

  const submit = () => {
    if ((!body.trim() && draft.empty) || noMention || reply.isPending || draft.recording) return
    reply.mutate(
      { body: body.trim(), kind: 'answer', files: draft.locals.map((l) => l.file), links: draft.links, mention_ids: mentions.map((m) => m.id) },
      {
        onSuccess: () => {
          text.clear()
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
          <MentionTextarea
            aria-label={t('reply.label')}
            id="reply-field"
            placeholder={t('reply.placeholder')}
            candidates={activeMembers.filter((m) => m.id !== me?.id)}
            picked={picked}
            onPick={setPicked}
            autoFocus={autoFocus}
            rows={2}
            value={body}
            onChange={(text) => {
              setBody(text)
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
      <div className="flex flex-wrap items-center justify-end gap-4">
        {noMention && (body.trim() !== '' || !draft.empty) && (
          <p role="status" className="mr-auto min-w-0 flex-1 text-xs text-muted">
            {t('reply.missingMention')}
          </p>
        )}
        {children}
        <Button type="submit" variant="primary" disabled={(!body.trim() && draft.empty) || noMention || reply.isPending || !!draft.recording}>
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
