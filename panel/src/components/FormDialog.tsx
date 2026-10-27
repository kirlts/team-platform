import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Eye, EyeOff } from '@/components/icons'
import { Input, Textarea } from '@/components/ui/input'
import { useErrorText, useT } from '@/i18n'
import { cn } from '@/lib/utils'

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
  /** A requirement the person cannot guess and the server enforces, under the field (a password's minimum). */
  hint?: string
  autoComplete?: string
}

/** Short form in a window: creates an area or a template. The error lives under the field that caused it. */
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
  /** The password fields whose text is showing. */
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set())

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
          <label key={f.name} className="flex flex-col gap-1 text-sm font-medium">
            {f.label}
            {f.multiline ? (
              <Textarea
                autoFocus={i === 0}
                value={values[f.name]}
                rows={f.rows ?? 3}
                aria-invalid={errors[f.name] ? true : undefined}
                className={f.mono ? 'font-mono text-xs' : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            ) : (
              <span className="relative block">
                <Input
                  autoFocus={i === 0}
                  type={f.type === 'password' && shown.has(f.name) ? 'text' : f.type}
                  autoComplete={f.autoComplete}
                  value={values[f.name]}
                  aria-invalid={errors[f.name] ? true : undefined}
                  className={cn(f.mono && 'font-mono text-xs', f.type === 'password' && 'pr-10')}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                />
                {f.type === 'password' && (
                  <button
                    type="button"
                    aria-label={shown.has(f.name) ? t('password.hide') : t('password.show')}
                    aria-pressed={shown.has(f.name)}
                    onClick={() => setShown((set) => { const next = new Set(set); if (!next.delete(f.name)) next.add(f.name); return next })}
                    className="absolute inset-y-0 right-0 inline-flex w-10 items-center justify-center rounded-md text-muted hover:text-fg pointer-coarse:w-11"
                  >
                    {shown.has(f.name) ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  </button>
                )}
              </span>
            )}
            {f.hint && !errors[f.name] && <span className="text-xs font-normal text-muted">{f.hint}</span>}
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
