import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'

export function Login() {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async () => {
    setPending(true)
    setError(null)
    try {
      await api('/auth/login', { method: 'POST', body: { email: email.trim(), password } })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4">
      <form
        className="flex w-full max-w-xs flex-col gap-3 rounded-lg border border-line-strong bg-raised p-5"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h1 className="text-lg font-bold uppercase tracking-wide">
          <span className="text-accent">Team</span>
        </h1>
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          Correo
          <Input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          Contraseña
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={pending || !email || !password}>
          Entrar
        </Button>
      </form>
    </main>
  )
}
