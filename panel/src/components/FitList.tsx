import { ChevronLeft, ChevronRight } from '@/components/icons'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { fitCount, pageRange, total } from '@/lib/fit'
import { useDesktop } from '@/lib/useDesktop'
import { cn } from '@/lib/utils'

/** Rows drawn at once, only while measuring which of them fit. */
const MEASURE_ROWS = 60

/** Vertical space the borders and the padding of the frame take (they belong to no row, no header and no pager). */
function chrome(el: HTMLElement | null): number {
  if (!el) return 0
  const style = getComputedStyle(el)
  return ['borderTopWidth', 'borderBottomWidth', 'paddingTop', 'paddingBottom'].reduce((sum, key) => sum + (parseFloat(style[key as 'borderTopWidth']) || 0), 0)
}

/** Height of the pager strip: 32 px buttons, 8 px of padding above and below and a 1 px rule. Measured again once it is drawn. */
const PAGER_HEIGHT = 49

/**
 * A list that fits the frame it is in (UD-017). The frame takes the height its parent gives it; the
 * rows are drawn, measured, and only those that fit stay; the rest are on the next pages, with the
 * range and the two arrows at the foot. The page size is the measured height over the measured rows:
 * it changes when the window, the rows or the frame change, and it is never written down.
 *
 * On a phone the page is allowed to grow with its content, so every row is drawn and there are no pages, unless the caller
 * gives the list a frame of its own height and asks `pagedOnPhone`: then it pages inside that frame like on a desktop (J3-A-10).
 * `rows` must keep its identity between renders unless the list changed.
 */
export function FitList<T>({
  rows,
  rowKey,
  renderRow,
  empty,
  className,
  label,
  header,
  bare = false,
  rowsRole,
  reveal,
  pagedOnPhone = false,
  footer,
  onShown,
}: {
  rows: readonly T[]
  rowKey: (row: T) => string
  renderRow: (row: T) => ReactNode
  empty?: ReactNode
  className?: string
  /** Accessible name of the list. */
  label?: string
  /** Fixed row of titles above the rows; its height is subtracted from what fits. */
  header?: ReactNode
  /** No glass of its own: the list goes inside another panel. */
  bare?: boolean
  /** ARIA role of the group of rows (`listbox` when each row is an option). */
  rowsRole?: string
  /** Key of a row that has to be on the visible page when it changes (the selected one): the list pages to it (J2-B-10). */
  reveal?: string
  /** On a phone the list also pages, inside the height its parent gives it. */
  pagedOnPhone?: boolean
  /** Drawn right under the frame, inside the slot: the rows share the height with it, and it does not drift to the foot of the page when the list is short. */
  footer?: ReactNode
  /** Told the keys of the rows on the visible page once they are measured (the mark-all button marks those: UD-253). */
  onShown?: (keys: readonly string[]) => void
}) {
  const t = useT()
  // «desktop» below means «pages»: the window is wide, or the caller gave the list a frame of its own on a phone.
  const wide = useDesktop()
  const desktop = wide || pagedOnPhone
  /** The space the list may take: stable, whatever the list holds. The visible frame hugs its rows inside it. */
  const slot = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLDivElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  const [start, setStart] = useState(0)
  const [history, setHistory] = useState<number[]>([])
  /** Grows when the frame changes size, so a measure taken at another size stops being valid. */
  const [frameVersion, setFrameVersion] = useState(0)
  /** What was measured, and for which list, window, page and frame. A different list, window, page or frame makes it stale. */
  const [fit, setFit] = useState<{ rows: readonly T[]; desktop: boolean; start: number; version: number; n: number; sum: number; floor: number } | null>(null)
  const first = Math.min(start, Math.max(0, rows.length - 1))
  /** Rows on this page; `null` while it is being measured. */
  const count = fit && fit.rows === rows && fit.desktop === desktop && fit.start === first && fit.version === frameVersion ? fit.n : null

  /** The height of the slot the last measure was taken at: a slot that ends at another height than that one makes the measure stale, even when it passed through other heights in between. */
  const measuredBox = useRef<number | null>(null)
  /** The floor the slot was given after the last measure (see `fit.floor`): a slot held up by its floor is where the measure expects it, not a changed frame. */
  const measuredFloor = useRef(0)

  /**
   * Whether the slot, now `now` px high, is somewhere the last measure did not expect. Taller than the measure assumed: the room grew. Shorter: only a problem
   * when the rows are squeezed by it. A slot that hugs its rows (`flex-initial`) ends lower than the height it had while the sixty measuring rows were drawn,
   * and that is the measure being right, not a changed frame: judging it by the height alone drew the measuring rows again after every measure (H-3200).
   */
  const movedFrom = (now: number, expected: number) => now > expected + 0.5 || (now < expected - 0.5 && (body.current ? body.current.scrollHeight > body.current.clientHeight + 1 : true))

  useEffect(() => {
    const el = slot.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.clientHeight
    const observer = new ResizeObserver(() => {
      const now = el.clientHeight
      if (Math.abs(now - last) > 0.5 || (measuredBox.current !== null && movedFrom(now, Math.max(measuredBox.current, measuredFloor.current)))) {
        last = now
        setFrameVersion((v) => v + 1)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // The footer changes height when one of its sections opens: the room the rows have changes with it, and the measure taken before is stale.
  useEffect(() => {
    const el = foot.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.getBoundingClientRect().height
    const observer = new ResizeObserver(() => {
      const now = el.getBoundingClientRect().height
      if (Math.abs(now - last) > 0.5) {
        last = now
        setFrameVersion((v) => v + 1)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [footer !== undefined])

  // The header comes and goes (the strip of marked rows, UD-253) and can change height: either way the room of the rows changed.
  const hasHeader = header !== undefined && header !== null && header !== false
  const headerSeen = useRef(hasHeader)
  useEffect(() => {
    if (headerSeen.current !== hasHeader) {
      headerSeen.current = hasHeader
      setFrameVersion((v) => v + 1)
    }
    const el = head.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let last = el.getBoundingClientRect().height
    const observer = new ResizeObserver(() => {
      const now = el.getBoundingClientRect().height
      if (Math.abs(now - last) > 0.5) {
        last = now
        setFrameVersion((v) => v + 1)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasHeader])

  const pagerHeight = useRef(0)

  // The row to reveal is looked for once per change of `reveal`, as soon as the page size is known.
  const revealed = useRef<string | undefined>(undefined)
  useEffect(() => {
    // No row to reveal: the next one that asks (even the same one, again) is looked for.
    if (reveal === undefined) revealed.current = undefined
    if (!desktop || count === null || reveal === undefined || revealed.current === reveal) return
    const at = rows.findIndex((r) => rowKey(r) === reveal)
    if (at < 0) return
    revealed.current = reveal
    if (at < first || at >= first + count) setStart(at)
  })

  useLayoutEffect(() => {
    if (!desktop || count !== null) return
    const el = body.current
    const box = slot.current
    if (!el || !box) return
    const heights = [...el.children].map((c) => c.getBoundingClientRect().height)
    const remaining = rows.length - first
    const above = head.current?.getBoundingClientRect().height ?? 0
    const below = foot.current?.getBoundingClientRect().height ?? 0
    const room = box.clientHeight - below
    const stamp = { rows, desktop, start: first, version: frameVersion }
    measuredBox.current = box.clientHeight
    // A slot can dip while its neighbors settle (chips measuring themselves) and be back where it was before the frame ends: the observer reports
    // no change then, and the measure taken in the dip would stay. One look after the frame, at the height this measure used, is that event.
    const taken = box.clientHeight
    requestAnimationFrame(() => {
      if (slot.current && movedFrom(slot.current.clientHeight, Math.max(taken, measuredFloor.current))) setFrameVersion((v) => v + 1)
    })
    // Everything left fits without a pager when it is the first page.
    if (first === 0 && heights.length === remaining && total(heights) <= room - above + 0.5) {
      measuredFloor.current = 0
      setFit({ ...stamp, n: remaining, sum: total(heights), floor: 0 })
      return
    }
    const pager = pagerHeight.current || PAGER_HEIGHT
    const n = Math.min(remaining, fitCount(heights, room - above - pager))
    // A page always holds one row (`fitCount`), so the slot is never lower than that row, the header and the pager: in a window
    // lower than that the page scrolls, and the row is not drawn over the pager (H-96). In a taller window this changes nothing.
    const floor = Math.ceil((heights[0] ?? 0) + above + pager + below + chrome(frame.current))
    measuredFloor.current = floor
    setFit({ ...stamp, n, sum: total(heights.slice(0, n)), floor })
  })

  // A row that changes height after it was measured (its template arrives, a field is edited) makes the measure stale.
  useEffect(() => {
    const el = body.current
    if (!el || !fit || count === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const sum = total([...el.children].map((c) => c.getBoundingClientRect().height))
      if (Math.abs(sum - fit.sum) > 1) {
        // The row to reveal may have been pushed off the page by its own growth: it is looked for again after the new measure.
        revealed.current = undefined
        setFrameVersion((v) => v + 1)
      }
    })
    for (const child of el.children) observer.observe(child)
    return () => observer.disconnect()
  })

  const shown = desktop ? rows.slice(first, count === null ? first + MEASURE_ROWS : first + count) : rows
  const shownKeys = desktop && count === null ? null : shown.map(rowKey).join('\n')
  const told = useRef<string | null>(null)
  useEffect(() => {
    if (!onShown || shownKeys === null || told.current === shownKeys) return
    told.current = shownKeys
    onShown(shownKeys ? shownKeys.split('\n') : [])
  })
  const pages = desktop && count !== null && (first > 0 || first + count < rows.length)
  const range = pageRange(first, count ?? shown.length, rows.length)

  const go = (to: number, back: boolean) => {
    // Paging by hand is the person's choice: the row to reveal does not pull the list back.
    revealed.current = reveal
    setHistory((h) => (back ? h.slice(0, -1) : [...h, first]))
    setStart(to)
  }

  return (
    <div ref={slot} data-fit-measuring={desktop && rows.length > 0 && count === null ? '' : undefined} className={cn('flex min-h-0 flex-1 flex-col', className)} style={pages && fit ? { minHeight: fit.floor } : undefined}>
      <div ref={frame} aria-label={label} className={cn('flex max-h-full min-h-0 flex-col overflow-hidden', bare ? 'border-y border-line' : 'glass leaf')}>
      {hasHeader && (
        <div ref={head} className="shrink-0">
          {header}
        </div>
      )}
      {rows.length === 0 ? (
        (empty ?? null)
      ) : (
        <>
          <div ref={body} role={rowsRole} aria-label={rowsRole ? label : undefined} className="flex min-h-0 flex-1 flex-col">
            {shown.map((row) => (
              <Fragment key={rowKey(row)}>{renderRow(row)}</Fragment>
            ))}
          </div>
          {pages && (
            <div
              ref={(el) => {
                if (el) pagerHeight.current = el.getBoundingClientRect().height
              }}
              className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-2 text-sm text-muted"
            >
              <span aria-live="polite" className="tabular-nums">
                {t('pager.range', { from: range.from, to: range.to, total: range.total })}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t('pager.previous')}
                  disabled={history.length === 0}
                  onClick={() => go(history[history.length - 1] ?? 0, true)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-glass hover:border-accent disabled:opacity-40"
                >
                  <ChevronLeft size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={t('pager.next')}
                  disabled={first + (count ?? 0) >= rows.length}
                  onClick={() => go(first + (count ?? 0), false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-glass hover:border-accent disabled:opacity-40"
                >
                  <ChevronRight size={16} aria-hidden />
                </button>
              </span>
            </div>
          )}
        </>
      )}
      </div>
      {footer && (
        <div ref={foot} className="shrink-0">
          {footer}
        </div>
      )}
    </div>
  )
}
