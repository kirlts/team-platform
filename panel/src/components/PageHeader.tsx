import type { ReactNode } from 'react'

/** Título de pantalla con la esfera de la marca a su izquierda y, opcional, un dato a la derecha. */
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
