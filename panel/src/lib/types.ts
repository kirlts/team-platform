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
  deleted_at?: string | null
}

export interface Template {
  id: string
  area_id: string
  name: string
  description: string
  body_markdown: string
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
export type ReplyKind = 'answer' | 'fix' | 'clarification'

export interface Reply {
  id: string
  message_id: string
  author_id: string
  body: string
  kind: ReplyKind
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

export interface MessageDetail extends Message {
  replies: Reply[]
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
  done: true
}

export interface NewMessageEvent {
  message_id: string
  title: string
  author_id: string
  at?: string
}

/** GET /messages/summary: what affects me by state, and the messages of each area by state (UD-028, UD-041). */
export interface MessageSummary {
  mine: { open: number; answered: number; total: number }
  /** The messages that make up `mine`, one by one: what the bell lists (J2-A-43). */
  items: { message_id: string; title: string; status: 'open' | 'answered'; at: string }[]
  areas: { area_id: string; open: number; answered: number; closed: number; mine_open: number }[]
}
