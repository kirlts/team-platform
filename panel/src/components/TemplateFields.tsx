import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useT } from '@/i18n'
import { parseTemplateFields } from '@/lib/template'
import type { Template } from '@/lib/types'
import { EditableText } from './EditableText'

/**
 * The fields of the message's template, each one editable in place: the label above and the value
 * under it. A required field that is empty says so in its place and cannot be saved empty.
 */
export function TemplateFields({
  template,
  values,
  onSave,
  canEdit = true,
  closed = false,
}: {
  template: Template | undefined
  values: Record<string, string | null> | null | undefined
  /** Saves a field; receives the name and the new value. */
  onSave: (name: string, value: string) => void | Promise<unknown>
  canEdit?: boolean
  /** A closed message has nothing left to complete: an empty required field is not flagged (J2-A-17). */
  closed?: boolean
}) {
  const t = useT()
  const fields = useMemo(() => parseTemplateFields(template?.body_markdown ?? ''), [template?.body_markdown])
  if (fields.length === 0) return null
  return (
    <dl className={cn('grid gap-x-4 gap-y-2 pr-1.5 text-sm', fields.length > 1 && '@md:grid-cols-2')}>
      {fields.map((f) => (
        <div key={f.name} className="flex min-w-0 flex-col gap-0.5">
          <dt className="flex items-baseline justify-between gap-2 text-xs font-semibold text-muted">
            {f.label}
            {f.required && !closed && !(values?.[f.name] ?? '').trim() && <span className="font-normal text-danger">{t('fields.required')}</span>}
          </dt>
          <dd>
            <EditableText
              value={values?.[f.name] ?? ''}
              label={f.label}
              multiline
              prose
              canEdit={canEdit}
              placeholder={closed ? t('fields.optional') : t('fields.fill')}
                            emptyLabel={f.required && !closed ? t('fields.required') : t('fields.optional')}
              validate={f.required && !closed ? (v) => (v ? null : t('fields.requiredError')) : undefined}
              onSave={(v) => onSave(f.name, v)}
            />
          </dd>
        </div>
      ))}
    </dl>
  )
}
