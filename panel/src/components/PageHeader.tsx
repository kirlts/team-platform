import type { ReactNode } from 'react'

/** Screen title and, optionally, a datum or the controls of the screen on the right. */
export function PageHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
      <h1>{title}</h1>
      {aside}
    </header>
  )
}
