// Mensajes filters: property, operator and value, kept in the URL.
// The server only understands equality (GET /messages?for=&involved=&area=&status=&q=&replies=&deleted=);
// negation («no es») and «sin respuestas» are applied here on the received list.
import type { Message } from './types.js'

export type FilterProp = 'for' | 'involved' | 'area' | 'status' | 'replies' | 'deleted'
export type FilterOp = 'eq' | 'neq'

export interface Filter {
  prop: FilterProp
  op: FilterOp
  value: string
}

export interface MessageQuery {
  filters: Filter[]
  q: string
}

export const FILTER_PROPS: FilterProp[] = ['for', 'area', 'status', 'replies', 'deleted']
/** `involved` is not in the menu: it is only reached from the state marks of the bar, which count what concerns me (H-2000). */
const PROP_SET_EXTRA: FilterProp[] = ['involved']
export const REPLIES_VALUES = ['con', 'sin'] as const
export const STATUS_VALUES = ['open', 'answered', 'closed'] as const
/** The only value of the «Borrados» filter: the deleted messages the person can restore (UD-250). */
export const DELETED_VALUE = 'si'
/** Value of the «Para» filter meaning the person holding the session. */
export const ME = 'me'

const PROP_SET = new Set<string>([...FILTER_PROPS, ...PROP_SET_EXTRA])

function validFilter(prop: string, op: string, value: string): Filter | null {
  if (!PROP_SET.has(prop)) return null
  if (op !== 'eq' && op !== 'neq') return null
  if (!value) return null
  const p = prop as FilterProp
  if (p === 'involved') return value === ME ? { prop: p, op: 'eq', value } : null
  if (p === 'deleted') return value === DELETED_VALUE ? { prop: p, op: 'eq', value } : null
  if (p === 'replies') {
    if (!(REPLIES_VALUES as readonly string[]).includes(value)) return null
    return { prop: p, op: 'eq', value }
  }
  if (p === 'status' && !(STATUS_VALUES as readonly string[]).includes(value)) return null
  return { prop: p, op, value }
}

/** `?f=for:eq:me&f=status:neq:closed&q=texto` → query. One filter per property; invalid ones are ignored. */
export function parseQuery(params: URLSearchParams): MessageQuery {
  const filters: Filter[] = []
  for (const raw of params.getAll('f')) {
    const first = raw.indexOf(':')
    const second = raw.indexOf(':', first + 1)
    if (first < 0 || second < 0) continue
    const f = validFilter(raw.slice(0, first), raw.slice(first + 1, second), raw.slice(second + 1))
    if (f && !filters.some((x) => x.prop === f.prop)) filters.push(f)
  }
  return { filters, q: params.get('q')?.trim() ?? '' }
}

export function serializeQuery(query: MessageQuery): URLSearchParams {
  const out = new URLSearchParams()
  for (const f of query.filters) out.append('f', `${f.prop}:${f.op}:${f.value}`)
  if (query.q.trim()) out.set('q', query.q.trim())
  return out
}

/** Replaces the filter of the same property or adds it. */
export function upsertFilter(filters: Filter[], next: Filter): Filter[] {
  const rest = filters.filter((f) => f.prop !== next.prop)
  const index = filters.findIndex((f) => f.prop === next.prop)
  if (index < 0) return [...rest, next]
  const out = [...filters]
  out[index] = next
  return out
}

export function removeFilter(filters: Filter[], prop: FilterProp): Filter[] {
  return filters.filter((f) => f.prop !== prop)
}

/** Parameters the server understands: equalities only. */
export function toApiParams(query: MessageQuery): URLSearchParams {
  const out = new URLSearchParams()
  for (const f of query.filters) {
    if (f.op !== 'eq') continue
    if (f.prop === 'replies') {
      if (f.value === 'con') out.set('replies', '1')
      continue
    }
    if (f.prop === 'deleted') {
      out.set('deleted', '1')
      continue
    }
    out.set(f.prop, f.value)
  }
  if (query.q.trim()) out.set('q', query.q.trim())
  return out
}

/** What the server does not filter: negations and «sin respuestas». */
export function applyClientFilters(messages: Message[], query: MessageQuery, meId: string): Message[] {
  return messages.filter((m) =>
    query.filters.every((f) => {
      switch (f.prop) {
        case 'for': {
          if (f.op === 'eq') return true
          const target = f.value === ME ? meId : f.value
          return !m.assignee_ids.includes(target)
        }
        case 'involved':
        case 'deleted':
          return true
        case 'area':
          return f.op === 'eq' ? true : m.area_id !== f.value
        case 'status':
          return f.op === 'eq' ? true : m.status !== f.value
        case 'replies':
          return f.value === 'sin' ? m.reply_count === 0 : true
      }
    }),
  )
}

/** Stable query key for TanStack Query. */
export function queryKeyOf(query: MessageQuery): string {
  return serializeQuery(query).toString()
}

/** The query string `GET /messages` takes: the equalities of the filters and the text; `repliesFeed` adds the Inicio feed (only messages with replies, newest reply first). */
export function messagesQueryString(query: MessageQuery, repliesFeed?: boolean): string {
  const params = toApiParams(query)
  if (repliesFeed) params.set('replies', '1')
  return params.toString()
}
