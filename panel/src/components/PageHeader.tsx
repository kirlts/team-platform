import type { ReactNode } from 'react'

/** Screen title with the brand sphere on its left and, optionally, a datum on the right. */
export function PageHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
      <div className="flex items-center gap-3">
        <span aria-hidden className="orb h-3.5 w-3.5 shrink-0 rounded-full" />
        <h1>{title}</h1>
      </div>
      {aside}
    </header>
  )
}
