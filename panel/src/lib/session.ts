// The end of the session, noticed where it happens. The entry used to be drawn only when the query for «me» failed, and that query
// is fresh for a minute and is not asked again on focus: with the page open and the session over on the server, every other call
// failed with «La sesión terminó» and the person stayed in a panel that could do nothing. A 401 from any call (a read, a change, an
// upload) is the event: it makes «me» ask again, the server answers 401, and the app draws the entry (or goes to the host's).
import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@team-platform/client'

type Listener = () => void

let listener: Listener | null = null

/** Asks «me» again now. Done on each change of screen: a view drawn from data already in memory makes no call, so it would never learn that the session is over. */
export function checkSession(): void {
  listener?.()
}

const ENDED_KEY = 'team-session-ended'
const LOST_KEY = 'team-action-lost'
const DRAFT_KEY = 'team-draft-text'

/** What the ended session carried, said again after signing in: the email, whose it was, whether a change was on its way and how many files of a send were lost. */
interface Ended {
  email: string
  memberId: string
  action: boolean
  files: number
}
/** Of the session that was open when «me» was asked again: kept only if the answer is a 401. */
let pending: Ended = { email: '', memberId: '', action: false, files: 0 }
let pendingAction = false

function put(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Without storage the entry just does not say why.
  }
}

function read(key: string): Partial<Ended> | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Partial<Ended>) : null
  } catch {
    return null
  }
}

function drop(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Nothing to clear.
  }
}

/** Called when «me» answers 401 after having held a session: the entry says that it ended and keeps the email. */
export function rememberEndedSession(): void {
  put(ENDED_KEY, { ...pending, action: pending.action || pendingAction })
  pendingAction = false
  pending = { ...pending, files: 0 }
}

/** A send that failed for the end of the session lost its files (they are not kept): the notice after signing in says how many. */
export function noteLostFiles(n: number): void {
  pending = { ...pending, files: n }
  const stored = read(ENDED_KEY)
  if (stored) put(ENDED_KEY, { ...stored, files: n })
}

/** What the entry shows after an ended session, or null on a first visit. */
export function readEndedSession(): { email: string } | null {
  const stored = read(ENDED_KEY)
  return stored ? { email: typeof stored.email === 'string' ? stored.email : '' } : null
}

/** Signed in again: the ended session is told no more at the entry, and if a change was on its way the panel says it was not completed. */
export function settleEndedSession(): void {
  const stored = read(ENDED_KEY)
  drop(ENDED_KEY)
  if (stored?.action) put(LOST_KEY, { memberId: stored.memberId ?? '', files: stored.files ?? 0 })
}

/** The change that did not complete with the ended session of this person, once; another person who signs in does not read it. */
export function takeLostAction(memberId: string): { files: number } | null {
  const stored = read(LOST_KEY)
  drop(LOST_KEY)
  if (!stored || stored.memberId !== memberId) return null
  return { files: typeof stored.files === 'number' ? stored.files : 0 }
}

/**
 * The text of the bar of Inicio survives a trip through the entry, but only for the person who wrote it: each draft is stored under the id of its
 * member, so another person who signs in on the same tab finds an empty bar and the first one finds their text again.
 */
export function loadDraftText(memberId: string | undefined): string {
  if (!memberId) return ''
  try {
    const all = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, unknown>
    return typeof all[memberId] === 'string' ? (all[memberId] as string) : ''
  } catch {
    return ''
  }
}

export function saveDraftText(text: string, memberId: string | undefined): void {
  if (!memberId) return
  try {
    const all = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, unknown>
    if (text) all[memberId] = text
    else delete all[memberId]
    if (Object.keys(all).length) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(all))
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // The draft just does not survive.
  }
}

/** Signing out takes the draft of whoever signs out; the drafts of others stay under their own ids, which nobody else reads. */
export function clearDrafts(memberId: string | undefined): void {
  saveDraftText('', memberId)
  drop(LOST_KEY)
}

/** Called by the client of the panel for each answer: only a 401 on a path other than «me» is the end of a session. */
export function noteStatus(path: string, status: number, method = 'GET'): void {
  // «me» is the one that decides; its own 401 is already the entry. A bad password at the entry is a 401 too, but the entry is already drawn then.
  if (status !== 401 || path === '/me') return
  // A change that was on its way did not happen: the panel says so after signing in.
  if (method !== 'GET') pendingAction = true
  listener?.()
}

/** Makes a 401 from any call refresh «me». Returns the function that stops listening. */
export function watchSession(queryClient: QueryClient): () => void {
  const mine: Listener = () => {
    const state = queryClient.getQueryState(queryKeys.me())
    // Nothing to do when «me» is not holding a session (the entry is drawn) or is already being asked.
    if (state?.status !== 'success' || state.fetchStatus === 'fetching') return
    // If the server says the session is over, the entry will say so and keep the email (rememberEndedSession).
    const me = state.data as { email?: unknown; id?: unknown } | undefined
    pending = { email: typeof me?.email === 'string' ? me.email : '', memberId: me?.id === undefined ? '' : String(me.id), action: false, files: pending.files }
    void queryClient.refetchQueries({ queryKey: queryKeys.me() }).then(() => {
      if (queryClient.getQueryState(queryKeys.me())?.status === 'error') rememberEndedSession()
    })
  }
  listener = mine
  return () => {
    if (listener === mine) listener = null
  }
}
