import { Send } from '@/components/icons'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { useMe, useMembers } from '@team-platform/client/react'
import { useMediaDraft } from '@/lib/useMediaDraft'
import { cn } from '@/lib/utils'
import { CaptureButtons, ClipMenu, MediaDraftList, RecordingStatus } from './MediaDraft'
import { NativeSelect } from './NativeSelect'
import { RecipientsEditor } from './RecipientsEditor'

export interface SendDraft {
  text: string
  files: File[]
  links: string[]
  /** «Enviar como» (UD-255): the member chosen; absent when it is the member of the session. */
  asMemberId?: string
  /** Recipients (UD-291): the members it is addressed to, an agent among them; absent when the automatic routing assigns. */
  recipientIds?: string[]
}

/**
 * «Enviar como» (UD-255): every active person of the team, the member of the session first selected. A member of kind
 * agent is not offered: the API refuses to send in its name.
 */
function SendAs({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const t = useT()
  const me = useMe().data
  const members = useMembers().data ?? []
  const people = members.filter((m) => m.active !== false && (m as { kind?: string }).kind !== 'agent')
  if (me && !people.some((m) => m.id === me.id)) people.unshift(me)
  return (
    <label className="flex min-w-0 items-center gap-2 text-sm text-muted max-md:min-w-[14rem] max-md:flex-1 md:ml-auto">
      <span className="shrink-0">{t('compose.sendAs')}</span>
      <span className="min-w-0 flex-1 md:w-44 md:flex-none">
        <NativeSelect data-testid="compose-send-as" className="pointer-coarse:h-11" value={value} onChange={(e) => onChange(e.target.value)}>
          {people.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
      </span>
    </label>
  )
}

/**
 * New message bar: text, attachments (clip, drag, paste), a photo from the camera, a recorded audio
 * and links. On send the bar empties at once and is ready for the next one (UD-025): the upload and
 * the analysis go on in the tray, never here; so does a failed upload, with its own Reintentar.
 */
/** «Enviar» is glass while there is nothing to send and gel once there is (DISENO.md, «Jerarquía y distribución»): a disabled gel would be the only gel of the screen at rest. */
export function ComposeBar({ onSubmit }: { onSubmit: (draft: SendDraft) => void }) {
  const t = useT()
  const draft = useMediaDraft()
  const me = useMe().data
  const [text, setText] = useState('')
  /** The member chosen in «Enviar como»; empty means the member of the session (the default, UD-255). */
  const [sendAs, setSendAs] = useState('')
  const author = sendAs || me?.id || ''
  /** «Para» (UD-291): the members the send is addressed to. Empty means the automatic routing assigns, as it always did. */
  const [recipients, setRecipients] = useState<string[]>([])
  const members = useMembers().data ?? []
  /**
   * Changing the author drops that member from «Para»: a message is not sent to whoever writes it (UD-300). The effect is said under the controls, where the
   * change was made, with the way back; it stays until the next thing the person does (an edit, another choice, the send), so it never floats over a control.
   */
  const [left, setLeft] = useState<{ name: string; sendAs: string; recipients: string[] } | null>(null)
  const changeAuthor = (id: string) => {
    setSendAs(id)
    setRecipients((list) => list.filter((x) => x !== id))
    setLeft(recipients.includes(id) ? { name: members.find((m) => m.id === id)?.name ?? '', sendAs, recipients } : null)
  }
  const [dragging, setDragging] = useState(false)
  const textArea = useRef<HTMLTextAreaElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [grown, setGrown] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  /** Height of the bar at rest: the slot the page keeps for it while the bar grows over what is below (J2-B-02). */
  const [rest, setRest] = useState<number | null>(null)

  const empty = !text.trim() && draft.empty
  // Growing (more lines, attachments, a link) happens over the page, never pushing it down.
  const expanded = grown || !draft.empty || draft.linkOpen || !!draft.recording || !!left
  // The slot is measured only while the bar is empty, which is the one state that is always one row: measuring while it grows
  // would take the grown height for the resting one.
  const emptyNow = useRef(true)
  emptyNow.current = !text && draft.empty && !draft.linkOpen && !draft.recording && !left

  // The field grows with its text up to a maximum and from there it scrolls inside.
  useEffect(() => {
    const el = textArea.current
    if (!el) return
    el.style.height = 'auto'
    const style = getComputedStyle(el)
    el.style.height = `${Math.min(el.scrollHeight, parseFloat(style.maxHeight))}px`
    // Grown is relative to the resting height of the field (its `min-height`), not to a number of pixels.
    setGrown(el.scrollHeight > parseFloat(style.minHeight) + 2)
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
    onSubmit({ text, files, links, ...(me && author && author !== me.id ? { asMemberId: author } : {}), ...(recipients.length > 0 ? { recipientIds: recipients } : {}) })
    // The files are handed over: only the previews are released, the Files themselves live on in the upload.
    draft.clear()
    setText('')
    setLeft(null)
    setRecipients([])
    textArea.current?.focus()
  }

  return (
    <div className="relative z-20 w-full" style={{ height: rest ?? undefined }}>
    {/* While the bar grows over the page, what is below is dimmed: the bar reads as a layer over it, and no sliver of the card under it shows (J3-B-01). It lets the pointer through. */}
    {expanded && <div aria-hidden data-compose-scrim className="pointer-events-none fixed inset-0 bg-[oklch(0.2_0.06_262/0.28)] backdrop-blur-[2px]" />}
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
      className={cn('leaf transition-[border-color] duration-[var(--duration-hover)] focus-within:border-accent', expanded ? 'pop absolute inset-x-0 top-0' : 'glass', dragging && '!border-accent !bg-accent-soft')}
    >
      <div className="px-bar-pad pt-bar-pad">
        {draft.recording ? (
          <RecordingStatus seconds={draft.recording.seconds} />
        ) : (
          <textarea
            ref={textArea}
            rows={1}
            value={text}
            aria-label={t('compose.label')}
            data-testid="compose-text"
            placeholder={t('compose.placeholder')}
            onChange={(e) => {
              setText(e.target.value)
              setLeft(null)
            }}
            onPaste={draft.onPaste}
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
            data-scrolled={scrolled}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                send()
              }
            }}
            className="block max-h-[8lh] min-h-[3.5rem] w-full min-w-0 resize-none bg-transparent text-base placeholder:text-faint focus-visible:outline-none md:min-h-[3.5rem] [@media(min-height:800px)]:md:min-h-[4.5rem]"
          />
        )}
      </div>
      {/* The files sit with the text they go with, before the controls: the same order as the reply form. Under the action they read as something sent apart. */}
      <MediaDraftList draft={draft} />
      {/* Two rows that do not depend on how many people are chosen: who it goes to and in whose name on top, the tools and the one action below. A row that held everything split in two when «Para» grew, and left a gap where the tools ended. On a phone the tools go first, then the author row, and the action takes the row. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3 pt-2">
        <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 max-md:order-2 md:order-1">
          <div className="min-w-0" data-testid="compose-to">
            <RecipientsEditor ids={recipients} onChange={(ids) => { setRecipients(ids); setLeft(null) }} max={2} to={t('compose.to')} authorId={author} />
          </div>
          {author && <SendAs value={author} onChange={changeAuthor} />}
          {left && (
            <p role="status" data-testid="compose-left-to" className="flex w-full items-center gap-3 text-sm text-fg">
              {t('compose.leftTo', { name: left.name, to: t('compose.to') })}
              <button
                type="button"
                className="inline-flex min-h-6 items-center font-semibold text-accent hover:underline pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                onClick={() => {
                  setSendAs(left.sendAs)
                  setRecipients(left.recipients)
                  setLeft(null)
                }}
              >
                {t('undo.undo')}
              </button>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 max-md:order-1 max-md:gap-0 md:order-2">
          <ClipMenu draft={draft} labeled />
          <CaptureButtons draft={draft} labeled />
        </div>
        <Button variant={empty || draft.recording ? 'secondary' : 'primary'} size="lg" data-testid="compose-send" title={t('compose.sendHint')} disabled={empty || !!draft.recording} onClick={send} className="max-md:order-3 max-md:w-full max-md:justify-center md:order-3 md:ml-auto">
          <Send size={16} aria-hidden /> {t('compose.send')}
        </Button>
      </div>
    </div>
    </div>
  )
}
