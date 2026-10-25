import { ChevronRight } from '@/components/icons'
import { useT } from '@/i18n'

/**
 * What a video frame shows and nobody says in voice or text (the analyzer's `observed`). It sits outside the body
 * of the message, folded by default, one observation per line; nothing is drawn when there is none.
 */
export function Observed({ items, bare = false }: { items?: string[] | null; /** Only the list: «Detalles» holds it (UD-307). */ bare?: boolean }) {
  const t = useT()
  if (!items?.length) return null
  if (bare)
    return (
      <ul data-testid="observed" className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-read">
        {items.map((o, i) => (
          <li key={i}>{o}</li>
        ))}
      </ul>
    )
  return (
    <details data-testid="observed" className="group shrink-0 text-sm">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-muted hover:text-fg [&::-webkit-details-marker]:hidden [@media(pointer:coarse)]:min-h-11">
        <ChevronRight size={16} aria-hidden className="transition-transform group-open:rotate-90" />
        {t('observed.title')}
        <span className="font-normal tabular-nums">{items.length}</span>
      </summary>
      <ul className="mt-2 flex flex-col gap-1 pl-4 text-read">
        {items.map((o, i) => (
          <li key={i}>{o}</li>
        ))}
      </ul>
    </details>
  )
}
