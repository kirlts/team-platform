import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, FileText, Link2, Plus } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useOptionalEventsStore } from '@team-platform/client/react'
import { useFormat, useT } from '@/i18n'
import { client } from '@/lib/client'
import { linkDomain, stepIndex, type GalleryItem } from '@/lib/gallery'
import { MEDIA_KEY } from '@/lib/media'
import { cn } from '@/lib/utils'
import { AudioPlayer } from './AudioPlayer'
import { DownloadLink } from './DownloadLink'
import { MediaIcon } from './MediaIcon'
import { Thumb } from './Thumb'

/** Size of the viewer: `inline` shares the page with other things (UD-017), `compact` shares a window with the analysis, `dialog` has the window to itself. */
type Variant = 'inline' | 'compact' | 'dialog'

/** The viewer has no height of its own: it takes what the medium needs, and a photo is capped so it does not push the page. */
const MEDIA_MAX: Record<Variant, string> = {
  inline: 'max-h-[clamp(7rem,24dvh,13rem)]',
  compact: 'max-h-[clamp(6rem,18dvh,10rem)]',
  dialog: 'max-h-[min(58dvh,36rem)]',
}

/** Whether the person asked the system for less motion: a jump then happens at once. */
const calm = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Keys that belong to the control being used (a slider, a video, a text): the gallery does not take them. */
const OWN_KEYS = 'input, textarea, select, video, audio, [contenteditable="true"]'

/**
 * The one place where attachments are looked at (mockup «Previsualización de: imagen o galería, video o carrusel, audio(s), docx o PDF»):
 * a large viewer with the medium that is selected and, under it, a strip of thumbnails with the current one marked.
 * - One medium: only the viewer. Several: arrows, «2 de 5», the strip, Home and End, the arrow keys, and swiping on a phone
 *   (the viewer is a row of slides with scroll snap, so the swipe is the browser's own and has no distance of ours).
 * - Photo: fits the frame; «Ampliar» shows it at its own size, and Escape returns it to the frame. Video: its controls and its first frame.
 *   Audio: the player and, if the server has one, the transcript. Document and link: its name, its kind and the way to open it.
 * - Only the slides next to the current one draw their content, so a send with forty photos loads three. A file that fails says so and can be retried.
 * - `index` makes it controlled; without it the gallery keeps its own and `onIndexChange` reports it.
 */
export function MediaGallery({
  items,
  variant = 'inline',
  index: controlled,
  defaultIndex = 0,
  onIndexChange,
  label,
  renderAction,
  onAdd,
  adding = false,
  className,
}: {
  items: readonly GalleryItem[]
  variant?: Variant
  index?: number
  defaultIndex?: number
  onIndexChange?: (index: number) => void
  /** Accessible name of the region; «Galería de medios» without it. */
  label?: string
  /** An action over the current medium, drawn in the info row (the proposal's «Quitar»). */
  renderAction?: (item: GalleryItem, index: number) => ReactNode
  /** Adds a square at the end of the strip, as large as the thumbnails, that asks for files (the message's «+»). */
  onAdd?: () => void
  adding?: boolean
  className?: string
}) {
  const t = useT()
  const format = useFormat()
  const total = items.length
  const [own, setOwn] = useState(defaultIndex)
  const current = Math.min(Math.max(controlled ?? own, 0), Math.max(total - 1, 0))
  const [zoomed, setZoomed] = useState(false)
  const track = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLUListElement>(null)
  /** Index the program is moving to: while it is set, the slides that pass by on the way do not count as the current one. */
  const heading = useRef<number | null>(null)
  const regionId = useId()

  const select = useCallback(
    (next: number, { smooth = false } = {}) => {
      if (next < 0 || next >= total) return
      setZoomed(false)
      const el = track.current
      if (el && el.clientWidth > 0) {
        heading.current = next
        el.scrollTo({ left: next * el.clientWidth, behavior: smooth && !calm() ? 'smooth' : 'auto' })
      }
      setOwn(next)
      onIndexChange?.(next)
    },
    [total, onIndexChange],
  )

  // The track follows the current index when it comes from outside (controlled) or when the width changes.
  useEffect(() => {
    const el = track.current
    if (!el || el.clientWidth === 0) return
    if (Math.abs(el.scrollLeft - current * el.clientWidth) > 1) el.scrollTo({ left: current * el.clientWidth, behavior: 'auto' })
  }, [current])

  // A swipe moves the track: the slide that is more than half in view is the current one.
  useEffect(() => {
    const el = track.current
    if (!el || total < 2 || typeof IntersectionObserver === 'undefined') return
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio < 0.6) continue
          const at = Number((entry.target as HTMLElement).dataset.index)
          if (heading.current !== null) {
            if (at === heading.current) heading.current = null
            continue
          }
          setOwn((prev) => {
            if (prev === at) return prev
            onIndexChange?.(at)
            return at
          })
        }
      },
      { root: el, threshold: 0.6 },
    )
    el.querySelectorAll('[data-index]').forEach((slide) => seen.observe(slide))
    return () => seen.disconnect()
  }, [total, onIndexChange])

  // A touch or a wheel on the track takes the movement back from the program.
  useEffect(() => {
    const el = track.current
    if (!el) return
    const free = () => {
      heading.current = null
    }
    el.addEventListener('pointerdown', free)
    el.addEventListener('wheel', free, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', free)
      el.removeEventListener('wheel', free)
    }
  }, [])

  // The strip brings the current thumbnail to its middle without moving anything else on the page.
  useEffect(() => {
    const list = strip.current
    const thumb = list?.children[current] as HTMLElement | undefined
    if (!list || !thumb || typeof list.scrollTo !== 'function') return
    // Only when the thumbnail is not whole in view, and then to the middle: a strip that fits (or already shows it) stays where it is.
    const box = list.getBoundingClientRect()
    const at = thumb.getBoundingClientRect()
    if (at.left >= box.left && at.right <= box.right) return
    list.scrollTo({ left: list.scrollLeft + (at.left - box.left) - (box.width - at.width) / 2, behavior: calm() ? 'auto' : 'smooth' })
  }, [current])

  // Escape leaves the enlarged photo, wherever the focus is; the window that may hold the gallery has been told not to close for it.
  useEffect(() => {
    if (!zoomed) return
    const leave = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setZoomed(false)
    document.addEventListener('keydown', leave)
    return () => document.removeEventListener('keydown', leave)
  }, [zoomed])

  if (total === 0) return null
  const item = items[current]
  const name = item.name ?? t(MEDIA_KEY[item.kind])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (total < 2 || (e.target as HTMLElement).closest(OWN_KEYS) || e.altKey || e.ctrlKey || e.metaKey) return
    const next = e.key === 'ArrowRight' ? stepIndex(current, 1, total) : e.key === 'ArrowLeft' ? stepIndex(current, -1, total) : e.key === 'Home' ? 0 : e.key === 'End' ? total - 1 : null
    if (next === null) return
    e.preventDefault()
    select(next, { smooth: Math.abs(next - current) === 1 })
    // The focus follows the selection when it was on a thumbnail, so the next key acts from there.
    if ((e.target as HTMLElement).closest('[data-gallery-thumb]')) requestAnimationFrame(() => (strip.current?.children[next]?.querySelector('button') as HTMLElement | null)?.focus())
  }

  return (
    <section
      aria-roledescription={t('gallery.roleCarousel')}
      aria-label={label ?? t('gallery.region')}
      data-gallery
      data-gallery-zoomed={zoomed || undefined}
      onKeyDown={onKeyDown}
      className={cn('@container flex min-w-0 flex-col gap-2', className)}
    >
      <div className="relative">
        <div
          ref={track}
          id={regionId}
          tabIndex={0}
          aria-label={name}
          data-gallery-viewer
          className={cn(
            'frame scroll-thin flex w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            zoomed && 'overflow-x-hidden',
          )}
        >
          {items.map((it, i) => (
            <div
              key={it.id}
              role="group"
              aria-roledescription={t('gallery.roleSlide')}
              aria-label={t('gallery.count', { n: i + 1, total })}
              aria-hidden={i === current ? undefined : true}
              data-index={i}
              className="flex w-full shrink-0 snap-center snap-always items-center justify-center"
            >
              {/* An audio is drawn in every slide: its player costs a row and a request for its header, and a recording that is not next to the current one would
                  otherwise have no element at all until it was reached. */}
              {(Math.abs(i - current) <= 1 || it.kind === 'audio') && <Slide item={it} active={i === current} near={Math.abs(i - current) <= 1} zoomed={zoomed && i === current} onZoom={setZoomed} cap={MEDIA_MAX[variant]} />}
            </div>
          ))}
        </div>
        {total > 1 && (
          <>
            <Arrow dir={-1} disabled={current === 0} onClick={() => select(current - 1, { smooth: true })} />
            <Arrow dir={1} disabled={current === total - 1} onClick={() => select(current + 1, { smooth: true })} />
          </>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-between gap-x-3 text-xs">
        {/* One line always: the name is the part that gives way, with an ellipsis. It and the counter are announced when the medium changes. */}
        <p aria-live="polite" data-gallery-caption className="flex min-w-0 flex-1 items-baseline gap-1 whitespace-nowrap text-muted">
          <span className="shrink-0 font-semibold text-fg">{t(MEDIA_KEY[item.kind])}</span>
          {item.name && item.kind !== 'link' && <span className="min-w-0 truncate" title={item.name}>{`· ${item.name}`}</span>} {/* justified: the footer of the viewer is one line (V5) and the whole name is its title */}
          {item.size ? <span className="shrink-0">{`· ${format.fileSize(item.size)}`}</span> : null}
          {total > 1 && <span className="ml-1 shrink-0 font-semibold tabular-nums text-fg" data-gallery-count>{t('gallery.count', { n: current + 1, total })}</span>}
        </p>
        <span className="flex shrink-0 items-center gap-1">
          {renderAction?.(item, current)}
          <DownloadLink href={item.download} name={item.name} />
        </span>
      </div>

      {(total > 1 || onAdd) && (
        <ul ref={strip} aria-label={t('gallery.thumbs')} data-gallery-strip className="scroll-thin flex gap-2 overflow-x-auto pb-1.5">
          {total > 1 && items.map((it, i) => {
            const on = i === current
            return (
              <li key={it.id} className="shrink-0" data-gallery-thumb>
                <button
                  type="button"
                  tabIndex={on ? 0 : -1}
                  aria-current={on ? 'true' : undefined}
                  aria-label={t('gallery.item', { n: i + 1, total, name: it.name ?? t(MEDIA_KEY[it.kind]) })}
                  onClick={() => select(i, { smooth: Math.abs(i - current) === 1 })}
                  // The selected one carries a thicker frame and a bar under it, so it does not depend on color alone.
                  className={cn('relative block rounded-md p-0.5', on ? 'bg-accent-soft shadow-[inset_0_0_0_2px_var(--color-accent)]' : 'hover:bg-hover')}
                >
                  <Thumb item={{ kind: it.kind, src: it.src, name: it.name, size: it.size }} px={48} />
                  {on && <span aria-hidden className="absolute inset-x-1.5 -bottom-1 h-[3px] rounded-full bg-accent" />}
                </button>
              </li>
            )
          })}
          {onAdd && (
            <li className="shrink-0">
              <AddTile onAdd={onAdd} busy={adding} />
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

/** The «+» square: the size of a thumbnail button (its 48 px plus the padding; the strip stretches it to the thumbnails' height), with the name «Agregar adjuntos» for whoever cannot see it. */
export function AddTile({ onAdd, busy = false }: { onAdd: () => void; busy?: boolean }) {
  const t = useT()
  return (
    <button
      type="button"
      data-gallery-add
      aria-label={t('published.addFiles')}
      title={t('published.addFiles')}
      disabled={busy}
      onClick={onAdd}
      className="hit flex h-[52px] w-[52px] items-center justify-center rounded-md border border-dashed border-line-strong text-muted hover:bg-hover hover:text-accent disabled:opacity-50"
    >
      <Plus size={18} aria-hidden />
    </button>
  )
}

function Arrow({ dir, disabled, onClick }: { dir: 1 | -1; disabled: boolean; onClick: () => void }) {
  const t = useT()
  const Icon = dir === -1 ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={dir === -1 ? t('gallery.prev') : t('gallery.next')}
      title={dir === -1 ? t('gallery.prev') : t('gallery.next')}
      className={cn(
        'hit absolute top-1/2 z-10 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-line-strong bg-surface text-fg shadow-sm hover:bg-hover disabled:pointer-events-none disabled:opacity-30 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11',
        dir === -1 ? 'left-2' : 'right-2',
      )}
    >
      <Icon size={20} aria-hidden />
    </button>
  )
}

/** The content of one slide, by kind of medium. */
function Slide({ item, active, near, zoomed, onZoom, cap }: { item: GalleryItem; active: boolean; near: boolean; zoomed: boolean; onZoom: (z: boolean) => void; cap: string }) {
  const t = useT()
  const name = item.name ?? t(MEDIA_KEY[item.kind])
  // A failed file is retried by drawing it again with a new key.
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'waiting' | 'failed'>(item.src ? 'loading' : 'ready')
  const failed = state === 'failed'
  // A file that does not load yet is, most often, one the server has not published for this person (404 until the message exists or is restored): it
  // is not an error, it is a wait. The stream says when something was published or changed, and the file is asked again by itself, once per event.
  // A second failure after an event is the failure for real, and only that one draws the error and its button.
  const events = useOptionalEventsStore()
  const refused = useRef(false)
  const wait = () => {
    // Without a stream above (a piece drawn on its own) there is nothing to wait for: the failure is drawn at once, with its button.
    if (!refused.current && events) {
      refused.current = true
      setState('waiting')
    } else setState('failed')
  }
  useEffect(() => {
    if (state !== 'waiting' || !events) return
    const again = () => {
      setState('loading')
      setAttempt((n) => n + 1)
    }
    // A stream that was not open yet when the file failed (the page just loaded) reports itself when it opens.
    let open = events.getSnapshot().connected
    const connect = events.subscribe(() => {
      const now = events.getSnapshot().connected
      if (now && !open) {
        refused.current = false // opening the stream is not news about the file: the wait goes on until something is published
        again()
      }
      open = now
    })
    const stops = [events.onNewMessage(again), events.onDone(again), events.onChanged(again), connect]
    return () => stops.forEach((stop) => stop())
  }, [state, events])

  if (failed) {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 px-4 text-center text-sm">
        <FileText size={24} aria-hidden className="text-muted" />
        <p className="font-semibold">{t('gallery.failed')}</p>
        <p className="text-xs text-muted [overflow-wrap:anywhere]">{name}</p>
        <Button
          size="sm"
          onClick={() => {
            setState('loading')
            setAttempt((n) => n + 1)
          }}
        >
          {t('gallery.retry')}
        </Button>
      </div>
    )
  }

  if (state === 'waiting') {
    return (
      <div role="status" data-gallery-waiting className="flex flex-col items-center gap-2 px-4 text-center text-sm text-muted">
        <MediaIcon kind={item.kind} size={24} className="text-muted" />
        <p>{t('gallery.loading')}</p>
        <p className="text-xs [overflow-wrap:anywhere]">{name}</p>
      </div>
    )
  }

  const loading = state === 'loading' && (
    <span role="status" data-gallery-loading className="absolute inset-0 flex items-center justify-center bg-accent-soft/40 text-xs text-muted">
      {t('gallery.loading')}
    </span>
  )

  if (item.kind === 'image' && item.src) {
    return (
      <div className={cn('relative w-full', state !== 'ready' && 'min-h-24', cap, zoomed ? 'overflow-auto' : 'flex items-center justify-center')} data-lane={zoomed ? 'photo' : undefined}>
        {loading}
        <img
          key={attempt}
          src={item.src}
          alt={name}
          // Only the current slide and its neighbors are drawn: a lazy image inside a horizontal scroller waits for the swipe to reveal it and stays at 0 px until then.
          loading="eager"
          decoding="async"
          draggable={false}
          onLoad={() => {
            refused.current = false
            setState('ready')
          }}
          onError={wait}
          onClick={() => onZoom(!zoomed)}
          title={zoomed ? t('gallery.fit') : t('media.zoom', { name })}
          className={cn(zoomed ? 'max-w-none cursor-zoom-out' : cn('max-w-full cursor-zoom-in object-contain', cap))}
        />
        {state === 'ready' && active && (
          <button
            type="button"
            onClick={() => onZoom(!zoomed)}
            aria-pressed={zoomed}
            // Over a photo the button has its own solid background: a translucent one takes the color of the image under it (J4-A-detail-03).
            className="btn pop absolute bottom-2 right-2 h-8 px-3 text-xs text-fg"
          >
            {zoomed ? t('gallery.fit') : t('gallery.zoom')}
          </button>
        )}
      </div>
    )
  }

  if (item.kind === 'video' && item.src) {
    return (
      <div className="relative flex w-full items-center justify-center bg-black/80">
        {loading}
        {/* The first frame is the cover: the fragment asks for 0.1 s, so the browser draws it before any play. */}
        <video
          key={attempt}
          src={`${item.src}#t=0.1`}
          controls={active}
          preload={active ? 'metadata' : 'none'}
          playsInline
          aria-label={name}
          onLoadedData={() => setState('ready')}
          onError={wait}
          className={cn('max-w-full', cap)}
        />
      </div>
    )
  }

  if (item.kind === 'audio' && item.src) {
    // The side margins clear the arrows (40 px at 8 px from the edge): over the player they intercept the touch on «Reproducir».
    return (
      <div className="flex w-full min-w-0 flex-col gap-2 px-14 py-4">
        <AudioPlayer key={attempt} src={item.src} name={name} preload={near ? 'metadata' : 'none'} onError={wait} onReady={() => setState('ready')} />
        {active && item.transcriptSrc && <Transcript src={item.transcriptSrc} />}
      </div>
    )
  }

  if (item.kind === 'link') {
    return (
      <div className="flex min-w-0 flex-col items-center gap-2 px-4 py-3 text-center">
        <Link2 size={24} aria-hidden className="text-accent-deep" />
        <p className="text-sm font-semibold">{linkDomain(item.name)}</p>
        <p className="max-w-full text-xs text-muted [overflow-wrap:anywhere]">{item.name}</p>
        {item.name && /^https?:\/\//i.test(item.name) && (
          <Button asChild size="sm">
            <a href={item.name} target="_blank" rel="noreferrer noopener">
              {t('gallery.openLink')}
            </a>
          </Button>
        )}
      </div>
    )
  }

  // Document: a PDF shows its first page in a frame (the server lets its own site frame it); any other document is named.
  const isPdf = !!item.src && /\.pdf$/i.test(item.name ?? '')
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 px-4 py-3 text-center">
      {isPdf && <iframe src={item.src} title={name} loading="eager" className={cn('w-full rounded-md border border-line bg-surface', 'h-[60dvh]')} />}
      {!isPdf && <FileText size={24} aria-hidden className="text-accent-deep" />}
      <p className="text-sm font-semibold [overflow-wrap:anywhere]">{name}</p>
      {item.src && (
        <Button asChild size="sm">
          <a href={item.src} target="_blank" rel="noreferrer" aria-label={t('media.open', { name })}>
            {t('gallery.openDocument')}
          </a>
        </Button>
      )}
    </div>
  )
}

/** The text the server extracted from an audio: loaded when its slide is the current one, and drawn only if there is one. */
function Transcript({ src }: { src: string }) {
  const t = useT()
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    client.raw(src, { signal: abort.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { text?: string } | null) => setText(data?.text?.trim() ? data.text : null))
      .catch(() => setText(null))
    return () => abort.abort()
  }, [src])
  if (!text) return null
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <h3 className="text-xs font-semibold text-muted">{t('gallery.transcript')}</h3>
      {/* A transcript has no maximum length: its own lane, declared. */}
      <p data-lane="transcript" data-gallery-transcript className="scroll-thin min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm">
        {text}
      </p>
    </div>
  )
}

/** The gallery in a window over the page, opened from a thumbnail: it starts on the medium that was touched. */
export function MediaGalleryDialog({
  items,
  open,
  onOpenChange,
  index = 0,
  title,
}: {
  items: readonly GalleryItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
  index?: number
  title?: string
}) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={title ?? t('media.attachments')}
        className="max-w-[min(64rem,calc(100vw-2rem))]"
        // Escape first leaves the enlarged photo; the window closes with the next one.
        onEscapeKeyDown={(e) => {
          if (document.querySelector('[data-gallery-zoomed]')) e.preventDefault()
        }}
      >
        {open && <MediaGallery items={items} variant="dialog" defaultIndex={index} className="p-3" />}
      </DialogContent>
    </Dialog>
  )
}
