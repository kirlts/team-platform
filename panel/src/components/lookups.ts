import { useMemo } from 'react'
import { useAreas, useMembers } from '@/lib/queries'
import type { Area, Member } from '@/lib/types'

/** Area and member names by id, to label cards and recipients. */
export function useLookups() {
  const areas = useAreas()
  const members = useMembers()
  return useMemo(() => {
    const areaById = new Map<string, Area>((areas.data ?? []).map((a) => [a.id, a]))
    const memberById = new Map<string, Member>((members.data ?? []).map((m) => [m.id, m]))
    return {
      areas: areas.data ?? [],
      members: members.data ?? [],
      /** Those who can receive new messages: a deactivated account keeps its history but is not chosen. */
      activeMembers: (members.data ?? []).filter((m) => m.active !== false),
      areaTitle: (id: string) => areaById.get(id)?.title ?? '',
      memberName: (id: string) => memberById.get(id)?.name ?? '',
    }
  }, [areas.data, members.data])
}
