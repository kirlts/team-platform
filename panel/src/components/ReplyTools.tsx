import { useRef } from 'react'
import { Plus, X } from '@/components/icons'
import { useErrorText, useT } from '@/i18n'
import { MEDIA_KEY } from '@/lib/media'
import { useNotices } from '@/lib/notices'
import type { MessageDetail, Reply } from '@team-platform/client'
import { useAddReplyAttachments, useEditReply, useMe } from '@team-platform/client/react'
import { useLookups } from './lookups'
import { MemberPicker } from './MemberPicker'
import { RecordAudioButton } from './MediaDraft'

/**
 * What the author does to their own reply besides its text (UD-279), with the same words as a message: «+ Adjunto» to add files, a cross on each file to
 * take it off, and «+ Mención» to call someone later. A mention added here also leaves its «@Name» at the end of the text, as if it had been typed, and
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
      {(reply.attachments ?? []).map((a) => (
        <li key={a.id} className="flex min-h-8 min-w-0 max-w-full items-center gap-1 rounded-md border border-line-strong bg-surface py-0.5 pl-2 pr-0.5 data-[bare]:pl-0.5" data-bare={a.kind === 'image' || undefined}>
          {/* A picture is already open above, with its own label: its chip is the cross alone. */}
          {a.kind !== 'image' && <span className="min-w-0 max-w-[14rem] text-xs leading-tight text-muted [overflow-wrap:anywhere]">{a.name}</span>}
          <button
            type="button"
            disabled={edit.isPending}
            onClick={() => edit.mutate({ replyId: reply.id, remove_attachment_ids: [a.id] }, { onError: fail })}
            aria-label={t('media.remove', { name: a.name ?? t(MEDIA_KEY[a.kind]) })}
            className="hit inline-flex shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-danger"
          >
            <X size={13} aria-hidden />
          </button>
        </li>
      ))}
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
        <button type="button" disabled={add.isPending} onClick={() => input.current?.click()} aria-label={t('published.addFiles')} title={t('published.addFiles')} className="hit inline-flex min-h-8 items-center justify-center gap-1 rounded-full px-3 text-sm font-semibold text-muted hover:bg-hover hover:text-accent disabled:opacity-50 pointer-coarse:min-h-11">
          <Plus size={16} aria-hidden /> {t('media.addShort')}
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
