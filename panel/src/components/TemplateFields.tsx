import { useMemo } from 'react'
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
}: {
  template: Template | undefined
  values: Record<string, string | null> | null | undefined
  /** Guarda un campo; recibe el nombre y el valor nuevo. */
  onSave: (name: string, value: string) => void | Promise<unknown>
  canEdit?: boolean
}) {
  const t = useT()
  const fields = useMemo(() => parseTemplateFields(template?.body_markdown ?? ''), [template?.body_markdown])
  if (fields.length === 0) return null
  return (
    <dl className="grid gap-x-4 gap-y-2 text-[13px] sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.name} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs font-semibold text-muted">{f.label}</dt>
          <dd>
            <EditableText
              value={values?.[f.name] ?? ''}
              label={f.label}
              multiline
              prose
              canEdit={canEdit}
              placeholder={f.required ? t('fields.required') : t('fields.optional')}
              validate={f.required ? (v) => (v ? null : t('fields.requiredError')) : undefined}
              onSave={(v) => onSave(f.name, v)}
            />
          </dd>
        </div>
      ))}
    </dl>
  )
}
