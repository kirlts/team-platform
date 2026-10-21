import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input, Textarea } from '@/components/ui/input'
import { useErrorText, useT } from '@/i18n'

export interface FieldSpec {
  name: string
  label: string
  multiline?: boolean
  required?: boolean
  maxLength?: number
  initial?: string
  rows?: number
  mono?: boolean
  type?: 'text' | 'email' | 'password'
  autoComplete?: string
}

/** Formulario corto en una ventana: crea un área o una plantilla. El error vive bajo el campo que lo causó. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  fields,
  submitLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  fields: FieldSpec[]
  submitLabel: string
  onSubmit: (values: Record<string, string>) => Promise<unknown>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}>
        {open && <FormBody fields={fields} submitLabel={submitLabel} onSubmit={onSubmit} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function FormBody({
  fields,
  submitLabel,
  onSubmit,
  onClose,
}: {
  fields: FieldSpec[]
  submitLabel: string
  onSubmit: (values: Record<string, string>) => Promise<unknown>
  onClose: () => void
}) {
  const t = useT()
  const errorText = useErrorText()
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async () => {
    const found: Record<string, string> = {}
    for (const f of fields) {
      const v = values[f.name].trim()
      if (f.required && !v) found[f.name] = t('common.required')
      else if (f.maxLength && v.length > f.maxLength) found[f.name] = t('form.maxLength', { n: f.maxLength })
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setPending(true)
    setFormError(null)
    try {
      await onSubmit(Object.fromEntries(fields.map((f) => [f.name, values[f.name].trim()])))
      onClose()
    } catch (err) {
      setFormError(errorText(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      {fields.map((f, i) => {
        return (
          <label key={f.name} className="flex flex-col gap-1 text-[13px] font-medium">
            {f.label}
            {f.multiline ? (
              <Textarea
                autoFocus={i === 0}
                value={values[f.name]}
                rows={f.rows ?? 3}
                aria-invalid={errors[f.name] ? true : undefined}
                className={f.mono ? 'font-mono text-[13px]' : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            ) : (
              <Input
                autoFocus={i === 0}
                type={f.type}
                autoComplete={f.autoComplete}
                value={values[f.name]}
                aria-invalid={errors[f.name] ? true : undefined}
                className={f.mono ? 'font-mono text-[13px]' : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            )}
            {errors[f.name] && (
              <span role="alert" className="text-xs font-normal text-danger">
                {errors[f.name]}
              </span>
            )}
          </label>
        )
      })}
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
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
