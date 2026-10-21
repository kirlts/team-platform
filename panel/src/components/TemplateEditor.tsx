import { Plus, X } from '@/components/icons'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input, Textarea } from '@/components/ui/input'
import { useErrorText, useT } from '@/i18n'
import { Markdown } from '@/lib/markdown'
import { buildTemplate, fieldKey, parseTemplateFields, templateInstructions, type TemplateField } from '@/lib/template'
import { EditableText } from './EditableText'

/** Longest label the server accepts for a field (src/analyze/templates.js, FIELD_LABEL_MAX). */
const LABEL_MAX = 120

const checkbox = 'size-4 shrink-0 accent-[var(--color-accent)]'

/**
 * What a person edits of a template: its fields (label and whether it is required) and the instructions to the
 * model. The file with its frontmatter (J1-A-32) is built from these parts and never shown. Each change goes out
 * as a whole file through `onSave`, so the caller can make it an operation that Deshacer takes back.
 */
export function TemplateContentEditor({ name, description, markdown, onSave }: { name: string; description: string; markdown: string; onSave: (next: string) => void | Promise<unknown> }) {
  const t = useT()
  const fields = useMemo(() => parseTemplateFields(markdown), [markdown])
  const instructions = useMemo(() => templateInstructions(markdown), [markdown])
  const save = (next: { fields?: TemplateField[]; instructions?: string }) => onSave(buildTemplate({ name, description, fields: next.fields ?? fields, instructions: next.instructions ?? instructions }))
  const label = (v: string) => (!v ? t('common.required') : v.length > LABEL_MAX ? t('form.maxLength', { n: LABEL_MAX }) : null)

  return (
    <div className="flex flex-col gap-5">
      <section aria-label={t('templates.fields')} className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2>{t('templates.fields')}</h2>
          <Button
            size="sm"
            onClick={() => {
              const text = t('templates.newField')
              void save({ fields: [...fields, { name: fieldKey(text, fields.map((f) => f.name)), label: text, required: false }] })
            }}
          >
            <Plus size={14} aria-hidden /> {t('templates.addField')}
          </Button>
        </div>
        {fields.length === 0 ? (
          <p className="text-sm text-muted">{t('templates.noFields')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {fields.map((f, i) => (
              <li key={f.name} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <EditableText value={f.label} label={t('templates.fieldLabel')} validate={label} onSave={(v) => save({ fields: fields.map((x, j) => (j === i ? { ...x, label: v } : x)) })} displayClassName="font-medium" />
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                  <input type="checkbox" className={checkbox} checked={f.required} onChange={(e) => void save({ fields: fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} />
                  {t('templates.required')}
                </label>
                <Button size="icon-sm" variant="ghost" aria-label={t('templates.removeField', { label: f.label })} title={t('templates.removeField', { label: f.label })} onClick={() => void save({ fields: fields.filter((_, j) => j !== i) })}>
                  <X size={14} aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={t('templates.instructions')} className="flex flex-col gap-2">
        <h2>{t('templates.instructions')}</h2>
        <div className="rounded-md border border-line px-3 py-2">
          <EditableText value={instructions} label={t('templates.instructions')} multiline prose validate={(v) => (v ? null : t('common.required'))} render={(v) => <Markdown source={v} />} onSave={(v) => save({ instructions: v })} />
        </div>
      </section>
    </div>
  )
}

/** Window of a template's content: the form above, over its own scrolling lane. */
export function TemplateContentDialog({ open, onOpenChange, title, ...editor }: { open: boolean; onOpenChange: (open: boolean) => void; title: string } & Parameters<typeof TemplateContentEditor>[0]) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className="max-w-2xl">
        {/* The instructions can be as long as a method section: the window scrolls inside, a declared lane. */}
        <div data-lane="template-content" className="scroll-thin min-h-0 overflow-y-auto p-5">
          <TemplateContentEditor {...editor} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** New template: name, description, fields and instructions as a form; the file is built on creating. */
export function NewTemplateDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (v: { name: string; description: string; body_markdown: string }) => Promise<unknown> }) {
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('areas.newTemplate')} className="max-w-2xl">
        {open && <NewTemplateForm onCreate={onCreate} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function NewTemplateForm({ onCreate, onClose }: { onCreate: (v: { name: string; description: string; body_markdown: string }) => Promise<unknown>; onClose: () => void }) {
  const t = useT()
  const errorText = useErrorText()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<TemplateField[]>([])
  const [instructions, setInstructions] = useState(t('templates.newInstructions'))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async () => {
    const found: Record<string, string> = {}
    if (!name.trim()) found.name = t('common.required')
    else if (name.trim().length > 64) found.name = t('form.maxLength', { n: 64 })
    if (!description.trim()) found.description = t('common.required')
    else if (description.trim().length > 1024) found.description = t('form.maxLength', { n: 1024 })
    if (!instructions.trim()) found.instructions = t('common.required')
    if (fields.some((f) => !f.label.trim())) found.fields = t('common.required')
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setPending(true)
    setFormError(null)
    try {
      const clean = fields.map((f) => ({ ...f, label: f.label.trim() }))
      await onCreate({ name: name.trim(), description: description.trim(), body_markdown: buildTemplate({ name: name.trim(), description: description.trim(), fields: clean, instructions }) })
      onClose()
    } catch (err) {
      setFormError(errorText(err))
    } finally {
      setPending(false)
    }
  }

  const error = (key: string) =>
    errors[key] && (
      <span role="alert" className="text-xs font-normal text-danger">
        {errors[key]}
      </span>
    )

  return (
    <form
      className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('areas.fieldName')}
        <Input autoFocus value={name} aria-invalid={errors.name ? true : undefined} onChange={(e) => setName(e.target.value)} />
        {error('name')}
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('areas.fieldDescription')}
        <Textarea rows={2} value={description} aria-invalid={errors.description ? true : undefined} onChange={(e) => setDescription(e.target.value)} />
        {error('description')}
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 flex w-full items-center justify-between gap-2 text-sm font-medium">
          {t('templates.fields')}
          <Button size="sm" onClick={() => setFields((f) => [...f, { name: fieldKey(t('templates.newField'), f.map((x) => x.name)), label: '', required: false }])}>
            <Plus size={14} aria-hidden /> {t('templates.addField')}
          </Button>
        </legend>
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-3">
            <Input
              aria-label={t('templates.fieldLabel')}
              placeholder={t('templates.fieldLabel')}
              value={f.label}
              onChange={(e) => {
                const label = e.target.value
                setFields((all) => all.map((x, j) => (j === i ? { ...x, label, name: fieldKey(label || t('templates.newField'), all.filter((_, k) => k !== i).map((y) => y.name)) } : x)))
              }}
            />
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" className={checkbox} checked={f.required} onChange={(e) => setFields((all) => all.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
              {t('templates.required')}
            </label>
            <Button size="icon-sm" variant="ghost" aria-label={t('templates.removeField', { label: f.label || t('templates.newField') })} onClick={() => setFields((all) => all.filter((_, j) => j !== i))}>
              <X size={14} aria-hidden />
            </Button>
          </div>
        ))}
        {error('fields')}
      </fieldset>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('templates.instructions')}
        <Textarea rows={6} value={instructions} aria-invalid={errors.instructions ? true : undefined} onChange={(e) => setInstructions(e.target.value)} />
        {error('instructions')}
      </label>
      {formError && (
        <p role="alert" className="text-xs text-danger">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {t('common.create')}
        </Button>
      </div>
    </form>
  )
}
