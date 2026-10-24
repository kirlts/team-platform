// Every operation of the API an interface calls, as a function. Grouped by what they touch; each one builds the request
// the panel always built (same paths, same bodies, same query strings) and returns what the server answers, typed.
import { applyClientFilters, messagesQueryString, type MessageQuery } from './filters.js'
import type { Transport } from './http.js'
import { unwrapList } from './lists.js'
import { attachmentsForm, inputForm, projectFileForm, replyForm, replyHasMedia } from './multipart.js'
import { routes } from './routes.js'
import { uploadInput } from './upload.js'
import { sendVersioned, type Versioning } from './versioning.js'
import type {
  Area,
  AnalysisSettings,
  AuditEntry,
  Check,
  Connection,
  ConnectionResult,
  ConnectionsView,
  CreatedInput,
  DeleteInputResult,
  DeleteMemberResult,
  ExecuteRun,
  ExecuteRunsFilter,
  ExecuteRunsSummary,
  InputRecord,
  JobState,
  JobTrace,
  Language,
  Me,
  Member,
  MemberPatch,
  Message,
  MessageDetail,
  MessagePatch,
  MessageSummary,
  MessageTiming,
  NewConnection,
  NewInput,
  NewMember,
  NewReply,
  Paged,
  Project,
  Proposal,
  ProviderSetting,
  ProviderSlot,
  PurgeState,
  ResetResult,
  ResetScope,
  QueueInput,
  ReprocessResult,
  RunningJob,
  Template,
  UiSummary,
} from './types.js'

/** Statuses of an input that still needs the person: running, ready to review or failed (UD-025). */
export const TRAY_STATUSES = ['queued', 'extracting', 'analyzing', 'proposed', 'failed'] as const

export interface MessagesQuery {
  query: MessageQuery
  meId: string
  /** Only messages with replies, ordered by the latest (Inicio). */
  repliesFeed?: boolean
}

export interface AreaFields {
  id?: string
  title?: string
  description?: string
  color?: string
  /** Who decides in the area (UD-269); `null` goes back to the first active Editor. */
  escalation_member_id?: string | null
}

export interface TemplateFields {
  id?: string
  name?: string
  description?: string
  body_markdown?: string
}

export type ProviderChange = Pick<ProviderSetting, 'slot'> & Partial<Pick<ProviderSetting, 'provider' | 'model' | 'base_url'>>

const CONFIRM = 'confirm=true'

export function createResources(t: Transport) {
  const call = t.call

  const messageDetail = (id: string) => call<MessageDetail>(routes.messageGet, { params: { id } })

  return {
    // ------------------------------------------------------------ Session
    auth: {
      login: (v: { email: string; password: string }) => call(routes.login, { body: v }),
      /** Closes the session of our own; the host's own sign-out (`logout_url`, H-3720) comes back when it has one. */
      logout: () => call<{ logout_url?: string } | undefined>(routes.logout),
    },
    me: {
      get: () => call<Me>(routes.me),
    },
    health: () => call<Record<string, unknown>>(routes.health),

    // ------------------------------------------------------------ Team
    members: {
      list: async () => unwrapList<Member>(await call(routes.memberList)),
      create: (v: NewMember) => call<Member>(routes.memberCreate, { body: v }),
      /** `self` changes the account of the session (`/members/me`); otherwise the member `id` (Editor). */
      save: (v: { id: string; self: boolean; patch: MemberPatch }) =>
        v.self ? call<Member>(routes.memberPatchSelf, { body: v.patch }) : call<Member>(routes.memberPatch, { params: { id: v.id }, body: v.patch }),
      saveLanguage: (language: Language) => call<Member>(routes.memberPatchSelf, { body: { language } }),
      /** Another member's password (Editor): it closes that person's sessions. */
      setPassword: (v: { id: string; password: string }) => call<Member>(routes.memberPatch, { params: { id: v.id }, body: { password: v.password } }),
      /** Deleting for good (Editor, UD-240). `purge` takes their history too; without it a member with history is a 409 `member_has_history`. */
      delete: (v: { id: string; purge?: boolean }) =>
        call<DeleteMemberResult>(routes.memberDelete, { params: { id: v.id }, search: `${CONFIRM}${v.purge ? '&purge=true' : ''}` }),
    },

    // ------------------------------------------------------------ Areas and templates
    areas: {
      /** Sorted by `position`. */
      list: async () => {
        const list = unwrapList<Area>(await call(routes.areaList))
        return [...list].sort((a, b) => a.position - b.position)
      },
      /** The deleted ones (Editor). */
      listDeleted: async () => unwrapList<Area>(await call(routes.areaList, { search: 'include_deleted=true' })).filter((a) => a.deleted_at),
      /** Creates the area, or edits `id` when it is given. */
      save: (v: AreaFields) =>
        v.id
          ? call<Area>(routes.areaPatch, { params: { id: v.id }, body: { title: v.title, description: v.description, color: v.color, escalation_member_id: v.escalation_member_id } })
          : call<Area>(routes.areaCreate, { body: { title: v.title, description: v.description, color: v.color } }),
      /** Soft-deletes (Editor, UD-240): its messages stay and a restore brings it back. */
      delete: (id: string) => call(routes.areaDelete, { params: { id }, search: CONFIRM }),
      restore: (id: string) => call<Area>(routes.areaRestore, { params: { id } }),
      /** One DELETE each, in parallel: an Editor may delete every area, so there is no permission to split. */
      deleteMany: (ids: readonly string[]) => Promise.all(ids.map((id) => call(routes.areaDelete, { params: { id }, search: CONFIRM }))),
      restoreMany: (ids: readonly string[]) => Promise.all(ids.map((id) => call(routes.areaRestore, { params: { id } }))),
    },
    templates: {
      list: async (areaId: string) => unwrapList<Template>(await call(routes.templateList, { params: { id: areaId } })),
      listDeleted: async (areaId: string) =>
        unwrapList<Template>(await call(routes.templateList, { params: { id: areaId }, search: 'include_deleted=true' })).filter((x) => x.deleted_at),
      /** Creates the template, or edits `id` when it is given. */
      save: (areaId: string, v: TemplateFields) => {
        const { id, ...fields } = v
        return id
          ? call(routes.templatePatch, { params: { id: areaId, templateId: id }, body: fields })
          : call(routes.templateCreate, { params: { id: areaId }, body: fields })
      },
      /** Every destructive operation requires explicit confirmation (MASTER-SPEC, API conventions). */
      delete: (areaId: string, id: string) => call(routes.templateDelete, { params: { id: areaId, templateId: id }, search: CONFIRM }),
      restore: (id: string) => call<Template>(routes.templateRestore, { params: { id } }),
      deleteMany: (areaId: string, ids: readonly string[]) =>
        Promise.all(ids.map((id) => call(routes.templateDelete, { params: { id: areaId, templateId: id }, search: CONFIRM }))),
      restoreMany: (ids: readonly string[]) => Promise.all(ids.map((id) => call(routes.templateRestore, { params: { id } }))),
    },

    // ------------------------------------------------------------ Messages
    messages: {
      /** Server filters plus the negations and «sin respuestas» that the server does not know, applied here. */
      list: async ({ query, meId, repliesFeed }: MessagesQuery) => {
        const qs = messagesQueryString(query, repliesFeed)
        const list = unwrapList<Message>(await call(routes.messageList, { search: qs }))
        return applyClientFilters(list, query, meId)
      },
      /** What affects the person and the pending of each area. */
      summary: () => call<MessageSummary>(routes.messageSummary),
      get: messageDetail,
      /**
       * Edits a published message (UD-071). The request carries the `version` that was read; on 409 `edit_conflict` the message is
       * read again and the same change goes once more (see `sendVersioned`). Returns the saved message.
       */
      patch: (id: string, patch: MessagePatch, versioning: Versioning<MessageDetail> = {}) =>
        sendVersioned<MessageDetail, MessageDetail>({
          ...versioning,
          fetchCurrent: () => messageDetail(id),
          versionOf: (d) => d?.version,
          send: (version) => call<MessageDetail>(routes.messagePatch, { params: { id }, body: { ...patch, version } }),
        }),
      /** New files and links on a published message (UD-071): they go at the end and count as an edit, with the version that was read. */
      addAttachments: (id: string, v: { files: File[]; links?: string[] }, versioning: Versioning<MessageDetail> = {}) =>
        sendVersioned<MessageDetail, MessageDetail>({
          ...versioning,
          fetchCurrent: () => messageDetail(id),
          versionOf: (d) => d?.version,
          send: (version) => call<MessageDetail>(routes.messageAddAttachments, { params: { id }, form: attachmentsForm(version, v.files, v.links) }),
        }),
      close: (id: string) => call(routes.messageClose, { params: { id } }),
      reopen: (id: string) => call(routes.messageReopen, { params: { id } }),
      setClosed: (v: { id: string; closed: boolean }) => call(v.closed ? routes.messageClose : routes.messageReopen, { params: { id: v.id } }),
      /** Soft-deletes (UD-240): its sender or the Editor; a restore undoes it. */
      delete: (id: string) => call(routes.messageDelete, { params: { id }, search: CONFIRM }),
      restore: (id: string) => call<MessageDetail>(routes.messageRestore, { params: { id } }),
      /** Several in one request: all or none, 403 with the ids that are not the person's (UD-253, H-3715). */
      deleteMany: (ids: readonly string[]) => call<{ ids: string[] }>(routes.messageDeleteMany, { search: CONFIRM, body: { ids } }),
      restoreMany: (ids: readonly string[]) => call<{ ids: string[] }>(routes.messageRestoreMany, { body: { ids } }),
      /** Where the time of the execution of a message went. A 404 means it has no execution. */
      timing: (id: string) => call<MessageTiming>(routes.messageTiming, { params: { id } }),
      /** Queues the `execute` job of a message (Editor). */
      execute: (id: string) => call<Record<string, unknown>>(routes.messageExecute, { params: { id } }),
      /** Forwards the message to a member with the reason (UD-272): the same message, one more assignee and a notice in the thread; with an agent, its `execute` job. */
      forward: (id: string, v: { member_id: string; comment: string }) => call<MessageDetail>(routes.messageForward, { params: { id }, body: { member_id: v.member_id, comment: v.comment } }),
      /** Queues the delivery of the branch an `execute` job left (Editor; UD-263). */
      deliver: (id: string) => call<Record<string, unknown>>(routes.messageDeliver, { params: { id } }),
    },
    replies: {
      /** JSON, or multipart when there are files or links. */
      create: (messageId: string, reply: NewReply) =>
        replyHasMedia(reply)
          ? call(routes.replyCreate, { params: { id: messageId }, form: replyForm(reply) })
          : call(routes.replyCreate, { params: { id: messageId }, body: { body: reply.body, kind: reply.kind, ...(reply.mention_ids?.length ? { mention_ids: reply.mention_ids } : {}) } }),
      /**
       * Edits the text of a reply, only by its author (UD-253, H-3714). It sends the version read in the thread; on `edit_conflict`
       * it reads the thread again and retries once with the current version. Returns the message with its thread.
       */
      edit: (messageId: string, replyId: string, body: string | undefined, versioning: Versioning<MessageDetail> = {}, more: { mention_ids?: string[]; remove_attachment_ids?: string[] } = {}) =>
        sendVersioned<MessageDetail, MessageDetail>({
          ...versioning,
          fetchCurrent: () => messageDetail(messageId),
          versionOf: (d) => d?.replies.find((r) => r.id === replyId)?.version,
          // UD-277: the same edit also takes attachments off and adds mentions; `body` may be absent.
          send: (version) => call<MessageDetail>(routes.replyEdit, { params: { id: messageId, replyId }, body: { ...(body === undefined ? {} : { body }), ...more, version } }),
        }),
      /** New files and links on a reply of mine (UD-277); like the ones of a message they count as an edit, with the version that was read. */
      addAttachments: (messageId: string, replyId: string, v: { files: File[]; links?: string[] }, versioning: Versioning<MessageDetail> = {}) =>
        sendVersioned<MessageDetail, MessageDetail>({
          ...versioning,
          fetchCurrent: () => messageDetail(messageId),
          versionOf: (d) => d?.replies.find((r) => r.id === replyId)?.version,
          send: (version) => call<MessageDetail>(routes.replyAddAttachments, { params: { id: messageId, replyId }, form: attachmentsForm(version, v.files, v.links) }),
        }),
      /** The text read from the audio or video of a reply (UD-277). A 404 means it has none (yet). */
      transcript: (id: string) => call<{ text?: string }>(routes.replyAttachmentTranscript, { params: { id } }),
      /** Soft-deletes (UD-240): its author or the Editor. Returns the message with its thread. */
      delete: (messageId: string, replyId: string) => call<MessageDetail>(routes.replyDelete, { params: { id: messageId, replyId }, search: CONFIRM }),
      restore: (replyId: string) => call<MessageDetail>(routes.replyRestore, { params: { id: replyId } }),
    },

    // ------------------------------------------------------------ Inputs (sends)
    inputs: {
      get: (id: string) => call<InputRecord>(routes.inputGet, { params: { id } }),
      /** My inputs in the tray: oldest first, so the ones that arrived first are reviewed first. */
      tray: async () => {
        const list = unwrapList<InputRecord>(await call(routes.inputList, { search: `mine=1&compact=1&status=${TRAY_STATUSES.join(',')}` }))
        return [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))
      },
      /** Every send of mine, newest first, whatever its state (UD-070); the ones I discarded are not part of it. */
      history: async () => unwrapList<InputRecord>(await call(routes.inputList, { search: 'mine=1&order=desc&compact=1' })).filter((i) => i.status !== 'cancelled'),
      /** The sends of everybody (Editor), newest first, one server page. */
      queue: (page: number, limit: number) => call<Paged<QueueInput>>(routes.inputList, { search: `all=1&page=${page}&limit=${limit}` }),
      /** Sends the input as multipart without progress (a server, a script). Idempotent by content hash (MASTER-SPEC §1.3). */
      create: (input: NewInput, signal?: AbortSignal) => call<CreatedInput>(routes.inputCreate, { form: inputForm(input), signal }),
      /** Sends the input with upload progress (XMLHttpRequest, so it needs a browser or an `xhr` factory). */
      upload: (input: NewInput, onProgress: (fraction: number) => void, signal?: AbortSignal) => uploadInput(t, input, onProgress, signal),
      publish: (inputId: string, proposal: Proposal) => call<{ message_ids?: string[] }>(routes.inputPublish, { params: { id: inputId }, body: proposal }),
      /** Saves the proposal draft: what was edited survives closing the tab. */
      saveProposal: (inputId: string, proposal: Proposal) => call<Proposal>(routes.inputSaveProposal, { params: { id: inputId }, body: proposal }),
      /** Changes the text of the submitted input. */
      saveText: (inputId: string, text: string) => call<InputRecord>(routes.inputSaveText, { params: { id: inputId }, body: { text } }),
      /** Requeues the analysis; keeps the text and the extractions. Published: the Editor only, its messages go to the trash. */
      reprocess: (inputId: string) => call<ReprocessResult>(routes.inputReprocess, { params: { id: inputId } }),
      /** Undoes a discard: the send comes back with the proposal and the edits it had. */
      restore: (inputId: string) => call<{ input_id: string; status: string }>(routes.inputRestore, { params: { id: inputId } }),
      /** Deletes for real (UD-240): attachments, jobs and proposal; with `withMessages`, the messages it published too. */
      delete: (v: { id: string; withMessages: boolean }) =>
        call<DeleteInputResult>(routes.inputDelete, { params: { id: v.id }, search: `${CONFIRM}${v.withMessages ? '&with_messages=true' : ''}` }),
      cancel: (inputId: string) => call(routes.inputCancel, { params: { id: inputId } }),
    },

    // ------------------------------------------------------------ Providers
    providers: {
      list: async () => unwrapList<ProviderSetting>(await call(routes.providerList)),
      /** The server tests the combination before it applies it: a failure (422 `provider_check_failed`) leaves the previous setting. */
      save: (v: ProviderChange) => {
        const body: Record<string, unknown> = { slot: v.slot }
        if (v.provider !== undefined) body.provider = v.provider
        if (v.model !== undefined) body.model = v.model
        if (v.base_url !== undefined) body.base_url = v.base_url
        return call(routes.providerSave, { body })
      },
      /** Diagnosis of one function: the provider and the model it uses now. */
      check: (slot: ProviderSlot) => call<{ check: Check; slot: ProviderSlot; provider: string; model: string }>(routes.providerCheck, { params: { slot }, body: {} }),
    },
    connections: {
      /** Providers with the state of their keys, and the presets that can be added (Editor). */
      list: () => call<ConnectionsView>(routes.connectionList),
      /** Adds a provider with its key; the server tests first and saves nothing when the test fails. */
      add: (v: NewConnection) => call<ConnectionResult>(routes.connectionAdd, { body: v }),
      /** Replaces a key: tested first, applied only if it works; otherwise the previous key stays. */
      replaceKey: (v: { name: string; api_key: string; model?: string }) =>
        call<ConnectionResult>(routes.connectionReplaceKey, { params: { name: v.name }, body: { api_key: v.api_key, ...(v.model ? { model: v.model } : {}) } }),
      retireKey: (name: string) => call<{ connection: Connection }>(routes.connectionRetireKey, { params: { name } }),
      delete: (name: string) => call<{ deleted: boolean }>(routes.connectionDelete, { params: { name } }),
      /** Diagnosis of one provider (always answers 200; the body says whether it worked). */
      check: async (v: { name: string; model?: string }) => {
        const r = await call<{ check: Check }>(routes.connectionCheck, { params: { name: v.name }, body: v.model ? { model: v.model } : {} })
        return { ...r, name: v.name }
      },
    },

    // ------------------------------------------------------------ Settings
    project: {
      get: () => call<Project>(routes.projectGet),
      /** Changes the description with text (in-place edit) or with a `.md` file (multipart `file`). */
      save: (v: { description: string } | { file: File }) =>
        'file' in v ? call<Project>(routes.projectPatch, { form: projectFileForm(v.file) }) : call<Project>(routes.projectPatch, { body: { description: v.description } }),
      /** Saves the project name (empty goes back to PROJECT_NAME). */
      saveName: (name: string) => call<Project>(routes.projectPatch, { body: { name } }),
    },
    analysis: {
      get: () => call<AnalysisSettings>(routes.analysisGet),
      /** Saves the framing of one or both languages; an empty text goes back to the default. */
      saveFraming: (framing: Partial<Record<Language, string>>) => call<AnalysisSettings>(routes.analysisPatch, { body: { framing } }),
    },
    publication: {
      get: () => call<{ auto_publish: boolean }>(routes.publicationGet),
      save: (autoPublish: boolean) => call<{ auto_publish: boolean }>(routes.publicationPatch, { body: { auto_publish: autoPublish } }),
    },
    telemetry: {
      /** Turns interface telemetry on or off (Editor). */
      setUiEnabled: (enabled: boolean) => call(routes.telemetryPatch, { body: { ui_enabled: enabled } }),
      /** Summary of how the interface is used (Editor). */
      uiSummary: () => call<UiSummary>(routes.telemetryUiSummary),
      /** Sends a batch of interface events, as an object or as the JSON text already built. `keepalive` lets it outlive the page. */
      sendUi: (batch: object | string, options: { keepalive?: boolean } = {}) =>
        call(routes.telemetrySendUi, typeof batch === 'string' ? { json: batch, keepalive: options.keepalive } : { body: batch, keepalive: options.keepalive }),
    },

    // ------------------------------------------------------------ Operations (Editor)
    jobs: {
      list: (state: JobState, options: { page?: number; limit?: number } = {}) =>
        call<Paged<unknown>>(routes.jobList, { search: `state=${state}${options.page ? `&page=${options.page}` : ''}&limit=${options.limit ?? 1}` }),
      /** The `execute` jobs that are running now, with their phase. */
      runningExecutions: async () => (await call<Paged<RunningJob>>(routes.jobList, { search: 'state=running&limit=50' })).items.filter((j) => j.kind === 'execute' || j.kind === 'deliver'),
      trace: (jobId: string) => call<JobTrace>(routes.jobTrace, { params: { id: jobId } }),
      purge: (state: PurgeState) => call<{ purged: number }>(routes.jobPurge, { search: `state=${state}&${CONFIRM}` }),
    },
    audit: {
      list: (page: number, limit: number, action = '') =>
        call<Paged<AuditEntry>>(routes.auditList, { search: `page=${page}&limit=${limit}${action ? `&action=${encodeURIComponent(action)}` : ''}` }),
    },
    ops: {
      /** History of the execute runs, newest first (Editor). */
      executeRuns: (filter: ExecuteRunsFilter = {}) => {
        const params = new URLSearchParams()
        for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== '') params.set(key, String(value))
        return call<Paged<ExecuteRun>>(routes.opsExecuteRuns, { search: params.toString() })
      },
      /** Figures of the execute runs of the last `days` days (0 = all of them), counted in local days like the panel's period selector. */
      executeRunsSummary: (days: number) => {
        const since = days > 0 ? new Date(Date.now() - days * 24 * 3600 * 1000) : null
        const p = (n: number) => String(n).padStart(2, '0')
        const search = since ? `since=${since.getFullYear()}-${p(since.getMonth() + 1)}-${p(since.getDate())}` : ''
        return call<ExecuteRunsSummary>(routes.opsExecuteRunsSummary, { search })
      },
      /** Loads the sample set of `ejemplos/`: the inputs enter the tray and go through the real analysis. */
      seed: () => call<{ created: number; existing: number }>(routes.opsSeed, { search: CONFIRM }),
      reset: (scope: ResetScope) => call<ResetResult>(routes.opsReset, { search: CONFIRM, body: { scope } }),
    },
    attachments: {
      /** The text the server extracted from an audio or a video (`GET /attachments/:id/transcript`). */
      transcript: (id: string) => call<{ text?: string }>(routes.attachmentTranscript, { params: { id } }),
    },
  }
}

export type TeamResources = ReturnType<typeof createResources>
