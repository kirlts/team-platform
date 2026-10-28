import { useEffect, useState } from 'react'
import { Atmosphere } from '@/components/Atmosphere'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useErrorText, useT } from '@/i18n'
import { isTeamApiError } from '@team-platform/client'
import { useLogin } from '@team-platform/client/react'
import { readEndedSession, settleEndedSession } from '@/lib/session'
import { cn } from '@/lib/utils'

type Field = 'email' | 'password'

export function Login() {
  const t = useT()
  const errorText = useErrorText()
  const login = useLogin()
  /** Set when the session ended with the page open: the entry says so and keeps the email it was open with. */
  const [ended] = useState(readEndedSession)
  const [email, setEmail] = useState(ended?.email ?? '')
  const [password, setPassword] = useState('')
  /** The reason each field is marked with, shown under that field. The server does not say which of the pair it refused, so the reason goes under the last one. */
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [pending, setPending] = useState(false)
  /** A wait is not a reason about the fields: it counts down on its own line and marks nothing. `until` is when it ends (ms); without it the server gave no count and `text` stays. */
  const [wait, setWait] = useState<{ until: number | null; text: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!wait?.until) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [wait?.until])
  const left = wait?.until ? Math.ceil((wait.until - now) / 1000) : null

  const submit = async () => {
    if (pending) return
    const missing: Partial<Record<Field, string>> = {}
    if (!email.trim()) missing.email = t('login.missingEmail')
    if (!password) missing.password = t('login.missingPassword')
    if (missing.email || missing.password) {
      setErrors(missing)
      return
    }
    setPending(true)
    setErrors({})
    setWait(null)
    try {
      await login.mutateAsync({ email: email.trim(), password })
      settleEndedSession()
    } catch (err) {
      if (isTeamApiError(err) && err.code === 'too_many_requests') {
        // A wait says its seconds, the server's own count (it grows with each failure and is not «minutes»), and goes down each second until it is gone.
        const seconds = err.details.retryAfterSeconds
        setWait({ until: typeof seconds === 'number' ? Date.now() + seconds * 1000 : null, text: errorText(err) })
      } else {
        setErrors({ email: '', password: errorText(err) })
      }
    } finally {
      setPending(false)
    }
  }

  const fieldClass = (field: Field) => cn('[@media(pointer:coarse)]:h-11', errors[field] !== undefined && '!border-danger')

  const reasons = [errors.email, errors.password].filter((r): r is string => !!r)
  const waiting = wait && (left === null || left > 0)
  return (
    <main data-screen="login" className="relative flex min-h-dvh items-center justify-center px-5">
      <Atmosphere />
      <div className="relative z-10 w-full max-w-sm">
      <form
        className="glass-strong leaf relative flex w-full flex-col gap-6 p-7"
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
          <Input id="login-email" type="email" autoComplete="username" autoFocus={!ended?.email} readOnly={pending} aria-invalid={errors.email !== undefined ? true : undefined} aria-describedby={errors.email ? 'login-email-error' : undefined} className={fieldClass('email')} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="login-password" className="rotulo">
            {t('login.password')}
          </label>
          <Input id="login-password" type="password" autoComplete="current-password" autoFocus={!!ended?.email} readOnly={pending} aria-invalid={errors.password !== undefined ? true : undefined} aria-describedby={errors.password ? 'login-password-error' : undefined} className={fieldClass('password')} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {/* Not `disabled`: a disabled gel is dimmed and the word «Entrando» is the one thing to read while it waits (E-1). The submit is ignored in `submit`. */}
        <Button type="submit" variant="primary" size="lg" className="justify-center" aria-disabled={pending || undefined}>
          {pending ? t('login.entering') : t('login.enter')}
        </Button>
      </form>
      {/* Under the card and out of its flow: a reason of one line or of two never moves the card (DISENO.md, entrada). */}
      <div className="absolute inset-x-0 top-full mt-3 flex flex-col gap-1 px-1">
        {ended && reasons.length === 0 && !waiting && (
          <p role="status" data-testid="login-session-ended" className="text-sm text-fg">
            {t('login.sessionEnded')}
          </p>
        )}
        {waiting && (
          <p role="alert" data-testid="login-wait" className="text-sm text-danger">
            {left === null ? wait.text : t('login.wait', { n: left })}
          </p>
        )}
        {errors.email && (
          <p id="login-email-error" role="alert" className="text-sm text-danger">
            {errors.email}
          </p>
        )}
        {errors.password && (
          <p id="login-password-error" role="alert" className="text-sm text-danger">
            {errors.password}
          </p>
        )}
      </div>
      </div>
    </main>
  )
}
