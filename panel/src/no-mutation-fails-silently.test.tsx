// TP-17 (soft-lock study 2026-11-04): a failed change made through `mutate()` had no handler, so the button came back and nothing
// said whether the deletion, the Undo or the Discard happened. One `MutationCache.onError` shows the failure as a notice (tone «danger»),
// except what already showed it in place (the one that caught the rejection and wrote `errorText(err)`) or declared `meta.silent`.
import { MutationCache, QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { TeamApiError } from '@team-platform/client'
import { useDeleteMessage } from '@team-platform/client/react'
import { I18nProvider, useErrorText } from '@/i18n'
import { MutationErrorBridge } from '@/components/MutationErrorBridge'
import { createMutationCache } from '@/lib/mutation-errors'
import { NoticeProvider, useNotices } from '@/lib/notices'
import { mockApi, WithTeamClient } from '@/test/mock-api'

beforeAll(() => {
  Object.assign(window, { matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }) })
})
afterEach(cleanup)
mockApi(async (_path: string, request: { method?: string }) => {
  if (request.method !== 'GET') throw new TeamApiError(500, 'El servidor falló', 'boom')
  return { items: [] }
})

function Probe() {
  const { current } = useNotices()
  return current ? <div data-testid="notice" data-tone={current.tone}>{current.text}</div> : null
}

function Mount({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ mutationCache: createMutationCache(), defaultOptions: { queries: { retry: false } } }))
  return (
    <QueryClientProvider client={client}>
      <WithTeamClient>
        <I18nProvider language="es-419">
          <NoticeProvider>
            <MutationErrorBridge />
            <Probe />
            {children}
          </NoticeProvider>
        </I18nProvider>
      </WithTeamClient>
    </QueryClientProvider>
  )
}

function FireAndForget() {
  const remove = useDeleteMessage()
  return <button onClick={() => remove.mutate('m1')}>Borrar</button>
}

function ShowsInPlace() {
  const remove = useDeleteMessage()
  const errorText = useErrorText()
  const [text, setText] = useState('')
  return (
    <>
      <button onClick={() => remove.mutateAsync('m1').catch((e) => setText(errorText(e)))}>Borrar aquí</button>
      <p data-testid="in-place">{text}</p>
    </>
  )
}

function Silent() {
  const m = useMutation({ mutationFn: async () => { throw new Error('ya lo muestro yo') }, meta: { silent: true } })
  return <button onClick={() => m.mutate()}>Callado</button>
}

describe('no failed change is mute (TP-17)', () => {
  it('a failed `mutate()` leaves a notice with tone «danger» and the server sentence', async () => {
    render(<Mount><FireAndForget /></Mount>)
    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    const notice = await screen.findByTestId('notice')
    expect(notice.getAttribute('data-tone')).toBe('danger')
    expect(notice.textContent).toContain('El servidor falló')
  })

  it('a failure the caller already wrote in place does not repeat as a notice', async () => {
    render(<Mount><ShowsInPlace /></Mount>)
    fireEvent.click(screen.getByRole('button', { name: 'Borrar aquí' }))
    await waitFor(() => expect(screen.getByTestId('in-place').textContent).toContain('El servidor falló'))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('notice')).toBeNull()
  })

  it('`meta.silent` keeps a mutation out of the notice', async () => {
    render(<Mount><Silent /></Mount>)
    fireEvent.click(screen.getByRole('button', { name: 'Callado' }))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('notice')).toBeNull()
  })

  it('the panel builds its QueryClient with that cache and the shell mounts the bridge', () => {
    expect(readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8')).toMatch(/mutationCache:\s*createMutationCache\(\)/)
    expect(readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8')).toMatch(/<MutationErrorBridge\s*\/>/)
  })

  it('every change whose component draws its error in place (`x.isError`) is declared silent in the hooks', () => {
    const hooks = readFileSync(resolve(process.cwd(), '../packages/client/src/react/hooks.ts'), 'utf8')
    const declared = new Map<string, boolean>() // hook name -> declares IN_PLACE
    for (const m of hooks.matchAll(/export function (use\w+)\([^)]*\)[^{]*\{([\s\S]*?)\n\}\n/g)) {
      if (m[2].includes('useMutation(')) declared.set(m[1], m[2].includes('meta: IN_PLACE'))
    }
    expect(declared.size).toBeGreaterThan(40)
    const root = resolve(process.cwd(), 'src') + '/'
    const files: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const full = `${dir}/${f}`
        if (statSync(full).isDirectory()) walk(full)
        else if (full.endsWith('.tsx') && !full.includes('.test.')) files.push(full)
      }
    }
    walk(root)
    const missing: string[] = []
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
      for (const m of code.matchAll(/const (\w+) = (use\w+)\(/g)) {
        const [, variable, hook] = m
        if (declared.has(hook) && !declared.get(hook) && new RegExp(`\\b${variable}\\.(isError|error)\\b`).test(code)) missing.push(`${file.slice(root.length)}: ${variable} = ${hook}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('the cache is a MutationCache', () => {
    expect(createMutationCache()).toBeInstanceOf(MutationCache)
  })
})
