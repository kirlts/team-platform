import { useCallback, useRef, useState } from 'react'

/**
 * What a person has written and not sent lives in `sessionStorage`, not only in component state (TP-04): the component of the bar, or of a reply, is
 * unmounted by every link of the sidebar, the header or the bell, by Atrás and by a reload, and what was in its state went with it.
 *
 * One entry per draft, `team-draft:compose` for the send bar and `team-draft:reply:<messageId>` for the reply of a message. Inside the entry each
 * member of the session keeps their own value, so another person who signs in on the same tab finds an empty bar and the first one finds their text
 * again (the rule of the former text-only store). `sessionStorage` is the tab's: a draft does not outlive the tab and never reaches the server.
 * Without storage (private window, blocked site data) the draft just does not survive, and the hook still works in memory.
 */
export const DRAFT_PREFIX = 'team-draft:'

type Entry = Record<string, unknown>

function readEntry(key: string): Entry {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Entry) : {}
  } catch {
    return {}
  }
}

/** The value of `owner` in the draft `key`, or `empty` when there is none. */
export function readDraft<T>(key: string, owner: string | undefined, empty: T): T {
  if (!owner) return empty
  const value = readEntry(key)[owner]
  return value === undefined ? empty : (value as T)
}

/** Stores `value` for `owner`; a value equal to `empty` removes it, and an entry with no values is removed. */
export function writeDraft<T>(key: string, owner: string | undefined, value: T, empty: T): void {
  if (!owner) return
  try {
    const entry = readEntry(key)
    if (JSON.stringify(value) === JSON.stringify(empty)) delete entry[owner]
    else entry[owner] = value
    if (Object.keys(entry).length) sessionStorage.setItem(key, JSON.stringify(entry))
    else sessionStorage.removeItem(key)
  } catch {
    // The draft just does not survive.
  }
}

/** Takes the drafts of `owner` out of every entry: signing out removes what the person who signs out had written. */
export function clearDraftsOf(owner: string | undefined): void {
  if (!owner) return
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i)
      if (key?.startsWith(DRAFT_PREFIX)) writeDraft(key, owner, null, null)
    }
  } catch {
    // Nothing to clear.
  }
}

/**
 * A draft that survives leaving the screen. `empty` is the value of a draft with nothing written; `owner` is the member of the session (before «me» is
 * known the draft is empty and not stored; when it arrives the stored one is read).
 */
export function useDraft<T>(key: string, empty: T, owner: string | undefined) {
  const [state, setState] = useState(() => ({ owner, value: readDraft(key, owner, empty) }))
  // The member changed (the session of another person on the same tab): their draft, not the previous one.
  let current = state
  if (state.owner !== owner) {
    current = { owner, value: readDraft(key, owner, empty) }
    setState(current)
  }
  // Two calls in one event (a mention changes the text and the people picked) each start from what the previous one left, not from the render.
  const latest = useRef(current.value)
  latest.current = current.value
  const setValue = useCallback(
    (next: T | ((previous: T) => T)) => {
      const value = typeof next === 'function' ? (next as (previous: T) => T)(latest.current) : next
      latest.current = value
      writeDraft(key, owner, value, empty)
      setState({ owner, value })
    },
    [key, owner], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const clear = useCallback(() => setValue(empty), [setValue, empty])
  return { value: current.value, setValue, clear }
}
