import { Send } from '@/components/icons'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useErrorText, useT } from '@/i18n'
import { uploadInput, type CreatedInput } from '@/lib/upload'
import { useMediaDraft } from '@/lib/useMediaDraft'
import { cn } from '@/lib/utils'
import { CaptureButtons, ClipMenu, MediaDraftList, RecordingStatus } from './MediaDraft'

/**
 * New message bar: text, attachments (clip, drag, paste), camera photo,
 * recorded audio and links. A single multipart submit with upload progress.
 */
export function ComposeBar({ onCreated, disabled }: { onCreated: (created: CreatedInput) => void; disabled?: boolean }) {
  const t = useT()
  const errorText = useErrorText()
  const draft = useMediaDraft()
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const textArea = useRef<HTMLTextAreaElement>(null)

  const uploading = progress !== null
  const busy = uploading || !!disabled
  const empty = !text.trim() && draft.empty

  // The field grows with its text up to a maximum and from there scrolls inside.
  useEffect(() => {
    const el = textArea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [text])

  const send = async () => {
    if (empty || busy || draft.recording) return
    setError(null)
    setProgress(0)
    try {
      const created = await uploadInput({ text, files: draft.locals.map((l) => l.file), links: draft.links }, setProgress)
      draft.clear()
      setText('')
      onCreated(created)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false)
        draft.onDrop(e)
      }}
      className={cn('glass leaf transition-colors duration-150 focus-within:border-accent', dragging && '!border-accent !bg-accent-soft', busy && 'opacity-70')}
    >
      <div className="flex flex-wrap items-end gap-1.5 p-2">
        <ClipMenu draft={draft} disabled={busy} />
        {draft.recording ? (
          <RecordingStatus seconds={draft.recording.seconds} />
        ) : (
          <textarea
            ref={textArea}
            rows={1}
            value={text}
            disabled={busy}
            aria-label={t('compose.label')}
            placeholder={t('compose.placeholder')}
            onChange={(e) => setText(e.target.value)}
            onPaste={draft.onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void send()
              }
            }}
            className="max-h-[120px] min-h-8 min-w-0 flex-1 basis-40 resize-none bg-transparent px-2 py-1.5 placeholder:text-faint focus-visible:outline-none"
          />
        )}
        <CaptureButtons draft={draft} disabled={busy} />
        <Button variant="primary" size="icon" aria-label={t('compose.send')} title={t('compose.sendHint')} disabled={empty || busy || !!draft.recording} onClick={() => void send()}>
          <Send size={16} aria-hidden />
        </Button>
      </div>

      <MediaDraftList draft={draft} busy={busy} />

      {uploading && (
        <div role="progressbar" aria-label={t('compose.upload')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((progress ?? 0) * 100)} className="meter mx-3 mb-3 h-2">
          <div className="meter-fill" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-xs text-danger">
          <span>{t('compose.sendFailed', { reason: error })}</span>
          {!uploading && !empty && (
            <Button size="sm" variant="secondary" onClick={() => void send()}>
              {t('common.retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
