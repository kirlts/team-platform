// Tipos de lo que devuelve la API (MASTER-SPEC §7.1 y §7.2). Los nombres de los
// campos son los de las tablas. Donde la especificación no fija la forma de la
// respuesta, el supuesto está anotado y el servidor doble de desarrollo lo cumple.

export type Role = 'member' | 'editor'
/** Idioma de la cuenta (UD-018): rige la interfaz, los mensajes que se redactan y los prompts. */
export type Language = 'es-419' | 'en'

export interface Member {
  id: string
  email: string
  name: string
  role: Role
  /** Perfil en prosa (UD-023): un par de párrafos en primera persona que escribe la propia persona; hasta 4.000 caracteres. */
  profile: string
  language: Language
  /** Una cuenta desactivada no inicia sesión y conserva su historial; sólo el Editor la desactiva o la reactiva. */
  active: boolean
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
  /** Abiertos y respondidos: lo que sigue pendiente. Es el número que lleva la barra lateral. */
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
  /** Valor de cada campo de la plantilla, por su nombre. */
  fields?: Record<string, string | null> | null
  assignee_ids: string[]
  attachment_ids: string[]
  /** Unidades del input que cubre este mensaje (las numera el sistema). */
  unit_ids: number[]
}

/** Unidades del input que el análisis dejó sin mensaje, con el motivo. */
export interface DiscardedUnits {
  unit_ids: number[]
  reason: string
}

export interface Proposal {
  messages: ProposalMessage[]
  discarded: DiscardedUnits[]
}

/** Supuesto: el input trae sus unidades numeradas con el texto, para mostrar lo descartado. */
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
  /** Motivo visible cuando status es `failed`. */
  error?: string | null
  /** Código estable del fallo; el panel lo traduce a su catálogo. */
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
  /** Tipos de medio adjuntos a la respuesta, para dibujar un ícono por tipo (UD-016). */
  attachment_kinds?: AttachmentKind[]
  /** Los adjuntos mismos (miniaturas); se sirven en `GET /replies/attachments/:id`, otro espacio de ids que los del mensaje. */
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
  /** Valor de cada campo de la plantilla del mensaje, por su nombre. */
  fields?: Record<string, string | null>
  attachments: Attachment[]
  /** Tipos de medio adjuntos, para dibujar un ícono por tipo (UD-016). */
  attachment_kinds?: AttachmentKind[]
  updated_at?: string
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
  /** Falso cuando falta la llave u otra condición; `reason` dice cuál, en el idioma de la cuenta o como código. */
  available?: boolean
  reason?: string | null
}

/** Cambio parcial de un mensaje publicado (PATCH /messages/:id). */
export interface MessagePatch {
  title?: string
  body?: string
  fields?: Record<string, string | null>
  assignee_ids?: string[]
  area_id?: string
  template_id?: string
}

/** Lo que se envía para dar de alta a un miembro (POST /members). */
export interface NewMember {
  email: string
  name: string
  role?: Role
  profile?: string
  password?: string
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
