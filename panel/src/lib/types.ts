// Tipos de lo que devuelve la API (MASTER-SPEC §7.1 y §7.2). Los nombres de los
// campos son los de las tablas. Donde la especificación no fija la forma de la
// respuesta, el supuesto está anotado y el servidor doble de desarrollo lo cumple.

export type Role = 'member' | 'editor'

export interface Member {
  id: string
  email: string
  name: string
  role: Role
  responsibilities: string
  /** Supuesto: lista de dominios. */
  domains: string[]
}

/** Respuesta de GET /me: el miembro y el nombre del proyecto (supuesto: `project_name`). */
export interface Me extends Member {
  project_name?: string
}

export interface Area {
  id: string
  title: string
  description: string
  position: number
  /** Supuesto: GET /areas trae el conteo de mensajes abiertos del área. */
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
  /** Nombre de archivo original o dirección del enlace. */
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
  /** Unidades del input que cubre este mensaje (las numera el sistema). */
  unit_ids: string[]
}

/** Unidades del input que el análisis dejó sin mensaje, con el motivo. */
export interface DiscardedUnits {
  unit_ids: string[]
  reason: string
}

export interface Proposal {
  messages: ProposalMessage[]
  discarded: DiscardedUnits[]
}

/** Supuesto: el input trae sus unidades numeradas con el texto, para mostrar lo descartado. */
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
  /** Motivo visible cuando status es `failed`. */
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
  /** Supuesto: cada respuesta trae sus adjuntos con su tipo, igual que el mensaje; la API de MASTER-SPEC §7.1 aún no los devuelve. */
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
  attachments: Attachment[]
  /** Supuestos de la lista: cantidad de respuestas y la última, para «Últimas respuestas». */
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

/** Eventos del flujo SSE (GET /events). */
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
