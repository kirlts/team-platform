// Queries and mutations against the API, with TanStack Query. The keys are:
// ['me'], ['members'], ['areas'], ['templates', areaId], ['messages', ...], ['message', id],
// ['inputs', id], ['providers'].
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrapList } from './api'
import { applyClientFilters, toApiParams, type MessageQuery } from './filters'
import type {
  Area,
  InputRecord,
  Me,
  Member,
  Message,
  MessageDetail,
  Proposal,
  ProviderSetting,
  ReplyKind,
  Template,
} from './types'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/me'),
    retry: false,
    staleTime: 60_000,
  })
}

export function useMembers() {
  return useQuery({
    queryKey: ['members'],
    queryFn: async () => unwrapList<Member>(await api('/members')),
    staleTime: 30_000,
  })
}

export function useAreas() {
  return useQuery({
    queryKey: ['areas'],
    queryFn: async () => {
      const list = unwrapList<Area>(await api('/areas'))
      return [...list].sort((a, b) => a.position - b.position)
    },
    staleTime: 30_000,
  })
}

export function useTemplates(areaId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['templates', areaId],
    queryFn: async () => unwrapList<Template>(await api(`/areas/${areaId}/templates`)),
    enabled: !!areaId && enabled,
  })
}

export interface MessagesParams {
  query: MessageQuery
  meId: string
  /** Only messages with replies, ordered by the latest one (Inicio). */
  repliesFeed?: boolean
  enabled?: boolean
}

export function useMessages({ query, meId, repliesFeed, enabled = true }: MessagesParams) {
  const params = toApiParams(query)
  if (repliesFeed) params.set('replies', '1')
  const qs = params.toString()
  return useQuery({
    queryKey: ['messages', qs, meId],
    queryFn: async () => {
      const list = unwrapList<Message>(await api(`/messages${qs ? `?${qs}` : ''}`))
      return applyClientFilters(list, query, meId)
    },
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useMessage(id: string | undefined) {
  return useQuery({
    queryKey: ['message', id],
    queryFn: () => api<MessageDetail>(`/messages/${id}`),
    enabled: !!id,
  })
}

export function useInput(id: string | undefined) {
  return useQuery({
    queryKey: ['inputs', id],
    queryFn: () => api<InputRecord>(`/inputs/${id}`),
    enabled: !!id,
  })
}

export function useProviders(enabled: boolean) {
  return useQuery({
    queryKey: ['providers'],
    queryFn: async () => unwrapList<ProviderSetting>(await api('/settings/providers')),
    enabled,
  })
}

function useInvalidator() {
  const qc = useQueryClient()
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
}

export function usePublish() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: { inputId: string; proposal: Proposal }) =>
      api(`/inputs/${v.inputId}/publish`, { method: 'POST', body: v.proposal }),
    onSuccess: () => invalidate('messages', 'areas', 'inputs'),
  })
}

export function useCancelInput() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (inputId: string) => api(`/inputs/${inputId}/cancel`, { method: 'POST' }),
    onSuccess: () => invalidate('inputs'),
  })
}

export function useReply(messageId: string) {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: { body: string; kind: ReplyKind }) =>
      api(`/messages/${messageId}/replies`, { method: 'POST', body: v }),
    onSuccess: () => invalidate('message', 'messages', 'areas'),
  })
}

export function useSetClosed() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: { id: string; closed: boolean }) =>
      api(`/messages/${v.id}/${v.closed ? 'close' : 'reopen'}`, { method: 'POST' }),
    onSuccess: () => invalidate('message', 'messages', 'areas'),
  })
}

export function useSaveArea() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: { id?: string; title?: string; description?: string }) =>
      v.id
        ? api(`/areas/${v.id}`, { method: 'PATCH', body: { title: v.title, description: v.description } })
        : api('/areas', { method: 'POST', body: { title: v.title, description: v.description } }),
    onSuccess: () => invalidate('areas'),
  })
}

export function useSaveTemplate(areaId: string) {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: { id?: string; name?: string; description?: string; body_markdown?: string }) => {
      const { id, ...fields } = v
      return id
        ? api(`/areas/${areaId}/templates/${id}`, { method: 'PATCH', body: fields })
        : api(`/areas/${areaId}/templates`, { method: 'POST', body: fields })
    },
    onSuccess: () => invalidate('templates', 'areas'),
  })
}

export function useDeleteTemplate(areaId: string) {
  const invalidate = useInvalidator()
  return useMutation({
    // Every destructive operation requires explicit confirmation (MASTER-SPEC, API conventions).
    mutationFn: (id: string) => api(`/areas/${areaId}/templates/${id}?confirm=true`, { method: 'DELETE' }),
    onSuccess: () => invalidate('templates', 'areas'),
  })
}

export function useSaveMember() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: { id: string; self: boolean; patch: Partial<Pick<Member, 'responsibilities' | 'domains' | 'role'>> }) =>
      api(v.self ? '/members/me' : `/members/${v.id}`, { method: 'PATCH', body: v.patch }),
    onSuccess: () => invalidate('members', 'me'),
  })
}

export function useSaveProvider() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: ProviderSetting) => api('/settings/providers', { method: 'PATCH', body: v }),
    onSuccess: () => invalidate('providers'),
  })
}
