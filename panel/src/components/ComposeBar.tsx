import { Send } from '@/components/icons'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useMediaDraft } from '@/lib/useMediaDraft'
import { cn } from '@/lib/utils'
import { CaptureButtons, ClipMenu, MediaDraftList, RecordingStatus } from './MediaDraft'

export interface SendDraft {
  text: string
  files: File[]
  links: string[]
}

/**
 * New message bar: text, attachments (clip, drag, paste), a photo from the camera, a recorded audio
 * and links. On send the bar empties at once and is ready for the next one (UD-025): the upload and
 * the analysis go on in the tray, never here. `problem` is the reason the last upload was rejected,
 * shown under the bar until the next send.
 */
export function ComposeBar({ onSubmit, problem }: { onSubmit: (draft: SendDraft) => void; problem?: string | null }) {
  const t = useT()
  const draft = useMediaDraft()
  const [text, setText] = useState('')
  const [dragging, setDragging] = useState(false)
  const textArea = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [grown, setGrown] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  /** Height of the bar at rest: the slot the page keeps for it while the bar grows over what is below (J2-B-02). */
  const [rest, setRest] = useState<number | null>(null)

  const empty = !text.trim() && draft.empty
  // Growing (more lines, attachments, a link, a problem) happens over the page, never pushing it down.
  const expanded = grown || !draft.empty || draft.linkOpen || !!problem || !!draft.recording
  // The slot is measured only while the bar is empty, which is the one state that is always one row: measuring while it grows
  // would take the grown height for the resting one.
  const emptyNow = useRef(true)
  emptyNow.current = !text && draft.empty && !draft.linkOpen && !problem && !draft.recording

  // The field grows with its text up to a maximum and from there it scrolls inside.
  useEffect(() => {
    const el = textArea.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    setGrown(el.scrollHeight > 40)
    setScrolled(el.scrollTop > 0)
  }, [text])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => {
      if (emptyNow.current) setRest(el.offsetHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const send = () => {
    if (empty || draft.recording) return
    const files = draft.locals.map((l) => l.file)
    const links = draft.links
    onSubmit({ text, files, links })
    // The files are handed over: only the previews are released, the Files themselves live on in the upload.
    draft.clear()
    setText('')
    textArea.current?.focus()
  }

  return (
    <div className="relative z-20" style={{ height: rest ?? undefined }}>
    {/* While the bar grows over the page, what is below is dimmed: the bar reads as a layer over it, and no sliver of the card under it shows (J3-B-01). It lets the pointer through. */}
    {expanded && <div aria-hidden data-compose-scrim className="pointer-events-none fixed inset-0 bg-[oklch(0.2_0.06_262/0.28)]" />}
    <div
      ref={box}
      data-compose-box
      data-expanded={expanded}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        setDragging(false)
        draft.onDrop(e)
      }}
      className={cn('leaf transition-[border-color] duration-150 focus-within:border-accent', expanded ? 'pop absolute inset-x-0 top-0' : 'glass', dragging && '!border-accent !bg-accent-soft')}
    >
      <div className="flex flex-wrap items-end gap-1.5 p-2">
        <ClipMenu draft={draft} />
        {draft.recording ? (
          <RecordingStatus seconds={draft.recording.seconds} />
        ) : (
          <textarea
            ref={textArea}
            rows={1}
            value={text}
            aria-label={t('compose.label')}
            placeholder={t('compose.placeholder')}
            onChange={(e) => setText(e.target.value)}
            onPaste={draft.onPaste}
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
            data-scrolled={scrolled}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                send()
              }
            }}
            className="max-h-[120px] min-h-8 min-w-0 flex-1 basis-40 resize-none bg-transparent px-2 py-1.5 placeholder:text-faint focus-visible:outline-none max-sm:order-first max-sm:basis-full"
          />
        )}
        <CaptureButtons draft={draft} />
        <Button variant="primary" size="icon" className="max-sm:ml-auto" aria-label={t('compose.send')} title={t('compose.sendHint')} disabled={empty || !!draft.recording} onClick={send}>
          <Send size={16} aria-hidden />
        </Button>
      </div>

      <MediaDraftList draft={draft} />

      {problem && (
        <div role="alert" className="border-t border-line px-3 py-1.5 text-xs text-danger">
          {t('compose.sendFailed', { reason: problem })}
        </div>
      )}
    </div>
    </div>
  )
}
