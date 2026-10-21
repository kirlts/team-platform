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
  project_name?: string
}

export interface Area {
  id: string
  title: string
  description: string
  position: number
  /** Assumption: GET /areas brings the area's count of open messages. */
  open_count?: number
  /** Open and answered: what is still pending. It is the number the sidebar carries. */
  unresolved_count?: number
  template_count?: number
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
}

export interface Message {
  id: string
  input_id?: string
  area_id: string
  author_id: string
  title: string
  body: string
  status: MessageStatus
  created_at: string
  closed_at?: string | null
  assignee_ids: string[]
  template_id?: string | null
  /** Value of each field of the message's template, by its name. */
  fields?: Record<string, string | null>
  attachments: Attachment[]
  /** Media types attached, to draw one icon per type (UD-016). */
  attachment_kinds?: AttachmentKind[]
  updated_at?: string
  /** List assumptions: number of replies and the latest, for «Últimas respuestas». */
  reply_count: number
  last_reply?: Reply | null
}

export interface MessageDetail extends Message {
  replies: Reply[]
}

export type ProviderSlot = 'text' | 'vision' | 'speech'

export interface ProviderSetting {
  slot: ProviderSlot
  provider: string
  model: string
  /** False when the key or another condition is missing; `reason` says which, in the account's language or as a code. */
  available?: boolean
  reason?: string | null
}

/** Partial change of a published message (PATCH /messages/:id). */
export interface MessagePatch {
  title?: string
  body?: string
  fields?: Record<string, string | null>
  assignee_ids?: string[]
  area_id?: string
  template_id?: string
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
  at?: string
}

export interface DoneEvent {
  job_id: string
  input_id?: string
  done: true
}

export interface NewMessageEvent {
  message_id: string
  title: string
  author_id: string
  at?: string
}
