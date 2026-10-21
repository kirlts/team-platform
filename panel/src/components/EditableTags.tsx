import { Plus, X } from '@/components/icons'
import { useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/** Lista de etiquetas editable en el lugar: cada una se quita con su ×; el «+» abre un campo y salir agrega. */
export function EditableTags({
  values,
  onSave,
  canEdit,
  label,
  placeholder = 'Sin dato',
}: {
  values: string[]
  onSave: (next: string[]) => void | Promise<unknown>
  canEdit: boolean
  label: string
  placeholder?: string
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const discard = useRef(false)

  const add = () => {
    const next = draft.trim()
    setDraft('')
    setAdding(false)
    if (discard.current) {
      discard.current = false
      return
    }
    if (next && !values.includes(next)) void onSave([...values, next])
  }

  return (
    <span className="flex flex-wrap items-center gap-1">
      {values.length === 0 && !canEdit && <span className="text-faint">{placeholder}</span>}
      {values.map((v) => (
        <Badge key={v} tone="accent" className="gap-1 pr-1">
          {v}
          {canEdit && (
            <button
              type="button"
              aria-label={`Quitar ${v}`}
              onClick={() => void onSave(values.filter((x) => x !== v))}
              className="rounded-sm p-0.5 hover:bg-accent/15"
            >
              <X size={11} aria-hidden />
            </button>
          )}
        </Badge>
      ))}
      {canEdit &&
        (adding ? (
          <input
            autoFocus
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLElement).blur()
              } else if (e.key === 'Escape') {
                discard.current = true
                ;(e.target as HTMLElement).blur()
              }
            }}
            className="h-5 w-28 rounded-sm border border-accent bg-raised px-1.5 text-xs"
          />
        ) : (
          <button
            type="button"
            aria-label={`Agregar a ${label.toLowerCase()}`}
            onClick={() => {
              discard.current = false
              setAdding(true)
            }}
            className={cn(
              'inline-flex h-5 items-center gap-0.5 rounded-sm border border-dashed border-line-strong px-1 text-xs text-muted hover:border-accent hover:text-accent',
              values.length === 0 && 'px-1.5',
            )}
          >
            <Plus size={11} aria-hidden />
            {values.length === 0 && <span>{placeholder}</span>}
          </button>
        ))}
    </span>
  )
}
