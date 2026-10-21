import { Camera, Link2, Mic, Paperclip, Square, X } from '@/components/icons'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useT, type MessageKey } from '@/i18n'
import { mmss } from '@/lib/format'
import { kindFromMime } from '@/lib/upload'
import type { MediaDraft, MediaProblem } from '@/lib/useMediaDraft'
import { cn } from '@/lib/utils'
import { Thumb } from './Thumb'

const PROBLEM: Record<MediaProblem, MessageKey> = { record: 'media.recordFailed', microphone: 'media.noMicrophone', link: 'media.invalidLink' }

/** Clip: file or link. */
export function ClipMenu({ draft, disabled, size = 'icon' }: { draft: MediaDraft; disabled?: boolean; size?: 'icon' | 'icon-sm' }) {
  const t = useT()
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={size} aria-label={t('media.attach')} title={t('media.attach')} disabled={disabled}>
            <Paperclip size={size === 'icon' ? 18 : 16} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
            <Paperclip size={15} aria-hidden /> {t('media.file')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => draft.setLinkOpen(true)}>
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
export function CaptureButtons({ draft, disabled, size = 'icon' }: { draft: MediaDraft; disabled?: boolean; size?: 'icon' | 'icon-sm' }) {
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
      <Button variant="ghost" size={size} aria-label={t('media.takePhoto')} title={t('media.takePhoto')} disabled={disabled || !!draft.recording} onClick={() => cameraInput.current?.click()}>
        <Camera size={iconSize} aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size={size}
        aria-label={draft.recording ? t('media.stopRecording') : t('media.record')}
        title={draft.micAvailable ? (draft.recording ? t('media.stopRecording') : t('media.record')) : t('media.needsHttps')}
        disabled={disabled || !draft.micAvailable}
        onClick={() => void draft.toggleRecording()}
        className={cn(draft.recording && 'text-danger')}
      >
        {draft.recording ? <Square size={iconSize - 2} fill="currentColor" aria-hidden /> : <Mic size={iconSize} aria-hidden />}
      </Button>
    </>
  )
}

/** Field to paste an address; it lives as its own row under the bar, it does not float. */
function LinkRow({ draft }: { draft: MediaDraft }) {
  const t = useT()
  const [value, setValue] = useState('')
  const close = () => {
    draft.setLinkOpen(false)
    setValue('')
  }
  return (
    <form
      className="border-t border-line px-2 py-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!value.trim()) return close()
        if (draft.addLink(value)) close()
      }}
    >
      <div className="flex items-center gap-2">
        <Input autoFocus type="url" inputMode="url" aria-label={t('media.link')} placeholder="https://" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && close()} className="h-7 flex-1" />
        <Button type="submit" size="sm">
          {t('media.add')}
        </Button>
      </div>
    </form>
  )
}

/** Thumbnails and links already added, each with its name and weight in view, and the reason if something failed. */
export function MediaDraftList({ draft, busy }: { draft: MediaDraft; busy?: boolean }) {
  const t = useT()
  return (
    <>
      {draft.linkOpen && <LinkRow draft={draft} />}
      {(!draft.empty || draft.problem) && (
    <div className="flex flex-col gap-1.5 border-t border-line px-2.5 py-2">
      {!draft.empty && (
        // One row of chips, all of one height class: attaching one more does not move what is below until the row is full (J1-B-01).
        <ul aria-label={t('media.attachments')} className="flex flex-wrap items-center gap-1.5">
          {draft.locals.map((l) => (
            <li key={l.key} className="flex min-h-9 min-w-0 max-w-full items-center gap-2 rounded-md border border-line-strong bg-surface py-0.5 pl-1 pr-0.5">
              <Thumb item={{ kind: kindFromMime(l.file.type), src: l.url, name: l.file.name, size: l.file.size }} px={28} />
              <span className="min-w-0 max-w-[12rem] text-xs leading-tight text-muted [overflow-wrap:anywhere]">{l.file.name}</span>
              {!busy && (
                <button type="button" aria-label={t('media.remove', { name: l.file.name })} className="hit inline-flex shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-danger" onClick={() => draft.removeLocal(l.key)}>
                  <X size={13} aria-hidden />
                </button>
              )}
            </li>
          ))}
          {draft.links.map((href) => (
            <li key={href} className="flex min-h-9 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-line-strong bg-surface py-0.5 pl-2 pr-0.5 text-xs">
              <Link2 size={14} aria-hidden className="shrink-0 text-muted" />
              <span className="min-w-0 max-w-[12rem] [overflow-wrap:anywhere]">{href}</span>
              {!busy && (
                <button type="button" aria-label={t('media.remove', { name: href })} className="hit inline-flex shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-danger" onClick={() => draft.removeLink(href)}>
                  <X size={13} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {draft.problem && (
        <p role="alert" className="text-xs text-danger">
          {t(PROBLEM[draft.problem])}
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
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
      <span className="tabular-nums">{mmss(seconds)}</span>
    </div>
  )
}
