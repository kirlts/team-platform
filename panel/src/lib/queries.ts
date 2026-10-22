// Queries and mutations against the API, with TanStack Query. The keys are:
// ['me'], ['members'], ['areas'], ['templates', areaId], ['messages', ...], ['message', id],
// ['inputs', id], ['providers'].
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, unwrapList } from './api'
import { applyClientFilters, toApiParams, type MessageQuery } from './filters'
import type {
  Area,
  Check,
  Connection,
  ConnectionsView,
  InputRecord,
  Language,
  Me,
  Member,
  Message,
  MessageDetail,
  MessageSummary,
  MessagePatch,
  NewConnection,
  NewMember,
  Proposal,
  ProviderSetting,
  ProviderSlot,
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
  /** Only messages with replies, ordered by the latest (Inicio). */
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

/** What affects the person and the pending of each area. Lives under ['messages'], so every change to a message refreshes it. */
export function useSummary(enabled = true) {
  return useQuery({
    queryKey: ['messages', 'summary'],
    queryFn: () => api<MessageSummary>('/messages/summary'),
    staleTime: 10_000,
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

/** Statuses of an input that still needs the person: running, ready to review or failed (UD-025). */
export const TRAY_STATUSES = ['queued', 'extracting', 'analyzing', 'proposed', 'failed'] as const

/** My inputs in the tray: oldest first, so the ones that arrived first are reviewed first. */
export function useTray(enabled = true) {
  return useQuery({
    queryKey: ['inputs', 'tray'],
    queryFn: async () => {
      const list = unwrapList<InputRecord>(await api(`/inputs?mine=1&status=${TRAY_STATUSES.join(',')}`))
      return [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))
    },
    enabled,
  })
}

/**
 * Every send of mine, newest first, whatever its state (UD-070): the history the drawer of Inicio lists. The ones I discarded are not part of it.
 * It is the same list the tray was, now also with what was published.
 */
export function useSends(enabled = true) {
  return useQuery({
    queryKey: ['inputs', 'history'],
    queryFn: async () => unwrapList<InputRecord>(await api('/inputs?mine=1&order=desc')).filter((i) => i.status !== 'cancelled'),
    enabled,
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
      api<{ message_ids?: string[] }>(`/inputs/${v.inputId}/publish`, { method: 'POST', body: v.proposal }),
    onSuccess: () => invalidate('messages', 'areas', 'inputs'),
  })
}

/** Saves the proposal draft (PATCH /inputs/:id/proposal): what was edited survives closing the tab. */
export function useSaveProposal(inputId: string) {
  return useMutation({
    mutationFn: (proposal: Proposal) => api<Proposal>(`/inputs/${inputId}/proposal`, { method: 'PATCH', body: proposal }),
  })
}

/** Changes the text of the submitted input (PATCH /inputs/:id). */
export function useSaveInputText(inputId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (text: string) => api<InputRecord>(`/inputs/${inputId}`, { method: 'PATCH', body: { text } }),
    onSuccess: (saved) => qc.setQueryData(['inputs', inputId], (old: InputRecord | undefined) => (old ? { ...old, text: saved.text ?? old.text } : old)),
  })
}

/** Requeues the analysis of an input that failed; keeps the text and the extractions (POST /inputs/:id/reprocess). */
export function useReprocess() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (inputId: string) => api<{ input_id: string; job_id: string }>(`/inputs/${inputId}/reprocess`, { method: 'POST' }),
    onSuccess: () => invalidate('inputs'),
  })
}

/** Undoes a discard (POST /inputs/:id/restore): the send comes back with the proposal and the edits it had. */
export function useRestoreInput() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (inputId: string) => api<{ input_id: string; status: string }>(`/inputs/${inputId}/restore`, { method: 'POST' }),
    onSuccess: () => invalidate('inputs'),
  })
}

/** Deletes a send for real (DELETE /inputs/:id?confirm=true, UD-240): its attachments, jobs and proposal; with `withMessages`, the messages it published too. */
export function useDeleteInput() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: { id: string; withMessages: boolean }) =>
      api<{ input_id: string; deleted: { attachments: number; jobs: number; messages: number }; freed_bytes: number }>(`/inputs/${v.id}?confirm=true${v.withMessages ? '&with_messages=true' : ''}`, { method: 'DELETE' }),
    onSuccess: () => invalidate('inputs', 'messages', 'areas'),
  })
}

export function useCancelInput() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (inputId: string) => api(`/inputs/${inputId}/cancel`, { method: 'POST' }),
    onSuccess: () => invalidate('inputs'),
  })
}

/** Replies; with files, the submit is multipart (POST /messages/:id/replies with `files` and `links`). */
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

/** In-place edit of a published message (PATCH /messages/:id). Returns the saved message. */
/**
 * Edits a published message (UD-071). The request carries the `version` that was read: the one in the cache, so an edit that follows another
 * (an undo, the next field) uses the version the previous one left. If another edit got in first the server answers 409 `edit_conflict`
 * with the current version: the message is read again and the same change goes once more, so the person never sees the conflict for
 * a change in a different field.
 */
export function usePatchMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; patch: MessagePatch }) => {
      const read = () => (qc.getQueryData(['message', v.id]) as MessageDetail | undefined)?.version
      const send = (version: number | undefined) => api<MessageDetail>(`/messages/${v.id}`, { method: 'PATCH', body: { ...v.patch, version } })
      try {
        return await send(read() ?? (await api<MessageDetail>(`/messages/${v.id}`)).version)
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'edit_conflict') throw err
        const fresh = await api<MessageDetail>(`/messages/${v.id}`)
        qc.setQueryData(['message', v.id], fresh)
        return send(fresh.version)
      }
    },
    onSuccess: (saved, v) => {
      qc.setQueryData(['message', v.id], (old: MessageDetail | undefined) => (old ? { ...old, ...saved, replies: saved.replies ?? old.replies } : saved))
      void qc.invalidateQueries({ queryKey: ['messages'] })
      void qc.invalidateQueries({ queryKey: ['areas'] })
      void qc.invalidateQueries({ queryKey: ['inputs'] })
    },
  })
}

/** New files and links on a published message (UD-071): they go at the end and count as an edit, with the version that was read. */
export function useAddAttachments() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; files: File[]; links?: string[] }) => {
      const send = (version: number | undefined) => {
        const form = new FormData()
        form.append('version', String(version))
        for (const f of v.files) form.append('files', f)
        for (const l of v.links ?? []) form.append('links', l)
        return api<MessageDetail>(`/messages/${v.id}/attachments`, { method: 'POST', form })
      }
      const read = () => (qc.getQueryData(['message', v.id]) as MessageDetail | undefined)?.version
      try {
        return await send(read() ?? (await api<MessageDetail>(`/messages/${v.id}`)).version)
      } catch (err) {
        if (!(err instanceof ApiError) || err.code !== 'edit_conflict') throw err
        const fresh = await api<MessageDetail>(`/messages/${v.id}`)
        qc.setQueryData(['message', v.id], fresh)
        return send(fresh.version)
      }
    },
    onSuccess: (saved, v) => {
      qc.setQueryData(['message', v.id], (old: MessageDetail | undefined) => (old ? { ...old, ...saved, replies: saved.replies ?? old.replies } : saved))
      void qc.invalidateQueries({ queryKey: ['messages'] })
      void qc.invalidateQueries({ queryKey: ['inputs'] })
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

/** Soft-deletes a message (DELETE /messages/:id?confirm=true, UD-240): its sender or the Editor; Deshacer restores it. */
export function useDeleteMessage() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (id: string) => api(`/messages/${id}?confirm=true`, { method: 'DELETE' }),
    onSuccess: () => invalidate('messages', 'message', 'areas', 'inputs'),
  })
}

/** Restores a deleted message (POST /messages/:id/restore): it is what undoes a deletion. */
export function useRestoreMessage() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (id: string) => api<MessageDetail>(`/messages/${id}/restore`, { method: 'POST' }),
    onSuccess: () => invalidate('messages', 'message', 'areas', 'inputs'),
  })
}

/** Soft-deletes a reply (DELETE /messages/:id/replies/:replyId?confirm=true, UD-240): its author or the Editor. Returns the message with its thread. */
export function useDeleteReply(messageId: string) {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (replyId: string) => api<MessageDetail>(`/messages/${messageId}/replies/${replyId}?confirm=true`, { method: 'DELETE' }),
    onSuccess: () => invalidate('message', 'messages', 'areas'),
  })
}

/** Restores a deleted reply (POST /replies/:id/restore): it is what undoes a deletion. */
export function useRestoreReply() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (replyId: string) => api<MessageDetail>(`/replies/${replyId}/restore`, { method: 'POST' }),
    onSuccess: () => invalidate('message', 'messages', 'areas'),
  })
}

export function useSaveArea() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: { id?: string; title?: string; description?: string; color?: string }) =>
      v.id
        ? api(`/areas/${v.id}`, { method: 'PATCH', body: { title: v.title, description: v.description, color: v.color } })
        : api('/areas', { method: 'POST', body: { title: v.title, description: v.description, color: v.color } }),
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

/** Restores a deleted template (POST /templates/:id/restore): it is what undoes a deletion. */
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
      patch: Partial<Pick<Member, 'profile' | 'role' | 'name' | 'email' | 'active'>> & { language?: Language; current_password?: string; new_password?: string }
    }) => api<Member>(v.self ? '/members/me' : `/members/${v.id}`, { method: 'PATCH', body: v.patch }),
    onSuccess: () => invalidate('members', 'me'),
  })
}

/** Deleting a member for good (DELETE /members/:id, Editor only, UD-240). `purge` takes their history too; without it a member with history is a 409 `member_has_history`. */
export function useDeleteMember() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: { id: string; purge?: boolean }) => api<{ member_id: string; deleted: { inputs: number; messages: number; replies: number } }>(`/members/${v.id}?confirm=true${v.purge ? '&purge=true' : ''}`, { method: 'DELETE' }),
    onSuccess: () => invalidate('members', 'messages', 'message', 'inputs'),
  })
}

/** Adding a member (POST /members, Editor only). */
export function useCreateMember() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (v: NewMember) => api<Member>('/members', { method: 'POST', body: v }),
    onSuccess: () => invalidate('members'),
  })
}

/** The account language changes the interface instantly: it is written into `me` before the server answers. */
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
    // The server tests the combination before it applies it: a failure (422 provider_check_failed) leaves the previous setting.
    mutationFn: (v: Pick<ProviderSetting, 'slot'> & Partial<Pick<ProviderSetting, 'provider' | 'model' | 'base_url'>>) => {
      const body: Record<string, unknown> = { slot: v.slot }
      if (v.provider !== undefined) body.provider = v.provider
      if (v.model !== undefined) body.model = v.model
      if (v.base_url !== undefined) body.base_url = v.base_url
      return api('/settings/providers', { method: 'PATCH', body })
    },
    onSuccess: () => invalidate('providers', 'connections'),
  })
}

/** Providers with the state of their keys, and the presets that can be added (Editor only). */
export function useConnections(enabled = true) {
  return useQuery({
    queryKey: ['connections'],
    queryFn: () => api<ConnectionsView>('/settings/connections'),
    enabled,
  })
}

/** The result of a test, kept per connection so the model field can offer the models the provider listed. */
export function useRememberedModels(name: string | null | undefined): string[] {
  // Never fetched (disabled): the data is whatever the tests wrote with setQueryData.
  return useQuery({ queryKey: ['models', name ?? ''], queryFn: () => [] as string[], enabled: false }).data ?? []
}

function useRememberCheck() {
  const qc = useQueryClient()
  return (name: string, check: Check | undefined) => {
    if (check?.models?.length) qc.setQueryData(['models', name], check.models)
  }
}

const connectionPath = (name: string) => `/settings/connections/${encodeURIComponent(name)}`

export interface ConnectionResult {
  connection: Connection
  check: Check
}

/** Adds a provider with its key; the server tests first and saves nothing when the test fails. */
export function useAddConnection() {
  const invalidate = useInvalidator()
  const remember = useRememberCheck()
  return useMutation({
    // The body carries the key: the mutation leaves the cache as soon as nothing watches it.
    gcTime: 0,
    mutationFn: (v: NewConnection) => api<ConnectionResult>('/settings/connections', { method: 'POST', body: v }),
    onSuccess: (r) => {
      remember(r.connection.name, r.check)
      return invalidate('connections', 'providers')
    },
  })
}

/** Replaces a key: tested first, applied only if it works; otherwise the previous key stays. */
export function useReplaceKey() {
  const invalidate = useInvalidator()
  const remember = useRememberCheck()
  return useMutation({
    gcTime: 0,
    mutationFn: (v: { name: string; api_key: string; model?: string }) => api<ConnectionResult>(`${connectionPath(v.name)}/key`, { method: 'PUT', body: { api_key: v.api_key, ...(v.model ? { model: v.model } : {}) } }),
    onSuccess: (r) => {
      remember(r.connection.name, r.check)
      return invalidate('connections', 'providers')
    },
  })
}

export function useRetireKey() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (name: string) => api<{ connection: Connection }>(`${connectionPath(name)}/key`, { method: 'DELETE' }),
    onSuccess: () => invalidate('connections', 'providers'),
  })
}

export function useDeleteConnection() {
  const invalidate = useInvalidator()
  return useMutation({
    mutationFn: (name: string) => api<{ deleted: boolean }>(connectionPath(name), { method: 'DELETE' }),
    onSuccess: () => invalidate('connections', 'providers'),
  })
}

/** Diagnosis of one provider (always answers 200; the body says whether it worked). */
export function useCheckConnection() {
  const invalidate = useInvalidator()
  const remember = useRememberCheck()
  return useMutation({
    mutationFn: (v: { name: string; model?: string }) => api<{ check: Check }>(`${connectionPath(v.name)}/check`, { method: 'POST', body: v.model ? { model: v.model } : {} }).then((r) => ({ ...r, name: v.name })),
    onSuccess: (r) => {
      remember(r.name, r.check)
      return invalidate('connections', 'providers')
    },
  })
}

/** Diagnosis of one function: the provider and the model it uses now. */
export function useCheckSlot() {
  const invalidate = useInvalidator()
  const remember = useRememberCheck()
  return useMutation({
    mutationFn: (slot: ProviderSlot) => api<{ check: Check; slot: ProviderSlot; provider: string; model: string }>(`/settings/providers/${slot}/check`, { method: 'POST', body: {} }),
    onSuccess: (r) => {
      remember(r.provider, r.check)
      return invalidate('connections', 'providers')
    },
  })
}

/** Project description (UD-024): the whole team sees it and only the Editor changes it. */
export interface Project {
  /** Cap of characters (PROJECT_DESCRIPTION_MAX_CHARS); a server that does not send it leaves the counter without a cap. */
  max_chars?: number
  name: string
  description: string
}

export function useProject() {
  return useQuery({
    queryKey: ['project'],
    queryFn: () => api<Project>('/settings/project'),
    staleTime: 60_000,
  })
}

/** Changes the description with text (in-place edit) or with a `.md` file (multipart `file`). */
export function useSaveProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { description: string } | { file: File }) => {
      if ('file' in v) {
        const form = new FormData()
        form.append('file', v.file, v.file.name)
        return api<Project>('/settings/project', { method: 'PATCH', form })
      }
      return api<Project>('/settings/project', { method: 'PATCH', body: { description: v.description } })
    },
    onSuccess: (saved) => qc.setQueryData(['project'], saved),
  })
}
