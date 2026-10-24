import { Plus, Trash2 } from '@/components/icons'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input, Textarea } from '@/components/ui/input'
import { useErrorText, useT } from '@/i18n'
import { Markdown } from '@/lib/markdown'
import { buildTemplate, fieldKey, OUTPUT_FIXED, OUTPUT_TYPES, parseTemplateFields, parseTemplateOutput, templateInstructions, type OutputType, type TemplateField, type TemplateOutputField } from '@/lib/template'
import { EditableText } from './EditableText'
import { NativeSelect } from './NativeSelect'
import { SaveDot, type SaveTone } from './SaveDot'

/** Longest label the server accepts for a field (src/analyze/templates.js, FIELD_LABEL_MAX). */
const LABEL_MAX = 120

/**
 * What a person edits of a template: its fields (label and whether it is required) and the instructions to the
 * model. The file with its frontmatter (J1-A-32) is built from these parts and never shown. Each change goes out
 * as a whole file through `onSave`, so the caller can make it an operation that Deshacer takes back.
 */
export function TemplateContentEditor({ name, description, markdown, onSave }: { name: string; description: string; markdown: string; onSave: (next: string) => void | Promise<unknown> }) {
  const t = useT()
  const errorText = useErrorText()
  const fields = useMemo(() => parseTemplateFields(markdown), [markdown])
  const output = useMemo(() => parseTemplateOutput(markdown), [markdown])
  const instructions = useMemo(() => templateInstructions(markdown), [markdown])
  // A file the server refuses (422) says why here, under the parts, and the parts stay as they were saved.
  const [refused, setRefused] = useState<string | null>(null)
  const save = async (next: { fields?: TemplateField[]; output?: TemplateOutputField[]; instructions?: string }) => {
    try {
      await onSave(buildTemplate({ name, description, fields: next.fields ?? fields, output: next.output ?? output, instructions: next.instructions ?? instructions }))
      setRefused(null)
    } catch (err) {
      // The catalog line, and after it the server's own reason (which part of the frontmatter does not compile).
      const line = errorText(err)
      const reason = err instanceof Error ? err.message : ''
      setRefused(reason && reason !== line ? `${line}: ${reason}` : line)
    }
  }
  const label = (v: string) => (!v ? t('common.required') : v.length > LABEL_MAX ? t('form.maxLength', { n: LABEL_MAX }) : null)

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t('templates.fields')} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2>{t('templates.fields')}</h2>
          <Button
            size="sm"
            onClick={() => {
              const text = t('templates.newField')
              void save({ fields: [...fields, { name: fieldKey(text, fields.map((f) => f.name)), label: text, required: false }] })
            }}
          >
            <Plus size={16} aria-hidden /> {t('templates.addField')}
          </Button>
        </div>
        {fields.length === 0 ? (
          <p className="text-sm text-muted">{t('templates.noFields')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-lg bg-surface">
            {fields.map((f, i) => (
              <li key={f.name} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
                <div className="min-w-0 flex-1 basis-40">
                  <EditableText value={f.label} label={t('templates.fieldLabel')} validate={label} onSave={(v) => save({ fields: fields.map((x, j) => (j === i ? { ...x, label: v } : x)) })} displayClassName="font-medium" />
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm text-muted">
                  <Checkbox checked={f.required} onCheckedChange={(on) => void save({ fields: fields.map((x, j) => (j === i ? { ...x, required: on === true } : x)) })} />
                  {t('templates.required')}
                </label>
                <Button size="sm" variant="ghost" className="text-muted hover:text-danger" aria-label={t('templates.removeField', { label: f.label })} title={t('templates.removeField', { label: f.label })} data-repeat-ok="per-field" onClick={() => void save({ fields: fields.filter((_, j) => j !== i) })}>
                  <Trash2 size={16} aria-hidden /> {t('templates.removeShort')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <OutputEditor output={output} onChange={(next) => save({ output: next })} />

      {refused && (
        <p role="alert" data-template-refused className="text-sm text-danger">
          {refused}
        </p>
      )}

      <section aria-label={t('templates.instructions')} className="flex flex-col gap-3">
        <h2>{t('templates.instructions')}</h2>
        <div className="rounded-lg bg-surface px-4 py-3">
          <EditableText value={instructions} label={t('templates.instructions')} multiline prose validate={(v) => (v ? null : t('common.required'))} render={(v) => <Markdown source={v} />} onSave={(v) => save({ instructions: v })} />
        </div>
      </section>
    </div>
  )
}

/**
 * «Salida» (MASTER-SPEC §7.9): what the harness delivers when it works a message of this template. The same rows as
 * «Campos», with the type of each entry; «Resumen» and «Resultado» close the list and are not edited (UD-255).
 */
export function OutputEditor({ output, onChange }: { output: TemplateOutputField[] | null; onChange: (next: TemplateOutputField[]) => void | Promise<unknown> }) {
  const t = useT()
  const entries = output ?? []
  const label = (v: string) => (!v ? t('common.required') : v.length > LABEL_MAX ? t('form.maxLength', { n: LABEL_MAX }) : null)
  const set = (i: number, patch: Partial<TemplateOutputField>) => void onChange(entries.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  return (
    <section aria-label={t('templates.output')} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2>{t('templates.output')}</h2>
        <Button
          size="sm"
          onClick={() => {
            const text = t('templates.newOutput')
            void onChange([...entries, { name: fieldKey(text, [...entries.map((f) => f.name), ...OUTPUT_FIXED]), label: text, type: 'text', required: false }])
          }}
        >
          <Plus size={14} aria-hidden /> {t('templates.addOutput')}
        </Button>
      </div>
      {output === null ? (
        <p className="text-sm text-muted">{t('templates.noOutput')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg bg-surface">
          {entries.map((f, i) => (
            <li key={f.name} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
              <div className="min-w-0 flex-1 basis-40">
                <EditableText value={f.label} label={t('templates.outputLabel')} validate={label} onSave={(v) => set(i, { label: v })} displayClassName="font-medium" />
                {f.enum && <span className="block break-words text-xs text-muted">{f.enum.join(' · ')}</span>}
              </div>
              <div className="w-28 shrink-0">
                <NativeSelect
                  aria-label={t('templates.outputTypeOf', { label: f.label })}
                  value={f.type}
                  onChange={(e) => {
                    const type = e.target.value as OutputType
                    set(i, type === 'text' ? { type } : { type, enum: undefined })
                  }}
                >
                  {OUTPUT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`templates.outputType.${type}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-sm text-muted">
                <Checkbox checked={f.required} onCheckedChange={(on) => set(i, { required: on === true })} />
                {t('templates.required')}
              </label>
              <Button size="sm" variant="ghost" className="text-muted hover:text-danger" aria-label={t('templates.removeOutput', { label: f.label })} title={t('templates.removeOutput', { label: f.label })} data-repeat-ok="per-field" onClick={() => void onChange(entries.filter((_, j) => j !== i))}>
                <Trash2 size={16} aria-hidden /> {t('templates.removeShort')}
              </Button>
            </li>
          ))}
          {(['outcome', 'summary'] as const).map((fixed) => (
            <li key={fixed} data-output-fixed={fixed} className="flex min-h-12 items-center gap-4 px-4 py-2 text-muted">
              <span className="min-w-0 flex-1 font-medium">{t(`templates.output.${fixed}`)}</span>
              <span className="text-sm">{t('templates.fixed')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Window of a template's content: the form above, over its own scrolling lane. Each change is saved as it is made (UD-017), so the
 * foot says where the saving stands with its dot and its word, and has the one button that leaves (J2-A-24).
 */
export function TemplateContentDialog({ open, onOpenChange, title, onSave, ...editor }: { open: boolean; onOpenChange: (open: boolean) => void; title: string } & Parameters<typeof TemplateContentEditor>[0]) {
  const t = useT()
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  useEffect(() => {
    if (!open) setState('idle')
  }, [open])
  const tone: SaveTone = state === 'saving' ? 'saving' : state === 'saved' ? 'saved' : state === 'error' ? 'error' : 'idle'
  const word = state === 'saving' ? t('templates.saving') : state === 'saved' ? t('templates.saved') : state === 'error' ? t('templates.saveFailed') : t('templates.unchanged')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} className="max-w-2xl">
        {/* The instructions can be as long as a method section: the window scrolls inside, a declared lane. */}
        <div data-lane="template-content" className="scroll-thin min-h-0 overflow-y-auto p-5">
          <TemplateContentEditor
            {...editor}
            onSave={async (next) => {
              setState('saving')
              try {
                await onSave(next)
                setState('saved')
              } catch (err) {
                setState('error')
                throw err
              }
            }}
          />
        </div>
        <div className="flex shrink-0 items-center justify-between gap-4 border-t border-line px-5 py-4">
          {/* The state of what is edited, always said: «Sin cambios» until something is saved, then «Guardado». Each change is saved as it is made (J3-A-35). */}
          <SaveDot tone={tone}>{word}</SaveDot>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            {t('templates.done')}
          </Button>
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
  const [output, setOutput] = useState<TemplateOutputField[] | null>(null)
  const [instructions, setInstructions] = useState('')
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
      await onCreate({ name: name.trim(), description: description.trim(), body_markdown: buildTemplate({ name: name.trim(), description: description.trim(), fields: clean, output, instructions }) })
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
      className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <label className="flex flex-col gap-2">
        <span className="rotulo">{t('areas.fieldName')}</span>
        <Input autoFocus value={name} aria-invalid={errors.name ? true : undefined} onChange={(e) => setName(e.target.value)} />
        {error('name')}
      </label>
      <label className="flex flex-col gap-2">
        <span className="rotulo">{t('areas.fieldDescription')}</span>
        <Textarea rows={2} value={description} aria-invalid={errors.description ? true : undefined} onChange={(e) => setDescription(e.target.value)} />
        {error('description')}
      </label>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 flex w-full items-center justify-between gap-3">
          <h2>{t('templates.fields')}</h2>
          <Button size="sm" onClick={() => setFields((f) => [...f, { name: fieldKey(t('templates.newField'), f.map((x) => x.name)), label: '', required: false }])}>
            <Plus size={16} aria-hidden /> {t('templates.addField')}
          </Button>
        </legend>
        {fields.length === 0 && <p className="text-sm text-muted">{t('templates.noFields')}</p>}
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-4">
            <Input
              aria-label={t('templates.fieldLabel')}
              placeholder={t('templates.fieldLabel')}
              value={f.label}
              onChange={(e) => {
                const label = e.target.value
                setFields((all) => all.map((x, j) => (j === i ? { ...x, label, name: fieldKey(label || t('templates.newField'), all.filter((_, k) => k !== i).map((y) => y.name)) } : x)))
              }}
            />
            <label className="flex shrink-0 items-center gap-2 text-sm text-muted">
              <Checkbox checked={f.required} onCheckedChange={(on) => setFields((all) => all.map((x, j) => (j === i ? { ...x, required: on === true } : x)))} />
              {t('templates.required')}
            </label>
            <Button size="sm" variant="ghost" className="text-muted hover:text-danger" aria-label={t('templates.removeField', { label: f.label || t('templates.newField') })} data-repeat-ok="per-field" onClick={() => setFields((all) => all.filter((_, j) => j !== i))}>
              <Trash2 size={16} aria-hidden /> {t('templates.removeShort')}
            </Button>
          </div>
        ))}
        {error('fields')}
      </fieldset>
      <OutputEditor output={output} onChange={(next) => setOutput(next)} />
      <section aria-label={t('templates.instructions')} className="flex flex-col gap-3">
        <h2>{t('templates.instructions')}</h2>
        {/* The same box and the same rendering as when a template is edited (J2-A-25). */}
        <div className="rounded-lg bg-surface px-4 py-3">
          <EditableText value={instructions} label={t('templates.instructions')} multiline prose validate={(v) => (v ? null : t('common.required'))} render={(v) => <Markdown source={v} />} onSave={(v) => setInstructions(v)} />
        </div>
        {error('instructions')}
      </section>
      {formError && (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-3 pt-1">
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {t('areas.addTemplate')}
        </Button>
      </div>
    </form>
  )
}
