import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Chips on one row. All of them are drawn once to see how many share the first row; the rest fold behind «+N», which
 * opens them in place. The count is measured, and measured again when the row changes width.
 */
export function AreaChips({ chips }: { chips: ReactNode[] }) {
  const t = useT()
  const box = useRef<HTMLUListElement>(null)
  const [fitting, setFitting] = useState<number | null>(null)
  const [open, setOpen] = useState(false)

  // A different list, a different width, a chip that changes size (the font arrives) or a chip that wraps makes the measure stale: draw them all again and measure.
  const width = useRef(0)
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const stale = () => {
      const items = [...el.children] as HTMLElement[]
      const wrapped = items.length > 1 && items.some((li) => li.offsetTop > items[0].offsetTop + 1)
      if (Math.abs(el.clientWidth - width.current) > 0.5 || wrapped) {
        width.current = el.clientWidth
        setFitting(null)
      }
    }
    const observer = new ResizeObserver(stale)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => observer.disconnect()
  })
  useEffect(() => setFitting(null), [chips.length])

  useLayoutEffect(() => {
    const el = box.current
    if (!el || fitting !== null) return
    const items = [...el.children] as HTMLElement[]
    const top = items[0]?.offsetTop ?? 0
    setFitting(Math.max(1, items.filter((li) => li.offsetTop <= top + 1).length))
  }, [fitting, chips])

  const hidden = fitting === null || open ? 0 : chips.length - fitting
  const shown = fitting === null || open ? chips : chips.slice(0, fitting)
  return (
    <div className="flex min-w-0 items-start gap-1.5">
      <ul data-lane="area-pending" ref={box} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {shown.map((chip, i) => (
          <li key={i}>{chip}</li>
        ))}
      </ul>
      {/* The button takes its room while the chips are measured (hidden, so it is not seen or reached), otherwise it would shrink the row after the count and push a chip to a second one. */}
      {(fitting === null || hidden > 0 || (open && fitting < chips.length)) && (
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t('home.fewerAreas') : t('home.moreAreasAria', { n: hidden })}
          onClick={() => setOpen((v) => !v)}
          className={cn('inline-flex min-h-6 shrink-0 items-center rounded-full border border-line-strong px-2 text-xs font-semibold hover:bg-glass-edge', fitting === null && 'invisible')}
        >
          {open ? t('home.fewerAreas') : t('home.moreAreas', { n: Math.max(hidden, 1) })}
        </button>
      )}
    </div>
  )
}
