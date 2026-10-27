import { useRef } from 'react'
import { Paperclip } from '@/components/icons'
import { useErrorText, useT } from '@/i18n'
import { useNotices } from '@/lib/notices'
import type { MessageDetail, Reply } from '@team-platform/client'
import { useAddReplyAttachments, useEditReply, useMe } from '@team-platform/client/react'
import { useLookups } from './lookups'
import { MemberPicker } from './MemberPicker'
import { RecordAudioButton } from './MediaDraft'

/**
 * What the author does to their own reply besides its text (UD-279), with the same words as the reply form: «Adjuntar» to add files, «Grabar audio» and «+ Mención» to call someone later.
 * The files already on the reply are not drawn here again: each one carries its own «Quitar» where it is shown (`ReplyMedia`). A mention added here also leaves its «@Name» at the end of the text, as if it had been typed, and
 * has the same effects as one written with the reply (it only counts for who was not mentioned yet).
 */
export function ReplyTools({ message, reply }: { message: MessageDetail; reply: Reply }) {
  const t = useT()
  const errorText = useErrorText()
  const notices = useNotices()
  const me = useMe().data
  const { activeMembers } = useLookups()
  const add = useAddReplyAttachments(message.id)
  const edit = useEditReply(message.id)
  const input = useRef<HTMLInputElement>(null)
  const fail = (err: unknown) => notices.show({ text: errorText(err) })
  const mentioned = reply.mentions ?? []
  return (
    <ul aria-label={t('reply.tools')} data-testid="reply-tools" className="flex flex-wrap items-center gap-2 pt-1">
      <li>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          data-testid="reply-add-files"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) add.mutate({ replyId: reply.id, files }, { onError: fail })
          }}
        />
        <button type="button" disabled={add.isPending} onClick={() => input.current?.click()} aria-label={t('media.attach')} title={t('media.attach')} className="hit inline-flex min-h-8 items-center justify-center gap-1 rounded-full px-3 text-sm font-semibold text-muted hover:bg-hover hover:text-accent disabled:opacity-50 max-md:min-h-11 pointer-coarse:min-h-11">
          <Paperclip size={16} aria-hidden /> {t('media.attach')}
        </button>
      </li>
      <li className="flex items-center gap-1">
        <RecordAudioButton disabled={add.isPending} onRecorded={(file) => add.mutate({ replyId: reply.id, files: [file] }, { onError: fail })} onProblem={(p) => notices.show({ text: t(p === 'microphone' ? 'media.noMicrophone' : 'media.recordFailed') })} />
      </li>
      <li>
        <MemberPicker
          members={activeMembers.filter((m) => m.id !== me?.id)}
          selected={mentioned}
          label={t('mention.add')}
          shortLabel={t('mention.addShort')}
          onChange={(ids) => {
            const fresh = ids.filter((id) => !mentioned.includes(id))
            if (fresh.length === 0) return // a mention is not taken back here: the ones already made stay
            const tokens = fresh.map((id) => `@${activeMembers.find((m) => m.id === id)?.name ?? ''}`).join(' ')
            edit.mutate({ replyId: reply.id, body: `${reply.body.trimEnd()} ${tokens}`.trim(), mention_ids: fresh }, { onError: fail })
          }}
        />
      </li>
    </ul>
  )
}
