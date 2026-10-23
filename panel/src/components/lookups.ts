import { useMemo } from 'react'
import type { Area, Member } from '@team-platform/client'
import { useAreas, useMembers } from '@team-platform/client/react'

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
      /** The color chosen for the area (`#rrggbb`); undefined when the id is unknown or an older server sent none. */
      areaColor: (id: string) => areaById.get(id)?.color,
      memberName: (id: string) => memberById.get(id)?.name ?? '',
    }
  }, [areas.data, members.data])
}
