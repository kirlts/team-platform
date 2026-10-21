import { useSyncExternalStore } from 'react'

const QUERY = '(max-width: 767px)'

/** True on a phone (under the 768 px where the drawer of Inicio stacks its two columns). */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia?.(QUERY)
      list?.addEventListener('change', notify)
      return () => list?.removeEventListener('change', notify)
    },
    () => window.matchMedia?.(QUERY).matches ?? false,
    () => false,
  )
}
