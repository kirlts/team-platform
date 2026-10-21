import type { ReactNode } from 'react'

/**
 * Screen title and, optionally, the count of what the screen lists beside it (J1-A-22: the one result indicator sits
 * with the title, not at the far edge) and the controls of the screen on the right.
 */
export function PageHeader({ title, count, aside }: { title: string; count?: string; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <div className="flex items-baseline gap-3">
        <h1>{title}</h1>
        {count && (
          <span aria-live="polite" className="text-sm tabular-nums text-muted">
            {count}
          </span>
        )}
      </div>
      {aside}
    </header>
  )
}
