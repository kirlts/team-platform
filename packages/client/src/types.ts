// Types of what the API returns (MASTER-SPEC §7.1 and §7.2). Field names
// are the tables' own. Where the specification does not fix the shape of the
// response, the assumption is noted and the development double server meets it.

export type Role = 'member' | 'editor'
/** Account language (UD-018): governs the interface, the messages that are drafted and the prompts. */
export type Language = 'es-419' | 'en'

export interface Member {
  id: string
  email: string
  name: string
  role: Role
  /** Profile in prose (UD-023): a couple of paragraphs in the first person written by the person themselves; up to 4,000 characters. */
  profile: string
  language: Language
  /** A deactivated account does not sign in and keeps its history; only the Editor deactivates or reactivates it. */
  active: boolean
  /** `agent`: worked by an unattended Claude Code session (UD-254). */
  kind?: 'person' | 'agent'
  /** Only the author «Miembro eliminado» (UD-292): it keeps what a deleted member published and is not listed in Equipo. */
  removed?: boolean
}

/** Response of GET /me: the member and the project name (assumption: `project_name`). */
export interface Me extends Member {
  /** Identity sources of the server, comma-separated: `local` or `delegated:<mode>` (H-2605, H-3720). */
  provider?: string
  /** Where the identity of this request came from: `session` or the host source (H-3720). */
  source?: string
  /** The host declares this member's role; the Editor cannot change it (H-3720). */
  role_managed_externally?: boolean
  /** The host's own sign-out (LOGOUT_URL), or null. */
  logout_url?: string | null
  project_name?: string
  /** Shortest password the server accepts (PASSWORD_MIN_LENGTH). */
  password_min_length?: number
  /** Interface telemetry (UD-091): the owner's switch and the largest batch the server accepts. */
  ui_telemetry?: { enabled: boolean; max_events: number }
}

export interface Area {
  id: string
  title: string
  description: string
  position: number
  /** Color of the area, `#rrggbb` (UD-045). */
  color?: string
  /** Assumption: GET /areas brings the area's count of open messages. */
  open_count?: number
  /** Open and answered: what is still pending. It is the number the sidebar carries. */
  unresolved_count?: number
  template_count?: number
  /** The person who decides in the area and receives what a session hands over (UD-269): the one set, or the first active Editor. */
  escalation_member_id?: string | null
  /** Handoffs to a person in the last 7 days, by person (UD-269). */
  handoffs?: { member_id: string; count: number }[]
  deleted_at?: string | null
}

export interface Template {
  id: string
  area_id: string
  name: string
  description: string
  body_markdown: string
  /** Minutes between two progress notices while Claude works on a message of this template; 0 turns them off (UD-293). */
  progress_interval_min?: number
  updated_at: string
  deleted_at?: string | null
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document' | 'link'

export interface Attachment {
  id: string
  input_id?: string
  kind: AttachmentKind
  mime?: string
  size?: number
  /** Original file name or address of the link. */
  name?: string
  /** The server extracted text from it (audio and video: the transcript, served at `GET /attachments/:id/transcript`). */
  extracted?: boolean
}

export type InputStatus =
  | 'queued'
  | 'extracting'
  | 'analyzing'
  | 'proposed'
  | 'published'
  | 'failed'
  | 'cancelled'

export interface ProposalMessage {
  area_id: string
  template_id: string | null
  title: string
  body: string
  /** Value of each template field, by its name. */
  fields?: Record<string, string | null> | null
  assignee_ids: string[]
  attachment_ids: string[]
  /** Units of the input this message covers (the system numbers them). */
  unit_ids: number[]
  /** What a video frame shows and nobody says; outside the body. Absent in older proposals. */
  observed?: string[]
}

/** Units of the input the analysis left without a message, with the reason. */
export interface DiscardedUnits {
  unit_ids: number[]
  reason: string
}

export interface Proposal {
  messages: ProposalMessage[]
  discarded: DiscardedUnits[]
  /** Only the example server (`dev-server.mjs`) sets it: its proposal is a double, not an analysis. The real API never sends it. */
  simulated?: boolean
}

/** Assumption: the input brings its units numbered with the text, to show what was discarded. */
export interface InputUnit {
  id: number
  text: string
}

export interface InputRecord {
  id: string
  author_id: string
  /** Members the send is addressed to (UD-291); empty when the automatic routing assigned. */
  recipient_ids?: string[]
  text: string
  status: InputStatus
  created_at: string
  job_id?: string
  attachments: Attachment[]
  units?: InputUnit[]
  proposal?: Proposal | null
  /** Visible reason when status is `failed`. */
  error?: string | null
  /** Stable code of the failure; the panel translates it to its catalog. */
  error_code?: string | null
  /** State of the job, when the API sends it with the input. */
  job?: { id: string; status: string; percent: number | null; phrase: string | null; code?: string | null; vars?: Record<string, number> } | null
  /** Count of proposed messages for the tray row; without it, the length of `proposal.messages`. */
  proposed_count?: number
  updated_at?: string
  /** The messages a published input produced, in order (UD-070). */
  message_ids?: string[]
  messages?: { id: string; title: string; area_id: string; status: MessageStatus; edited_at: string | null }[]
}

export type MessageStatus = 'open' | 'answered' | 'closed'
export type ReplyKind = 'answer' | 'fix' | 'clarification' | 'forward'

export interface Reply {
  id: string
  message_id: string
  author_id: string
  body: string
  kind: ReplyKind
  /** The member the message was forwarded to; only in a reply of kind `forward` (UD-272), whose `body` is the reason. */
  forwarded_to?: string | null
  /** The reply tells a failed `execute` job that `POST /messages/:id/replies/:replyId/retry` launches again (UD-282). */
  retryable?: boolean
  /** The job that retried this notice (UD-290): the notice stays, marked as replaced; the thread omits it once that job ended. */
  replaced_by_job_id?: string | null
  /** The job that retried the notice is still queued or running: the thread draws «Reintentando» in its place (UD-290). */
  retrying?: boolean
  /** The members the reply mentions, picked in the list of «@» (UD-278). */
  mentions?: string[]
  created_at: string
  /** Media types attached to the reply, to draw one icon per type (UD-016). */
  attachment_kinds?: AttachmentKind[]
  /** The attachments themselves (thumbnails); served at `GET /replies/attachments/:id`, a different id space from the message's. */
  attachments?: Attachment[]
  /** Grows with every edit by its author (UD-253); PATCH sends the one read. */
  version?: number
  /** Time of the last edit by its author; null while never edited (the thread shows «Editada»). */
  edited_at?: string | null
}

export interface Message {
  id: string
  input_id?: string
  area_id: string
  author_id: string
  /** Who had the session when the input was sent in the name of the author (UD-255); null when it is the author. */
  sent_by_id?: string | null
  title: string
  body: string
  status: MessageStatus
  created_at: string
  closed_at?: string | null
  /** Set while the message is deleted (UD-240): only the «Borrados» list carries such a message. */
  deleted_at?: string | null
  assignee_ids: string[]
  template_id?: string | null
  /** Value of each field of the message's template, by its name. */
  fields?: Record<string, string | null>
  attachments: Attachment[]
  /** Media types attached, to draw one icon per type (UD-016). */
  attachment_kinds?: AttachmentKind[]
  updated_at?: string
  /** Counter of real edits: the edit must carry the one that was read (UD-071). */
  version?: number
  /** When the sender last edited it; null when never (UD-071). */
  edited_at?: string | null
  edits?: { id: string; member_id: string; at: string; version: number; fields: string[] }[]
  /** List assumptions: number of replies and the latest, for «Últimas respuestas». */
  reply_count: number
  last_reply?: Reply | null
}

/** A held delivery waiting for a person (UD-275). */
export interface PendingDelivery {
  branch: string
  held_reason: string
  /** The `execute` job that wrote the branch. */
  job_id: string
  agent_id: string | null
  /** The `deliver` job queued or running after a person approved; its progress shows in the review. */
  delivering_job_id: string | null
  /** UD-289: `held` waits for review, `delivering` runs, `failed` the last delivery did not reach production. */
  state: 'held' | 'delivering' | 'failed'
}

/** A progress notice of Claude while it works (UD-293): not a reply, so it does not count in `reply_count` or change the status. */
export interface ProgressNote {
  id: string
  message_id: string
  job_id: string
  author_id: string
  body: string
  /** Minutes since the session started when the notice was written. */
  minutes: number | null
  created_at: string
}

export interface MessageDetail extends Message {
  replies: Reply[]
  /** The progress notices, in the order they were written; the thread draws them by `created_at` between the replies (UD-293). */
  progress_notes?: ProgressNote[]
  /** The review a held delivery waits for; null when none (UD-275). */
  pending_delivery?: PendingDelivery | null
  /** What a video frame shows and nobody says; outside the body, empty when there is none. */
  observed?: string[]
  /** Set while the message is deleted (UD-240); only an Editor asking for it sees such a message. */
  deleted_at?: string | null
}

export type ProviderSlot = 'text' | 'vision' | 'speech'

export interface ProviderSetting {
  slot: ProviderSlot
  provider: string
  model: string
  /** False when the key or another condition is missing; `reason` says which, in the account's language or as a code. */
  available?: boolean
  reason?: string | null
  base_url?: string | null
  /** Last four characters of the key the function's provider uses; the key itself never reaches the panel. */
  key_last4?: string | null
  status?: ConnectionStatus
}

/** Why a test against a provider failed, classified by the server. */
export type Cause = 'invalid_key' | 'no_quota' | 'model_not_found' | 'no_network' | 'rate_limited' | 'timeout' | 'bad_address' | 'provider_error' | 'unknown'
export const CAUSES: readonly Cause[] = ['invalid_key', 'no_quota', 'model_not_found', 'no_network', 'rate_limited', 'timeout', 'bad_address', 'provider_error', 'unknown']

/** Result of one test call against a provider. */
export interface Check {
  ok: boolean
  cause: Cause | null
  /** HTTP status of the provider's answer, when there was one. */
  status: number | null
  duration_ms: number
  model: string | null
  /** The models the provider lists, when it lists them. */
  models: string[] | null
  model_listed: boolean | null
  checked_at: string
}

export type ConnectionStatus = 'no_key' | 'configured' | 'failing'
export type ConnectionKind = 'anthropic' | 'openai-compatible' | 'groq-speech'
export type StructuredMode = 'json_schema' | 'tool' | 'json_object'

/** A provider the server can talk to, with the state of its key. The key itself is never sent. */
export interface Connection {
  /** Slug; the id and the value of `provider` in the functions. */
  name: string
  label: string
  kind: ConnectionKind
  custom: boolean
  base_url: string | null
  structured: StructuredMode | null
  status: ConnectionStatus
  key: { source: 'stored' | 'environment' | null; last4: string | null; updated_at: string | null }
  used_by: ProviderSlot[]
  last_check: { at: string; ok: boolean; cause: Cause | null; duration_ms: number } | null
}

export interface Preset {
  name: string
  label: string
  kind: ConnectionKind
  base_url: string | null
  suggested_model: string | null
  structured: StructuredMode | null
}

export interface ConnectionsView {
  items: Connection[]
  presets: Preset[]
}

/** Body of POST /settings/connections. */
export interface NewConnection {
  preset?: string
  name?: string
  label?: string
  base_url?: string
  structured?: string
  api_key: string
  model?: string
}

/** Partial change of a published message (PATCH /messages/:id). */
export interface MessagePatch {
  title?: string
  body?: string
  fields?: Record<string, string | null>
  assignee_ids?: string[]
  area_id?: string
  template_id?: string
  attachment_ids?: string[]
}

/** What is sent to add a member (POST /members). */
export interface NewMember {
  email: string
  name: string
  role?: Role
  profile?: string
  password?: string
}

/** Events of the SSE stream (GET /events). */
export interface ProgressEvent {
  job_id: string
  input_id?: string
  percent: number
  phrase: string
  /** Stable code of the step (H-3722); absent from a server older than the codes. */
  code?: string | null
  vars?: Record<string, number>
  at?: string
}

export interface DoneEvent {
  job_id: string
  input_id?: string
  /** What the job left the input as: `published` when the publication was automatic (UD-070), `proposed` when it waits for review. */
  input_status?: string
  /** The message the job worked on (`execute`, and the reading of the audio of a reply, UD-279): its thread is stale. */
  message_id?: string
  done: true
}

/** A write left these cache roots stale; `message_id` when it was on one message. Travels as a `message` event with `reason: 'changed'`. */
export interface ChangedEvent {
  roots: string[]
  message_id?: string
}

export interface NewMessageEvent {
  message_id: string
  title: string
  author_id: string
  at?: string
  /** `mention` when someone picked the member in a reply (UD-278); anything else is an assignment. */
  reason?: string
  reply_id?: string
}

/** GET /messages/summary: what affects me by state, and the messages of each area by state (UD-028, UD-041). */
export interface MessageSummary {
  mine: { open: number; answered: number; total: number }
  /** The messages that make up `mine`, one by one: what the bell lists (J2-A-43). */
  items: { message_id: string; title: string; status: 'open' | 'answered'; at: string }[]
  areas: { area_id: string; open: number; answered: number; closed: number; mine_open: number }[]
}

// ---------------------------------------------------------------- What the lists and settings screens read

/** Project description (UD-024): the whole team sees it and only the Editor changes it. */
export interface Project {
  /** Cap of characters (PROJECT_DESCRIPTION_MAX_CHARS); a server that does not send it leaves the counter without a cap. */
  max_chars?: number
  /** Cap of characters of the name (PROJECT_NAME_MAX_CHARS, H-3722). */
  name_max_chars?: number
  name: string
  description: string
}

/** A send in the queue of Configuración (UD-251): the input with the name of its author. */
export interface QueueInput extends InputRecord {
  author_name?: string | null
}

/** Every paginated list is `{ items, page, limit, total }` (src/contracts.md §3). */
export interface Paged<T> {
  items: T[]
  page: number
  limit: number
  total: number
}

export const JOB_STATES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export type JobState = (typeof JOB_STATES)[number]
export type PurgeState = 'done' | 'failed' | 'cancelled'

export interface SpanNode {
  span_id: string
  name: string
  status: string
  duration_ms: number
  attributes: Record<string, unknown>
  children: SpanNode[]
}

/** Where the time of the execution of a message went (GET /messages/:id/timing). */
export interface MessageTiming {
  message_id: string
  job_id: string
  job_status: string
  trace_id: string | null
  phase: string | null
  elapsed_ms: number | null
  first_reply_ms: number | null
  final_reply_ms: number | null
  total_ms: number | null
  queue_wait_ms: number | null
  phases: { name: string; duration_ms: number; offset_ms: number | null; status: string }[]
  /** The delivery that followed the run (UD-263), when there is one. */
  deliver?: { job_id: string; job_status: string; phase: string | null; attempts: number }
  slowest: { kind: 'tool' | 'subagent'; name: string; summary: string | null; duration_ms: number; success: boolean | null }[]
  /** The technical part of the output of the agent and the reference of its delivery (UD-276); the reply carries only the summary. */
  detail?: { entries: { label: string; value: string }[]; delivery_ref: string | null } | null
  tree: SpanNode | null
}

export const PHASE_KEYS = ['queue_wait_ms', 'first_reply_ms', 'final_reply_ms', 'total_ms', 'create_ms', 'run_ms', 'destroy_ms', 'tools_ms', 'judge_ms', 'delivery_ms', 'wait_ms'] as const
export type RunPhase = (typeof PHASE_KEYS)[number]

/** GET /ops/execute-runs/summary (UD-262): the figures of the execute runs of a period. */
export interface ExecuteRunsSummary {
  runs: number
  failed: number
  phases: Record<RunPhase, { n: number; avg: number | null; p50: number | null; p95: number | null }>
  cost: { n: number; avg_usd: number | null; total_usd: number }
  delivery: { known: number; delivered: number; held: number; rate: number | null }
  resolved: { runs: number; investigated: number; rate: number | null }
  slowest_tools: { kind: string; name: string; summary: string | null; duration_ms: number; success: boolean | null }[]
}

/** One row of the history of execute runs (GET /ops/execute-runs); its figures are the keys of `PHASE_KEYS` and a few more. */
export type ExecuteRun = Record<string, unknown>

/** The filters of the history of execute runs. Dates are `YYYY-MM-DD`. */
export interface ExecuteRunsFilter {
  page?: number
  limit?: number
  since?: string
  until?: string
  instance?: string
  message_id?: string
  outcome?: string
}

/** An `execute` job in the list of jobs. */
export interface RunningJob {
  id: string
  kind: string
  message_id: string | null
  phase: string | null
  run_at: string
}

export interface JobTrace {
  job_id: string
  span_count: number
  totals: { llm_calls: number; input_tokens: number; output_tokens: number; cost_usd: number | null; unpriced_calls: number }
  roots: SpanNode[]
}

export interface AuditEntry {
  id: string
  at: string
  member_id: string | null
  member_name: string | null
  action: string
  entity: string
  entity_id: string | null
  detail: Record<string, unknown> | null
}

export interface UiSummary {
  days: number
  screens?: Record<string, { visits: number }>
  tasks?: Record<string, { started: number; abandoned?: number }>
  errors?: { total: number }
}

/** The framing of one language: the text in force, the default and whether the Editor changed it. */
export interface FramingItem {
  value: string
  default: string
  custom: boolean
}

export interface AnalysisSettings {
  framing: Record<Language, FramingItem>
  /** Cap of characters of each framing (ANALYSIS_FRAMING_MAX_CHARS). */
  max_chars: number
}

/** Answer of the calls that add, replace or test a provider's key. */
export interface ConnectionResult {
  connection: Connection
  check: Check
}

/** The new send (POST /inputs): text, files and links, and optionally the member it is sent in the name of. */
export interface NewInput {
  text: string
  files: File[]
  links: string[]
  /** «Enviar como» (UD-255): the member the input is sent in the name of; without it, the member of the session. */
  asMemberId?: string
  /** Recipients (UD-291): the members the send is addressed to, an agent among them; without them the automatic routing assigns. */
  recipientIds?: string[]
}

export interface CreatedInput {
  input_id: string
  job_id: string
}

/** A reply as the person writes it; with files or links the submit is multipart. */
export interface NewReply {
  body: string
  /** A `forward` is written by the forward route only (UD-272). */
  kind: Exclude<ReplyKind, 'forward'>
  files?: File[]
  links?: string[]
  /** The members picked in the list of «@» (UD-278); never read from the text. */
  mention_ids?: string[]
}

/** Result of a reprocess (POST /inputs/:id/reprocess). */
export interface ReprocessResult {
  input_id: string
  job_id: string
  set_aside?: { messages: number; replies: number }
}

export interface DeleteInputResult {
  input_id: string
  deleted: { attachments: number; jobs: number; messages: number }
  freed_bytes: number
}

export interface DeleteMemberResult {
  member_id: string
  deleted: { inputs: number; messages: number; replies: number }
  /** What stays under the author «Miembro eliminado» (UD-292). */
  kept?: { inputs: number; messages: number; replies: number }
}

/** What the member editor sends (PATCH /members/:id, or /members/me for oneself). */
export type MemberPatch = Partial<Pick<Member, 'profile' | 'role' | 'name' | 'email' | 'active'>> & {
  language?: Language
  current_password?: string
  new_password?: string
}

export type ResetScope = 'content' | 'everything'

/** Answer of POST /ops/reset: what the Editor's «Datos» emptied. */
export interface ResetResult {
  scope: ResetScope
  deleted: Record<string, number>
  files: number
  bytes_freed: number
}
