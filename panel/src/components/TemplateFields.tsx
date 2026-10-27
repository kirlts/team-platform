import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { isStated, parseTemplateFields } from '@/lib/template'
import type { Template } from '@team-platform/client'
import { EditableText } from './EditableText'
import { Plus } from './icons'

/**
 * The fields of the message's template that have something to read, each one editable in place: the label above and the value under it.
 * A field with no data is not drawn (the analyzer leaves the ones its input does not answer empty or with «No indicado»): drawing it only
 * took the space of the text. Whoever can edit adds it from the row of names under the fields. A required field that is empty is drawn,
 * says so in its place and cannot be saved empty.
 */
export function TemplateFields({
  template,
  values,
  onSave,
  canEdit = true,
  closed = false,
  boxed = true,
}: {
  template: Template | undefined
  values: Record<string, string | null> | null | undefined
  /** Saves a field; receives the name and the new value. */
  onSave: (name: string, value: string) => void | Promise<unknown>
  canEdit?: boolean
  /** A closed message has nothing left to complete: an empty required field is not flagged (J2-A-17). */
  closed?: boolean
  /** A filled field carries its box at rest (J2-A-20). The proposal turns it off: its text and its fields are one block, with one way of showing that they can be edited (J3-B-16, J3-B-24). */
  boxed?: boolean
}) {
  const t = useT()
  const fields = useMemo(() => parseTemplateFields(template?.body_markdown ?? ''), [template?.body_markdown])
  /** The names the person asked to add: they are drawn, open, until they hold something or the edit ends empty. */
  const [adding, setAdding] = useState<string[]>([])
  const empty = (name: string) => !(values?.[name] ?? '').trim()
  // A required field that is empty is flagged only to whoever can fill it: for a reader it would be a name with «Obligatorio» and nothing to do.
  const pending = (f: { name: string; required: boolean }) => f.required && !closed && canEdit && empty(f.name)
  const shown = fields.filter((f) => isStated(values?.[f.name]) || pending(f) || adding.includes(f.name))
  const absent = canEdit && !closed ? fields.filter((f) => !shown.includes(f)) : []
  if (shown.length === 0 && absent.length === 0) return null
  return (
    <div className="flex flex-col gap-2">
      {shown.length > 0 && (
        <dl className={cn('grid gap-x-4 gap-y-2 text-sm', shown.length > 1 && '@md:grid-cols-2')}>
          {shown.map((f) => (
            <div key={f.name} className="flex min-w-0 flex-col gap-0.5">
              <dt className="rotulo flex items-baseline justify-between gap-2">
                {f.label}
                {/* What waits for a person is amber, and says it in words. */}
                {pending(f) && <span className="font-semibold normal-case tracking-normal text-answered-fg">{t('fields.required')}</span>}
              </dt>
              <dd>
                <EditableText
                  value={isStated(values?.[f.name]) ? (values?.[f.name] ?? '') : ''}
                  label={f.label}
                  multiline
                  prose
                  canEdit={canEdit}
                  startEditing={adding.includes(f.name)}
                  onEditingChange={(editing) => {
                    // The same list when there is nothing to remove: this runs on every render and a new array each time would never settle.
                    if (!editing) setAdding((a) => (a.includes(f.name) ? a.filter((n) => n !== f.name) : a))
                  }}
                  placeholder={closed ? t('fields.optional') : ''}
                  displayClassName={boxed ? 'border-line' : undefined}
                  emptyLabel={f.required && !closed ? t('fields.required') : t('fields.optional')}
                  validate={f.required && !closed ? (v) => (v ? null : t('fields.requiredError')) : undefined}
                  onSave={(v) => onSave(f.name, v)}
                />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {absent.length > 0 && (
        <div data-testid="add-fields" className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {absent.map((f) => (
            <button
              key={f.name}
              type="button"
              data-testid={`add-field-${f.name}`}
              aria-label={t('fields.add', { label: f.label })}
              onClick={() => setAdding((a) => [...a, f.name])}
              className="hit inline-flex items-center gap-1 rounded-md px-1.5 hover:bg-hover hover:text-fg"
            >
              <Plus size={12} aria-hidden /> {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
