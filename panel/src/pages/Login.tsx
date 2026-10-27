import { useState } from 'react'
import { Atmosphere } from '@/components/Atmosphere'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useErrorText, useT } from '@/i18n'
import { useLogin } from '@team-platform/client/react'
import { cn } from '@/lib/utils'

type Field = 'email' | 'password'

export function Login() {
  const t = useT()
  const errorText = useErrorText()
  const login = useLogin()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  /** The reason each field is marked with, shown under that field. The server does not say which of the pair it refused, so the reason goes under the last one. */
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [pending, setPending] = useState(false)

  const submit = async () => {
    const missing: Partial<Record<Field, string>> = {}
    if (!email.trim()) missing.email = t('login.missingEmail')
    if (!password) missing.password = t('login.missingPassword')
    if (missing.email || missing.password) {
      setErrors(missing)
      return
    }
    setPending(true)
    setErrors({})
    try {
      await login.mutateAsync({ email: email.trim(), password })
    } catch (err) {
      setErrors({ email: '', password: errorText(err) })
    } finally {
      setPending(false)
    }
  }

  const fieldClass = (field: Field) => cn('[@media(pointer:coarse)]:h-11', errors[field] !== undefined && '!border-danger')

  return (
    <main data-screen="login" className="relative flex min-h-dvh items-center justify-center px-5">
      <Atmosphere />
      <form
        className="glass-strong leaf relative z-10 flex w-full max-w-sm flex-col gap-3 p-7"
        aria-busy={pending}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h1>
          <Wordmark name={t('brand.name')} large />
        </h1>
        <div className="flex flex-col gap-2">
          <label htmlFor="login-email" className="rotulo">
            {t('login.email')}
          </label>
          <Input id="login-email" type="email" autoComplete="username" autoFocus readOnly={pending} aria-invalid={errors.email !== undefined ? true : undefined} aria-describedby={errors.email ? 'login-email-error' : undefined} className={fieldClass('email')} value={email} onChange={(e) => setEmail(e.target.value)} />
          {/* The line is kept free under the field, so the reason appears without moving the card. */}
          <div className="-mt-1 min-h-6">
            {errors.email && (
              <p id="login-email-error" role="alert" className="text-sm text-danger">
                {errors.email}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="login-password" className="rotulo">
            {t('login.password')}
          </label>
          <Input id="login-password" type="password" autoComplete="current-password" readOnly={pending} aria-invalid={errors.password !== undefined ? true : undefined} aria-describedby={errors.password ? 'login-password-error' : undefined} className={fieldClass('password')} value={password} onChange={(e) => setPassword(e.target.value)} />
          {/* The line is kept free under the field, so the reason appears without moving the card. */}
          <div className="-mt-1 min-h-6">
            {errors.password && (
              <p id="login-password-error" role="alert" className="text-sm text-danger">
                {errors.password}
              </p>
            )}
          </div>
        </div>
        <Button type="submit" variant="primary" size="lg" className="justify-center" disabled={pending}>
          {pending ? t('login.entering') : t('login.enter')}
        </Button>
      </form>
    </main>
  )
}
