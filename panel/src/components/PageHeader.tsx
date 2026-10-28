import type { ReactNode } from 'react'

/**
 * Screen title and, optionally, the count of what the screen lists beside it (J1-A-22: the one result indicator sits
 * with the title, not at the far edge) and the controls of the screen on the right.
 */
export function PageHeader({ title, count, aside, reserve = false }: { title: string; count?: string; aside?: ReactNode; /** The management views: the header keeps the height of the main button and centers the title on it, so the title falls at the same y whatever the action beside it (or none). */ reserve?: boolean }) {
  return (
    <header className={reserve ? 'flex min-h-12 flex-wrap items-center justify-between gap-x-6 gap-y-1' : 'flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1'}>
      <div className={reserve ? 'flex flex-wrap items-center gap-x-3' : 'flex flex-wrap items-baseline gap-x-3'}>
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
