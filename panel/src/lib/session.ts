// The end of the session, noticed where it happens. The entry used to be drawn only when the query for «me» failed, and that query
// is fresh for a minute and is not asked again on focus: with the page open and the session over on the server, every other call
// failed with «La sesión terminó» and the person stayed in a panel that could do nothing. A 401 from any call (a read, a change, an
// upload) is the event: it makes «me» ask again, the server answers 401, and the app draws the entry (or goes to the host's).
import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@team-platform/client'

type Listener = () => void

let listener: Listener | null = null
/** The email of the session that was open when «me» was asked again: kept only if the answer is a 401. */
let pendingEmail = ''

/** Asks «me» again now. Done on each change of screen: a view drawn from data already in memory makes no call, so it would never learn that the session is over. */
export function checkSession(): void {
  listener?.()
}

const ENDED_KEY = 'team-session-ended'
const DRAFT_KEY = 'team-draft-text'

/** Called when «me» answers 401 after having held a session: the entry says that it ended and keeps the email. Without storage nothing is kept. */
export function rememberEndedSession(): void {
  try {
    sessionStorage.setItem(ENDED_KEY, JSON.stringify({ email: pendingEmail }))
  } catch {
    // Without storage the entry just does not say why.
  }
}

/** What the entry shows after an ended session, or null on a first visit. */
export function readEndedSession(): { email: string } | null {
  try {
    const raw = sessionStorage.getItem(ENDED_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { email?: unknown }
    return { email: typeof parsed.email === 'string' ? parsed.email : '' }
  } catch {
    return null
  }
}

export function clearEndedSession(): void {
  try {
    sessionStorage.removeItem(ENDED_KEY)
  } catch {
    // Nothing to clear.
  }
}

/** The text of the bar of Inicio survives a trip through the entry. */
export function loadDraftText(): string {
  try {
    return sessionStorage.getItem(DRAFT_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveDraftText(text: string): void {
  try {
    if (text) sessionStorage.setItem(DRAFT_KEY, text)
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // The draft just does not survive.
  }
}

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
    // If the server says the session is over, the entry will say so and keep the email (rememberEndedSession).
    const email = (state.data as { email?: unknown } | undefined)?.email
    pendingEmail = typeof email === 'string' ? email : ''
    void queryClient.refetchQueries({ queryKey: queryKeys.me() }).then(() => {
      if (queryClient.getQueryState(queryKeys.me())?.status === 'error') rememberEndedSession()
    })
  }
  listener = mine
  return () => {
    if (listener === mine) listener = null
  }
}
