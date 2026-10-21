import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useErrorText, useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * In-place editing (UD-017). The text itself is the control: a click opens it in the same place, with
 * the same typography, width and height, so nothing moves. A click outside or Enter
 * saves, Escape cancels; there is no «Editar» or «Guardar» button. An invalid value leaves the field open
 * with the reason below. In the multi-line variant, Shift+Enter opens a new line.
 *
 * The edit field is a `textarea` that grows with its text in both variants: so a long line
 * that takes two rows when reading takes them when editing too.
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
  render,
  onEditingChange,
}: {
  value: string
  onSave: (next: string) => void | Promise<unknown>
  validate?: (next: string) => string | null
  canEdit?: boolean
  multiline?: boolean
  placeholder?: string
  /** Accessible name of the field. */
  label: string
  /** Container classes (width, position). */
  className?: string
  /** Typography of the text: applied the same when reading and editing. */
  displayClassName?: string
  mono?: boolean
  /** Running text: justified the same when reading and editing (UD-022). */
  prose?: boolean
  /** How the value is shown when reading (for example, already-interpreted markdown); when editing the text is shown as is. */
  render?: (value: string) => ReactNode
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

  // Height equal to the text's: measured after each change of the draft.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // scrollHeight leaves out the border, which the box includes.
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`
  }, [draft, editing])

  useEffect(() => {
    if (editing) {
      const el = ref.current
      el?.focus()
      const len = el?.value.length ?? 0
      el?.setSelectionRange(len, len)
    }
  }, [editing])

  const type = cn('whitespace-pre-wrap break-words', mono && value && 'font-mono text-[13px]', prose && 'prose-block', displayClassName)
  // Same box when reading and editing: the negative margin offsets the padding and the border.
  const box = '-mx-1.5 -my-px block w-[calc(100%+12px)] max-w-none rounded-md border border-transparent px-1.5 py-px text-left'

  if (!canEdit) {
    return <span className={cn(render && value ? 'block' : type, !value && 'text-faint', className)}>{value ? (render ? render(value) : value) : shown}</span>
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
            'cursor-text hover:border-line-strong hover:bg-raised focus-visible:border-accent',
            type,
            !value && 'text-faint',
          )}
        >
          {value ? (render ? render(value) : value) : shown}
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
          } else if (e.key === 'Enter' && (!multiline || !e.shiftKey)) {
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
