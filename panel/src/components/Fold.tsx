import { ChevronRight } from '@/components/icons'
import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A section folded by default (progressive disclosure): one row with its name, an optional note and the arrow; the
 * content is drawn only while it is open.
 */
export function Fold({ title, note, defaultOpen = false, children, className, anchor }: { anchor?: string; title: string; note?: ReactNode; defaultOpen?: boolean; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section id={anchor} className={cn('glass leaf flex min-h-0 shrink-0 flex-col scroll-mt-4', className)}>
      <h2 className="m-0">
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className="flex min-h-10 w-full items-center gap-2 px-4 text-left hover:bg-hover">
          <ChevronRight size={15} aria-hidden className={cn('shrink-0 text-muted transition-transform', open && 'rotate-90 text-accent')} />
          <span>{title}</span>
          {note && <span className="text-sm font-normal normal-case tracking-normal text-muted tabular-nums">{note}</span>}
        </button>
      </h2>
      {open && (
        <div id={id} className="flex min-h-0 flex-col border-t border-line px-4 py-3">
          {children}
        </div>
      )}
    </section>
  )
}
