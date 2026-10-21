import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Atmosphere } from '@/components/Atmosphere'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useErrorText, useT } from '@/i18n'
import { api } from '@/lib/api'

export function Login() {
  const t = useT()
  const errorText = useErrorText()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** The field the error is about: both when the server refused the pair, since it does not say which one. */
  const [bad, setBad] = useState<{ email: boolean; password: boolean }>({ email: false, password: false })
  const [pending, setPending] = useState(false)

  const submit = async () => {
    const missing = { email: !email.trim(), password: !password }
    if (missing.email || missing.password) {
      setBad(missing)
      setError(missing.email ? t('login.missingEmail') : t('login.missingPassword'))
      return
    }
    setPending(true)
    setError(null)
    setBad({ email: false, password: false })
    try {
      await api('/auth/login', { method: 'POST', body: { email: email.trim(), password } })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    } catch (err) {
      setBad({ email: true, password: true })
      setError(errorText(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5">
      <Atmosphere />
      <form
        className="glass-strong leaf relative z-10 flex w-full max-w-sm flex-col gap-4 !border-edge p-7"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h1>
          <Wordmark name={t('brand.name')} large />
        </h1>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('login.email')}
          <Input type="email" autoComplete="username" autoFocus aria-invalid={bad.email ? true : undefined} aria-describedby="login-error" className={bad.email ? '!border-danger' : undefined} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('login.password')}
          <Input type="password" autoComplete="current-password" aria-invalid={bad.password ? true : undefined} aria-describedby="login-error" className={bad.password ? '!border-danger' : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          {t('login.enter')}
        </Button>
        <p className="text-sm text-muted">{t('login.noAccount')}</p>
        {/* The error has its row at the foot of the card, always reserved, so it fills the row and does not move the card, and no gap opens between the fields and Entrar (J2-A-01, J3-A-03). Outside the labels, so it is not part of a field's name. */}
        <p id="login-error" role="alert" className="-mt-2 min-h-[1.45rem] text-sm text-danger">
          {error}
        </p>
      </form>
    </main>
  )
}
