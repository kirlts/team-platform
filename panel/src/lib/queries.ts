// Consultas y mutaciones contra la API, con TanStack Query. Las claves son:
// ['me'], ['members'], ['areas'], ['templates', areaId], ['messages', ...], ['message', id],
// ['inputs', id], ['providers'].
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, unwrapList } from './api'
import { applyClientFilters, toApiParams, type MessageQuery } from './filters'
import type {
  Area,
  InputRecord,
  Language,
  Me,
  Member,
  Message,
  MessageDetail,
  MessagePatch,
  NewMember,
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
  /** Sólo mensajes con respuestas, ordenados por la última (Inicio). */
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

/** Guarda el borrador de la propuesta (PATCH /inputs/:id/proposal): lo editado sobrevive a cerrar la pestaña. */
export function useSaveProposal(inputId: string) {
  return useMutation({
    mutationFn: (proposal: Proposal) => api<Proposal>(`/inputs/${inputId}/proposal`, { method: 'PATCH', body: proposal }),
  })
}

/** Cambia el texto del input enviado (PATCH /inputs/:id). */
export function useSaveInputText(inputId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (text: string) => api<InputRecord>(`/inputs/${inputId}`, { method: 'PATCH', body: { text } }),
    onSuccess: (saved) => qc.setQueryData(['inputs', inputId], (old: InputRecord | undefined) => (old ? { ...old, text: saved.text ?? old.text } : old)),
  })
}

/** Vuelve a encolar el análisis de un input que falló; conserva el texto y las extracciones (POST /inputs/:id/reprocess). */
export function useReprocess() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (inputId: string) => api<{ input_id: string; job_id: string }>(`/inputs/${inputId}/reprocess`, { method: 'POST' }),
    onSuccess: () => invalidate('inputs'),
  })
}

export function useCancelInput() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (inputId: string) => api(`/inputs/${inputId}/cancel`, { method: 'POST' }),
    onSuccess: () => invalidate('inputs'),
  })
}

/** Responde; con archivos, el envío es multipart (POST /messages/:id/replies con `files` y `links`). */
export function useReply(messageId: string) {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: { body: string; kind: ReplyKind; files?: File[]; links?: string[] }) => {
      if (!v.files?.length && !v.links?.length) return api(`/messages/${messageId}/replies`, { method: 'POST', body: { body: v.body, kind: v.kind } })
      const form = new FormData()
      form.append('body', v.body)
      form.append('kind', v.kind)
      for (const f of v.files ?? []) form.append('files', f, f.name)
      for (const l of v.links ?? []) form.append('links', l)
      return api(`/messages/${messageId}/replies`, { method: 'POST', form })
    },
    onSuccess: () => invalidate('message', 'messages', 'areas'),
  })
}

/** Edición en el lugar de un mensaje publicado (PATCH /messages/:id). Devuelve el mensaje guardado. */
export function usePatchMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: MessagePatch }) => api<MessageDetail>(`/messages/${v.id}`, { method: 'PATCH', body: v.patch }),
    onSuccess: (saved, v) => {
      qc.setQueryData(['message', v.id], (old: MessageDetail | undefined) => (old ? { ...old, ...saved, replies: saved.replies ?? old.replies } : old))
      void qc.invalidateQueries({ queryKey: ['messages'] })
      void qc.invalidateQueries({ queryKey: ['areas'] })
    },
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
    // Toda operación destructiva exige confirmación explícita (MASTER-SPEC, convenciones de API).
    mutationFn: (id: string) => api(`/areas/${areaId}/templates/${id}?confirm=true`, { method: 'DELETE' }),
    onSuccess: () => invalidate('templates', 'areas'),
  })
}

/** Restaura una plantilla borrada (POST /templates/:id/restore): es lo que deshace un borrado. */
export function useRestoreTemplate() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (id: string) => api<Template>(`/templates/${id}/restore`, { method: 'POST' }),
    onSuccess: () => invalidate('templates', 'areas'),
  })
}

export function useSaveMember() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: {
      id: string
      self: boolean
      patch: Partial<Pick<Member, 'responsibilities' | 'domains' | 'role' | 'name' | 'email'>> & { language?: Language; current_password?: string; new_password?: string }
    }) => api<Member>(v.self ? '/members/me' : `/members/${v.id}`, { method: 'PATCH', body: v.patch }),
    onSuccess: () => invalidate('members', 'me'),
  })
}

/** Alta de un miembro (POST /members, sólo el Editor). */
export function useCreateMember() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: NewMember) => api<Member>('/members', { method: 'POST', body: v }),
    onSuccess: () => invalidate('members'),
  })
}

/** El idioma de la cuenta cambia la interfaz al instante: se escribe en `me` antes de que el servidor conteste. */
export function useSaveLanguage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (language: Language) => api<Member>('/members/me', { method: 'PATCH', body: { language } }),
    onMutate: async (language) => {
      await qc.cancelQueries({ queryKey: ['me'] })
      const before = qc.getQueryData<Me>(['me'])
      if (before) qc.setQueryData<Me>(['me'], { ...before, language })
      return { before }
    },
    onError: (_err, _language, ctx) => {
      if (ctx?.before) qc.setQueryData(['me'], ctx.before)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['members'] })
    },
  })
}

export function useSaveProvider() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: Pick<ProviderSetting, 'slot' | 'provider' | 'model'>) => api('/settings/providers', { method: 'PATCH', body: { slot: v.slot, provider: v.provider, model: v.model } }),
    onSuccess: () => invalidate('providers'),
  })
}
