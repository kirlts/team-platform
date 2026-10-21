import { useMemo } from 'react'
import { useAreas, useMembers } from '@/lib/queries'
import type { Area, Member } from '@/lib/types'

/** Nombres de áreas y miembros por id, para rotular tarjetas y destinatarios. */
export function useLookups() {
  const areas = useAreas()
  const members = useMembers()
  return useMemo(() => {
    const areaById = new Map<string, Area>((areas.data ?? []).map((a) => [a.id, a]))
    const memberById = new Map<string, Member>((members.data ?? []).map((m) => [m.id, m]))
    return {
      areas: areas.data ?? [],
      members: members.data ?? [],
      areaTitle: (id: string) => areaById.get(id)?.title ?? '',
      memberName: (id: string) => memberById.get(id)?.name ?? '',
    }
  }, [areas.data, members.data])
}
