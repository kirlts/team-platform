import { ChevronRight } from '@/components/icons'
import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A section folded by default (progressive disclosure): one row with its name, an optional note (the count of what is inside) and the
 * arrow; the content is drawn only while it is open. A fold holds no other fold: one level is hidden, never two.
 */
export function Fold({ title, note, action, defaultOpen = false, children, className, anchor }: { anchor?: string; title: string; note?: ReactNode; /** What acts on the content, on the right of the same line as the name. */ action?: ReactNode; defaultOpen?: boolean; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section id={anchor} className={cn('glass leaf flex min-h-0 shrink-0 flex-col scroll-mt-4', className)}>
      <div className={cn('flex items-center gap-3 rounded-[inherit]', action && 'flex-wrap py-2 pr-3')}>
        <h2 className={cn('m-0 min-w-0 flex-1', action && 'basis-40')}>
          <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className={cn('flex min-h-10 w-full items-center gap-2 px-5 text-left hover:bg-hover pointer-coarse:min-h-11', action ? (open ? 'rounded-tl-[inherit]' : 'rounded-l-[inherit]') : open ? 'rounded-t-[inherit]' : 'rounded-[inherit]')}>
            <ChevronRight size={16} aria-hidden className={cn('shrink-0 text-muted transition-transform', open && 'rotate-90 text-accent')} />
            <span>{title}</span>
            {note !== undefined && note !== null && note !== false && <span className="text-sm font-normal normal-case tracking-normal text-muted tabular-nums">{note}</span>}
          </button>
        </h2>
        {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {open && (
        <div id={id} className="flex min-h-0 flex-col px-5 pb-4">
          {children}
        </div>
      )}
    </section>
  )
}
