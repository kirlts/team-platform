import { Pencil } from '@/components/icons'
import { useEffect, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Edición en el lugar. El valor es el control: se abre con un clic, doble clic, Enter o espacio;
 * salir guarda; Escape descarta; un valor inválido deja el campo abierto con el motivo debajo.
 * El lápiz aparece al pasar por encima o con el foco, y queda fijo donde no hay puntero.
 */
export function EditableText({
  value,
  onSave,
  validate,
  canEdit = true,
  multiline = false,
  placeholder = 'Sin dato',
  label,
  className,
  displayClassName,
  rows,
  mono = false,
  suggestions,
}: {
  value: string
  onSave: (next: string) => void | Promise<unknown>
  validate?: (next: string) => string | null
  canEdit?: boolean
  multiline?: boolean
  placeholder?: string
  /** Nombre accesible del campo. */
  label: string
  className?: string
  displayClassName?: string
  rows?: number
  mono?: boolean
  suggestions?: string[]
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const discard = useRef(false)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (editing) {
      ref.current?.focus()
      const len = ref.current?.value.length ?? 0
      ref.current?.setSelectionRange(len, len)
    }
  }, [editing])

  if (!canEdit) {
    return (
      <span className={cn('whitespace-pre-wrap break-words', !value && 'text-faint', displayClassName, className)}>
        {value || placeholder}
      </span>
    )
  }

  const open = () => {
    discard.current = false
    setError(null)
    setDraft(value)
    setEditing(true)
  }

  const commit = async () => {
    if (discard.current) {
      discard.current = false
      setEditing(false)
      setError(null)
      return
    }
    const next = draft.trim()
    if (next === value.trim()) {
      setEditing(false)
      setError(null)
      return
    }
    const problem = validate?.(next) ?? null
    if (problem) {
      setError(problem)
      ref.current?.focus()
      return
    }
    try {
      await onSave(next)
      setEditing(false)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar')
      ref.current?.focus()
    }
  }

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        aria-label={`${label}: ${value || placeholder}. Editar`}
        onClick={open}
        onDoubleClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
        className={cn(
          'group/edit -mx-1.5 inline-flex max-w-full cursor-text items-start gap-1.5 rounded-md border border-transparent px-1.5 py-0.5',
          'hover:border-line-strong hover:bg-raised focus-visible:border-accent',
          className,
        )}
      >
        <span className={cn('min-w-0 whitespace-pre-wrap break-words', !value && 'text-faint', mono && 'font-mono text-[13px]', displayClassName)}>
          {value || placeholder}
        </span>
        <Pencil
          size={12}
          aria-hidden
          className="mt-1 shrink-0 text-faint opacity-0 group-hover/edit:opacity-100 group-focus-visible/edit:opacity-100 [@media(hover:none)]:opacity-100"
        />
      </span>
    )
  }

  const shared = {
    ref,
    value: draft,
    'aria-label': label,
    'aria-invalid': error ? true : undefined,
    onChange: (e: { target: { value: string } }) => {
      const next = e.target.value
      setDraft(next)
      setError(validate?.(next.trim()) ?? null)
    },
    onBlur: () => void commit(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        discard.current = true
        ;(e.target as HTMLElement).blur()
      } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        ;(e.target as HTMLElement).blur()
      }
    },
    className: cn(
      'w-full rounded-md border bg-raised px-1.5 py-0.5 text-sm text-fg focus-visible:outline-1',
      error ? 'border-danger outline-danger' : 'border-accent',
      mono && 'font-mono text-[13px]',
      className,
    ),
  }

  return (
    <span className="block w-full min-w-0">
      {multiline ? (
        <textarea {...shared} rows={rows ?? 3} className={cn(shared.className, 'resize-y')} />
      ) : (
        <input {...shared} type="text" list={suggestions ? listId : undefined} />
      )}
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      {error ? (
        <span role="alert" className="mt-0.5 block text-xs text-danger">
          {error}
        </span>
      ) : multiline ? (
        <span className="mt-0.5 block text-xs text-faint">Al salir se guarda · Escape descarta</span>
      ) : null}
    </span>
  )
}
