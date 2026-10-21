import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useErrorText, useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Edición en el lugar (UD-017). El texto mismo es el control: un clic lo abre en el mismo sitio, con
 * la misma tipografía, el mismo ancho y el mismo alto, así que nada se mueve. Un clic afuera o Enter
 * guardan, Escape cancela; no hay botón «Editar» ni «Guardar». Un valor inválido deja el campo abierto
 * con el motivo debajo. En la variante de varias líneas, Enter abre una línea nueva y Ctrl+Enter guarda.
 *
 * El campo de edición es un `textarea` que crece con su texto en las dos variantes: así una línea
 * larga que en lectura ocupa dos renglones los ocupa también al editarla.
 */
export function EditableText({
  value,
  onSave,
  validate,
  canEdit = true,
  multiline = false,
  placeholder,
  label,
  className,
  displayClassName,
  mono = false,
  prose = false,
  onEditingChange,
}: {
  value: string
  onSave: (next: string) => void | Promise<unknown>
  validate?: (next: string) => string | null
  canEdit?: boolean
  multiline?: boolean
  placeholder?: string
  /** Nombre accesible del campo. */
  label: string
  /** Clases del contenedor (ancho, posición). */
  className?: string
  /** Tipografía del texto: se aplica igual en lectura y en edición. */
  displayClassName?: string
  mono?: boolean
  /** Texto corrido: se justifica igual en lectura y en edición (UD-022). */
  prose?: boolean
  onEditingChange?: (editing: boolean) => void
}) {
  const t = useT()
  const errorText = useErrorText()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const discard = useRef(false)
  const saving = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const shown = placeholder ?? t('editable.empty')

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => onEditingChange?.(editing), [editing, onEditingChange])

  // Alto igual al del texto: se mide tras cada cambio del borrador.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft, editing])

  useEffect(() => {
    if (editing) {
      const el = ref.current
      el?.focus()
      const len = el?.value.length ?? 0
      el?.setSelectionRange(len, len)
    }
  }, [editing])

  const type = cn('whitespace-pre-wrap break-words', mono && 'font-mono text-[13px]', prose && 'prose-block', displayClassName)
  // Misma caja en lectura y en edición: el margen negativo compensa el relleno y el borde.
  const box = '-mx-1.5 -my-px block w-[calc(100%+12px)] max-w-none rounded-md border border-transparent px-1.5 py-px text-left'

  if (!canEdit) {
    return <span className={cn(type, !value && 'text-faint', className)}>{value || shown}</span>
  }

  const open = () => {
    discard.current = false
    setError(null)
    setDraft(value)
    setEditing(true)
  }

  const commit = async () => {
    if (saving.current) return
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
    saving.current = true
    try {
      await onSave(next)
      setEditing(false)
      setError(null)
    } catch (err) {
      setError(errorText(err))
      ref.current?.focus()
    } finally {
      saving.current = false
    }
  }

  if (!editing) {
    return (
      <span className={cn('block min-w-0', className)}>
        <span
          role="button"
          tabIndex={0}
          aria-label={`${label}: ${value || shown}`}
          onClick={open}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              open()
            }
          }}
          className={cn(
            box,
            'cursor-text hover:border-line-strong hover:bg-raised focus-visible:border-accent [@media(hover:none)]:border-line',
            type,
            !value && 'text-faint',
          )}
        >
          {value || shown}
        </span>
      </span>
    )
  }

  return (
    <span className={cn('block min-w-0', className)}>
      <textarea
        ref={ref}
        rows={1}
        value={draft}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        onChange={(e) => {
          const next = multiline ? e.target.value : e.target.value.replace(/\n/g, ' ')
          setDraft(next)
          setError(validate?.(next.trim()) ?? null)
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            discard.current = true
            ;(e.target as HTMLElement).blur()
          } else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            ;(e.target as HTMLElement).blur()
          }
        }}
        className={cn(box, 'well resize-none overflow-hidden text-inherit outline-none focus-visible:outline-none', error ? '!border-danger' : '!border-accent', type)}
      />
      {error && (
        <span role="alert" className="mt-1 block text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  )
}
