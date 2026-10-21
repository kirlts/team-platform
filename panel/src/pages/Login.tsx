import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Atmosphere } from '@/components/Atmosphere'
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
    <main className="relative flex min-h-dvh items-center px-5 md:px-[12vw]">
      <Atmosphere />
      <form
        className="glass leaf relative z-10 flex w-full max-w-sm flex-col gap-4 p-7"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h1 className="flex items-center gap-3 text-[1.1rem] font-bold uppercase tracking-[0.18em]">
          <span aria-hidden className="orb h-4 w-4 rounded-full" />
          Team
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
