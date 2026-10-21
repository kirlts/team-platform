import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApiError } from '@/lib/api'
import { initTheme } from '@/lib/theme'
import { App } from './App'
import './styles.css'

initTheme()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Una sesión vencida o un recurso ausente no se arreglan reintentando.
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
