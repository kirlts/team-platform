import { useCallback, useEffect, useState } from 'react'

// Whether the side panel is hidden, remembered per person (UD-047). Stored only as a convenience of this browser: without
// storage (private window, blocked) the panel starts shown and the choice holds for the tab.

export const sidebarKey = (memberId: string | undefined) => `team-sidebar-hidden:${memberId ?? 'anon'}`

export function readSidebarHidden(memberId: string | undefined): boolean {
  try {
    return localStorage.getItem(sidebarKey(memberId)) === '1'
  } catch {
    return false
  }
}

export function saveSidebarHidden(memberId: string | undefined, hidden: boolean) {
  try {
    localStorage.setItem(sidebarKey(memberId), hidden ? '1' : '0')
  } catch {
    // Without storage the choice only holds for this tab.
  }
}

/** `[hidden, setHidden]`: read when the person is known and saved on each change. */
export function useSidebarHidden(memberId: string | undefined): [boolean, (hidden: boolean) => void] {
  const [hidden, set] = useState(() => readSidebarHidden(memberId))
  useEffect(() => set(readSidebarHidden(memberId)), [memberId])
  const change = useCallback(
    (next: boolean) => {
      set(next)
      saveSidebarHidden(memberId, next)
    },
    [memberId],
  )
  return [hidden, change]
}
