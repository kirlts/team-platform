// Types of what the API returns (MASTER-SPEC §7.1 and §7.2). The field names are
// those of the tables. Where the specification does not fix the shape of the
// response, the assumption is annotated and the development double server fulfills it.

export type Role = 'member' | 'editor'

export interface Member {
  id: string
  email: string
  name: string
  role: Role
  responsibilities: string
  /** Assumption: list of domains. */
  domains: string[]
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
  /** Assumption: GET /areas brings the count of open messages of the area. */
  open_count?: number
  template_count?: number
}

export interface Template {
  id: string
  area_id: string
  name: string
  description: string
  body_markdown: string
  updated_at: string
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document' | 'link'

export interface Attachment {
  id: string
  input_id?: string
  kind: AttachmentKind
  mime?: string
  size?: number
  /** Original file name or link address. */
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
  fields?: unknown
  assignee_ids: string[]
  attachment_ids: string[]
  /** Units of the input this message covers (numbered by the system). */
  unit_ids: string[]
}

/** Units of the input the analysis left without a message, with the reason. */
export interface DiscardedUnits {
  unit_ids: string[]
  reason: string
}

export interface Proposal {
  messages: ProposalMessage[]
  discarded: DiscardedUnits[]
}

/** Assumption: the input brings its numbered units with the text, to show what was discarded. */
export interface InputUnit {
  id: string
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
  attachments: Attachment[]
  /** List assumptions: number of replies and the latest one, for «Últimas respuestas». */
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
