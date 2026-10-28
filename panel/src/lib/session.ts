// The end of the session, noticed where it happens. The entry used to be drawn only when the query for «me» failed, and that query
// is fresh for a minute and is not asked again on focus: with the page open and the session over on the server, every other call
// failed with «La sesión terminó» and the person stayed in a panel that could do nothing. A 401 from any call (a read, a change, an
// upload) is the event: it makes «me» ask again, the server answers 401, and the app draws the entry (or goes to the host's).
import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@team-platform/client'

type Listener = () => void

let listener: Listener | null = null

/** Called by the client of the panel for each answer: only a 401 on a path other than «me» is the end of a session. */
export function noteStatus(path: string, status: number): void {
  // «me» is the one that decides; its own 401 is already the entry. A bad password at the entry is a 401 too, but the entry is already drawn then.
  if (status !== 401 || path === '/me') return
  listener?.()
}

/** Makes a 401 from any call refresh «me». Returns the function that stops listening. */
export function watchSession(queryClient: QueryClient): () => void {
  const mine: Listener = () => {
    const state = queryClient.getQueryState(queryKeys.me())
    // Nothing to do when «me» is not holding a session (the entry is drawn) or is already being asked.
    if (state?.status !== 'success' || state.fetchStatus === 'fetching') return
    void queryClient.refetchQueries({ queryKey: queryKeys.me() })
  }
  listener = mine
  return () => {
    if (listener === mine) listener = null
  }
}
