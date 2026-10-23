import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TeamApiError } from '@team-platform/client'
import { TeamClientProvider } from '@team-platform/client/react'
import { client } from '@/lib/client'
import { watchProse } from '@/lib/prose-width'
import { initTheme } from '@/lib/theme'
import { App } from './App'
import './styles.css'

initTheme()
watchProse()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // An expired session or a missing resource is not fixed by retrying.
      retry: (count, error) => !(error instanceof TeamApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TeamClientProvider client={client}>
        <App />
      </TeamClientProvider>
    </QueryClientProvider>
  </StrictMode>,
)
