import { useId, useState, type HTMLAttributes, type ReactNode } from 'react'
import { ChevronRight } from '@/components/icons'
import { SettingHint } from '@/components/SettingHint'
import { cn } from '@/lib/utils'

/**
 * A box of Configuración: the title of the box at the left and its action at the right on one line, the content under them.
 * The hint is optional and only for a datum the name cannot carry; `hintId` is what the control names in `aria-describedby`.
 * `fold` is for what is not needed every time (providers, data, queue, audit): the box is one row with its name and the arrow, and
 * its content is drawn, and read from the server, only while it is open («Cada vista cabe en una pantalla», progressive disclosure).
 */
export function SettingsBox({
  title,
  hint,
  hintId,
  aside,
  fold = false,
  className,
  children,
  ...rest
}: {
  title: ReactNode
  hint?: string
  hintId?: string
  aside?: ReactNode
  fold?: boolean
  className?: string
  children?: ReactNode
} & Omit<HTMLAttributes<HTMLElement>, 'title'> & { [attr: `data-${string}`]: string | undefined }) {
  const [open, setOpen] = useState(!fold)
  const body = useId()
  if (fold) {
    return (
      <section {...rest} className={cn('glass leaf flex min-w-0 flex-col', className)}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pr-5">
          <h2 className="m-0 min-w-0 flex-1 basis-40">
            <button type="button" aria-expanded={open} aria-controls={body} onClick={() => setOpen((v) => !v)} className={cn('flex min-h-12 w-full items-center gap-2 px-5 text-left hover:bg-hover pointer-coarse:min-h-12', open ? 'rounded-tl-[inherit]' : 'rounded-l-[inherit]')}>
              <ChevronRight size={16} aria-hidden className={cn('shrink-0 text-muted transition-transform', open && 'rotate-90 text-accent')} />
              <span>{title}</span>
            </button>
          </h2>
          {open && aside}
        </div>
        {open && (
          <div id={body} className="flex min-w-0 flex-col gap-4 px-5 pb-5">
            {hint && hintId && <SettingHint id={hintId}>{hint}</SettingHint>}
            {children}
          </div>
        )}
      </section>
    )
  }
  return (
    <section {...rest} className={cn('glass leaf flex min-w-0 flex-col gap-4 p-5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2>{title}</h2>
          {hint && hintId && <SettingHint id={hintId}>{hint}</SettingHint>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}
