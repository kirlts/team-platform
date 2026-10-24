import type { HTMLAttributes, ReactNode } from 'react'
import { SettingHint } from '@/components/SettingHint'
import { cn } from '@/lib/utils'

/**
 * A box of Configuración: the title of the box at the left and its action at the right on one line, the content under them.
 * The hint is optional and only for a datum the name cannot carry; `hintId` is what the control names in `aria-describedby`.
 */
export function SettingsBox({
  title,
  hint,
  hintId,
  aside,
  className,
  children,
  ...rest
}: {
  title: ReactNode
  hint?: string
  hintId?: string
  aside?: ReactNode
  className?: string
  children?: ReactNode
} & Omit<HTMLAttributes<HTMLElement>, 'title'> & { [attr: `data-${string}`]: string | undefined }) {
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
