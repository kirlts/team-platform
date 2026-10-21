import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Atmosphere } from '@/components/Atmosphere'
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
  const [pending, setPending] = useState(false)

  const submit = async () => {
    if (!email.trim() || !password) {
      setError(t('login.missing'))
      return
    }
    setPending(true)
    setError(null)
    try {
      await api('/auth/login', { method: 'POST', body: { email: email.trim(), password } })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    } catch (err) {
      setError(errorText(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5">
      <Atmosphere />
      <form
        className="glass leaf relative z-10 flex w-full max-w-sm flex-col gap-4 p-7"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h1 className="flex items-center gap-3 font-[family-name:var(--font-display)] text-[1.5rem] font-extrabold uppercase tracking-[0.16em]">
          <span aria-hidden className="orb h-4 w-4 rounded-full" />
          {t('brand.name')}
        </h1>
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          {t('login.email')}
          <Input type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          {t('login.password')}
          <Input type="password" autoComplete="current-password" aria-invalid={error ? true : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && (
            <span role="alert" className="text-[13px] font-normal text-danger">
              {error}
            </span>
          )}
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          {t('login.enter')}
        </Button>
      </form>
    </main>
  )
}
