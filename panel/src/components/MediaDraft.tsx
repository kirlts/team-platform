import { Camera, Link2, Mic, Paperclip, Square, X } from '@/components/icons'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useFormat, useT, type MessageKey } from '@/i18n'
import { mmss } from '@/lib/format'
import { kindFromMime } from '@team-platform/client'
import type { LocalFile, MediaDraft, MediaProblem } from '@/lib/useMediaDraft'
import { cn } from '@/lib/utils'
import { canRecord, startRecording, type Recording } from '@/lib/recorder'
import { Thumb } from './Thumb'

/** A web address that wraps after its separators, so a long one breaks between path segments and not in the middle of a word (J3-B-20). */
function breakable(href: string) {
  return href.split(/(?<=[/?&=#])/).map((part, i) => (
    <span key={i}>
      {i > 0 && <wbr />}
      {part}
    </span>
  ))
}

const PROBLEM: Record<MediaProblem, MessageKey> = { record: 'media.recordFailed', microphone: 'media.noMicrophone', link: 'media.invalidLink' }

/** Clip: file or link. */
/** With `labeled` each control says its name beside the icon: a tooltip does not exist on a phone, and clip and camera look alike at 16 px (J5-message-detail). */
export function ClipMenu({ draft, disabled, size = 'icon', labeled = false }: { draft: MediaDraft; disabled?: boolean; size?: 'icon' | 'icon-sm'; labeled?: boolean }) {
  const t = useT()
  const fileInput = useRef<HTMLInputElement>(null)
  /** Set by the choice itself, read by the menu when it gives the focus back: an order of events, not a value of some render. */
  const choseLink = useRef(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={labeled ? 'sm' : size} aria-label={t('media.attach')} title={t('media.attach')} disabled={disabled} className={cn(labeled && 'px-3 max-md:gap-1 max-md:px-1.5')}>
            <Paperclip size={size === 'icon' ? 18 : 16} aria-hidden />
            {labeled && <span>{t('media.attach')}</span>}
          </Button>
        </DropdownMenuTrigger>
        {/* Choosing «Enlace» hands the focus to its field, and it does so at the moment the menu would give it back to the clip: that
            event is the one that decides, so no timer or render order can put the focus on the clip afterwards (J2-B-01, H-901). */}
        <DropdownMenuContent
          align="start"
          sideOffset={8}
          onCloseAutoFocus={(e) => {
            if (!choseLink.current) return
            choseLink.current = false
            e.preventDefault()
            document.getElementById('compose-link')?.focus()
          }}
        >
          <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
            <Paperclip size={15} aria-hidden /> {t('media.file')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              choseLink.current = true
              draft.setLinkOpen(true)
            }}
          >
            <Link2 size={15} aria-hidden /> {t('media.link')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          draft.addFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </>
  )
}

/** Camera and microphone. */
export function CaptureButtons({ draft, disabled, size = 'icon', labeled = false }: { draft: MediaDraft; disabled?: boolean; size?: 'icon' | 'icon-sm'; labeled?: boolean }) {
  const t = useT()
  const cameraInput = useRef<HTMLInputElement>(null)
  const iconSize = size === 'icon' ? 18 : 16
  return (
    <>
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          draft.addFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <Button variant="ghost" size={labeled ? 'sm' : size} aria-label={t('media.takePhoto')} title={t('media.takePhoto')} disabled={disabled || !!draft.recording} onClick={() => cameraInput.current?.click()} className={cn(labeled && 'px-3 max-md:gap-1 max-md:px-1.5')}>
        <Camera size={iconSize} aria-hidden />
        {labeled && <span>{t('media.takePhoto')}</span>}
      </Button>
      <Button
        variant="ghost"
        size={labeled ? 'sm' : size}
        aria-label={draft.recording ? t('media.stopRecording') : t('media.record')}
        title={draft.micAvailable ? (draft.recording ? t('media.stopRecording') : t('media.record')) : t('media.needsHttps')}
        disabled={disabled || !draft.micAvailable}
        onClick={() => void draft.toggleRecording()}
        className={cn(labeled && 'px-3 max-md:gap-1 max-md:px-1.5', draft.recording && 'text-danger')}
      >
        {draft.recording ? <Square size={iconSize - 2} fill="currentColor" aria-hidden /> : <Mic size={iconSize} aria-hidden />}
        {labeled && <span>{draft.recording ? t('media.stopRecording') : t('media.record')}</span>}
      </Button>
    </>
  )
}

/**
 * Field to paste an address; it lives as its own row under the bar, it does not float. It is born focused (J2-B-01): the focus
 * is taken in the commit that draws it, and the menu that opened it does not take it back (see `ClipMenu`), so the field is
 * never visible without the focus (H-901).
 */
export function LinkRow({ draft }: { draft: MediaDraft }) {
  const t = useT()
  const [value, setValue] = useState('')
  const close = () => {
    draft.setLinkOpen(false)
    setValue('')
    // The error belongs to the field: with the field gone it goes too, it is not left for the list of attachments to show.
    if (draft.problem === 'link') draft.setProblem(null)
  }
  const invalid = draft.problem === 'link'
  // A div and not a form: this row sits inside the form of a reply or of an edit, and a nested form submits the outer one (the page reloads and loses text and files).
  const submit = () => {
    if (!value.trim()) return close()
    if (draft.addLink(value)) close()
  }
  return (
    <div className="border-t border-line px-2 py-1.5">
      <div className="flex items-center gap-2">
        <label htmlFor="compose-link" className="shrink-0 text-xs font-semibold text-muted">
          {t('media.link')}
        </label>
        <Input
          id="compose-link"
          autoFocus
          type="url"
          inputMode="url"
          placeholder="https://"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'compose-link-error' : undefined}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            // Correcting the text takes the reproach away: the next check is the one that counts.
            if (invalid) draft.setProblem(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          className={cn('h-8 flex-1 pointer-coarse:h-11', invalid && 'border-danger')}
        />
        {/* Glass: the gel is for the action of the screen («Enviar»), and this is a step toward it (DISENO.md). */}
        <Button type="button" variant="secondary" className="h-8 pointer-coarse:h-11" onClick={submit}>
          {t('media.add')}
        </Button>
      </div>
      {/* The error sits under the field that caused it (a problem of the link is never shown elsewhere). */}
      {invalid && (
        <p id="compose-link-error" role="alert" className="mt-1 text-xs text-danger">
          {t(PROBLEM.link)}
        </p>
      )}
    </div>
  )
}

/** Length of an audio in seconds: the timer of the recording when it was recorded here, otherwise what the file says about itself (a stream without a length reports none, and then nothing is shown). */
function useAudioSeconds(local: LocalFile, isAudio: boolean): number | undefined {
  const [read, setRead] = useState<number>()
  useEffect(() => {
    if (!isAudio || local.seconds !== undefined) return
    const probe = new Audio()
    probe.preload = 'metadata'
    const onMeta = () => Number.isFinite(probe.duration) && setRead(Math.round(probe.duration))
    probe.addEventListener('loadedmetadata', onMeta)
    probe.src = local.url
    return () => {
      probe.removeEventListener('loadedmetadata', onMeta)
      probe.removeAttribute('src')
    }
  }, [isAudio, local.seconds, local.url])
  return local.seconds ?? read
}

/** A file added to the draft: its thumbnail, its name, its weight and, for an audio, its length. */
function LocalChip({ local: l, busy, onRemove }: { local: LocalFile; busy?: boolean; onRemove: () => void }) {
  const t = useT()
  const format = useFormat()
  const kind = kindFromMime(l.file.type, l.file.name)
  const seconds = useAudioSeconds(l, kind === 'audio')
  return (
    <li className="flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-md bg-surface py-0.5 pl-1 pr-0.5">
      <Thumb item={{ kind, src: l.url, name: l.file.name, size: l.file.size }} px={28} />
      <span className="min-w-0 max-w-[12rem] text-xs leading-tight text-muted [overflow-wrap:anywhere]">{l.file.name}</span>
      <span className="shrink-0 text-xs leading-tight tabular-nums text-muted">{[seconds === undefined ? '' : mmss(seconds), format.fileSize(l.file.size)].filter(Boolean).join(' · ')}</span>
      {!busy && (
        <button type="button" aria-label={t('media.remove', { name: l.file.name })} className="hit inline-flex shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-danger pointer-coarse:min-h-11 pointer-coarse:min-w-11" onClick={onRemove}>
          <X size={13} aria-hidden />
        </button>
      )}
    </li>
  )
}

/** Thumbnails and links already added, each with its name and weight in view, and the reason if something failed. */
export function MediaDraftList({ draft, busy }: { draft: MediaDraft; busy?: boolean }) {
  const t = useT()
  // A problem of the link is said in the link row, under its field; the list says the rest.
  const problem = draft.problem === 'link' ? null : draft.problem
  return (
    <>
      {draft.linkOpen && <LinkRow draft={draft} />}
      {(!draft.empty || problem) && (
    <div className="flex flex-col gap-1.5 border-t border-line px-2.5 py-2">
      {!draft.empty && (
        // One row of chips, all of one height class: attaching one more does not move what is below until the row is full (J1-B-01).
        <ul aria-label={t('media.attachments')} className="flex flex-wrap items-center gap-1.5">
          {draft.locals.map((l) => (
            <LocalChip key={l.key} local={l} busy={busy} onRemove={() => draft.removeLocal(l.key)} />
          ))}
          {draft.links.map((href) => (
            <li key={href} className="flex min-h-9 min-w-0 max-w-full items-center gap-1.5 rounded-md bg-surface py-0.5 pl-2 pr-0.5 text-xs">
              <Link2 size={14} aria-hidden className="shrink-0 text-muted" />
              <span className="min-w-0 max-w-[20rem] [overflow-wrap:anywhere]">{breakable(href)}</span>
              {!busy && (
                <button type="button" aria-label={t('media.remove', { name: href })} className="hit inline-flex shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-danger pointer-coarse:min-h-11 pointer-coarse:min-w-11" onClick={() => draft.removeLink(href)}>
                  <X size={13} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {t(PROBLEM[problem])}
        </p>
      )}
    </div>
      )}
    </>
  )
}

/** Timer of a recording in progress. */
export function RecordingStatus({ seconds }: { seconds: number }) {
  const t = useT()
  return (
    <div className="flex min-h-8 flex-1 items-center gap-2 px-2 text-sm" role="status" aria-label={t('media.recording')}>
      <span className="h-2.5 w-2.5 rounded-full bg-danger" aria-hidden />
      <span className="tabular-nums">{mmss(seconds)}</span>
    </div>
  )
}

/**
 * «Grabar audio» for a message or a reply that already exists (UD-071, UD-279): records with the microphone and hands the file over when it stops, so it joins
 * as any other attachment. While it records, the button says «Detener grabación» and the timer is beside it.
 */
export function RecordAudioButton({ onRecorded, disabled, onProblem }: { onRecorded: (file: File) => void; disabled?: boolean; onProblem?: (problem: MediaProblem) => void }) {
  const t = useT()
  const recorder = useRef<Recording | null>(null)
  const [seconds, setSeconds] = useState<number | null>(null)
  useEffect(() => {
    if (seconds === null) return
    const tick = setInterval(() => setSeconds((s) => (s === null ? s : s + 1)), 1000)
    return () => clearInterval(tick)
  }, [seconds === null])
  useEffect(() => () => recorder.current?.cancel(), [])
  const toggle = async () => {
    if (recorder.current) {
      const rec = recorder.current
      recorder.current = null
      setSeconds(null)
      try {
        onRecorded(await rec.stop())
      } catch {
        onProblem?.('record')
      }
      return
    }
    try {
      recorder.current = await startRecording()
      setSeconds(0)
    } catch {
      onProblem?.('microphone')
    }
  }
  const recording = seconds !== null
  const available = canRecord()
  const label = recording ? t('media.stopRecording') : t('media.record')
  return (
    <>
      {recording && <RecordingStatus seconds={seconds} />}
      <Button type="button" variant="ghost" size="sm" aria-label={label} title={available ? label : t('media.needsHttps')} disabled={disabled || !available} onClick={() => void toggle()} className={cn('px-3', recording && 'text-danger')}>
        {recording ? <Square size={14} fill="currentColor" aria-hidden /> : <Mic size={16} aria-hidden />}
        <span>{label}</span>
      </Button>
    </>
  )
}
