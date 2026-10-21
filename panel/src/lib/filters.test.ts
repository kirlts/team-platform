import { describe, expect, it } from 'vitest'
import {
  applyClientFilters,
  parseQuery,
  removeFilter,
  serializeQuery,
  toApiParams,
  upsertFilter,
  type MessageQuery,
} from './filters'
import type { Message } from './types'

function msg(over: Partial<Message>): Message {
  return {
    id: 'm',
    area_id: 'a1',
    author_id: 'u1',
    title: 't',
    body: 'b',
    status: 'open',
    created_at: '2026-10-20T10:00:00Z',
    assignee_ids: [],
    attachments: [],
    reply_count: 0,
    ...over,
  }
}

describe('filters in the URL', () => {
  it('round-trips without losing property, operator or value', () => {
    const query: MessageQuery = {
      filters: [
        { prop: 'for', op: 'eq', value: 'me' },
        { prop: 'status', op: 'neq', value: 'closed' },
      ],
      q: 'login roto',
    }
    const params = serializeQuery(query)
    expect(params.toString()).toBe('f=for%3Aeq%3Ame&f=status%3Aneq%3Aclosed&q=login+roto')
    expect(parseQuery(params)).toEqual(query)
  })

  it('ignores invalid filters and repeated filters of the same property', () => {
    const params = new URLSearchParams()
    params.append('f', 'color:eq:rojo')
    params.append('f', 'status:eq:cualquiera')
    params.append('f', 'area:igual:a1')
    params.append('f', 'area:eq:a1')
    params.append('f', 'area:neq:a2')
    params.append('f', 'sinseparadores')
    expect(parseQuery(params).filters).toEqual([{ prop: 'area', op: 'eq', value: 'a1' }])
  })

  it('«replies» only admits equality', () => {
    const params = new URLSearchParams('f=replies:neq:con')
    expect(parseQuery(params).filters).toEqual([{ prop: 'replies', op: 'eq', value: 'con' }])
  })

  it('replaces or removes the filter of a property', () => {
    const base = [{ prop: 'area' as const, op: 'eq' as const, value: 'a1' }]
    const next = upsertFilter(base, { prop: 'area', op: 'neq', value: 'a2' })
    expect(next).toEqual([{ prop: 'area', op: 'neq', value: 'a2' }])
    expect(removeFilter(next, 'area')).toEqual([])
  })
})

describe('parameters for the API', () => {
  it('sends only equalities and translates «con respuestas»', () => {
    const params = toApiParams({
      filters: [
        { prop: 'for', op: 'eq', value: 'me' },
        { prop: 'area', op: 'neq', value: 'a2' },
        { prop: 'replies', op: 'eq', value: 'con' },
      ],
      q: ' error ',
    })
    expect(params.toString()).toBe('for=me&replies=1&q=error')
  })

  it('«sin respuestas» does not travel to the server', () => {
    expect(toApiParams({ filters: [{ prop: 'replies', op: 'eq', value: 'sin' }], q: '' }).toString()).toBe('')
  })
})

describe('client-side filters', () => {
  const list = [
    msg({ id: '1', area_id: 'a1', status: 'open', assignee_ids: ['yo'], reply_count: 0 }),
    msg({ id: '2', area_id: 'a2', status: 'closed', assignee_ids: ['otro'], reply_count: 2 }),
    msg({ id: '3', area_id: 'a1', status: 'answered', assignee_ids: ['yo', 'otro'], reply_count: 1 }),
  ]
  const ids = (q: MessageQuery) => applyClientFilters(list, q, 'yo').map((m) => m.id)

  it('«para no es yo» resolves me with the session member', () => {
    expect(ids({ filters: [{ prop: 'for', op: 'neq', value: 'me' }], q: '' })).toEqual(['2'])
  })
  it('«área no es» and «estado no es»', () => {
    expect(ids({ filters: [{ prop: 'area', op: 'neq', value: 'a1' }], q: '' })).toEqual(['2'])
    expect(ids({ filters: [{ prop: 'status', op: 'neq', value: 'closed' }], q: '' })).toEqual(['1', '3'])
  })
  it('«sin respuestas»', () => {
    expect(ids({ filters: [{ prop: 'replies', op: 'eq', value: 'sin' }], q: '' })).toEqual(['1'])
  })
  it('equalities are resolved by the server and are not repeated here', () => {
    expect(ids({ filters: [{ prop: 'area', op: 'eq', value: 'a2' }], q: '' })).toEqual(['1', '2', '3'])
  })
})
