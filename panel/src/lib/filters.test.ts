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

describe('filtros en la URL', () => {
  it('va y vuelve sin perder propiedad, operador ni valor', () => {
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

  it('ignora filtros inválidos y repetidos de una misma propiedad', () => {
    const params = new URLSearchParams()
    params.append('f', 'color:eq:rojo')
    params.append('f', 'status:eq:cualquiera')
    params.append('f', 'area:igual:a1')
    params.append('f', 'area:eq:a1')
    params.append('f', 'area:neq:a2')
    params.append('f', 'sinseparadores')
    expect(parseQuery(params).filters).toEqual([{ prop: 'area', op: 'eq', value: 'a1' }])
  })

  it('«replies» sólo admite igualdad', () => {
    const params = new URLSearchParams('f=replies:neq:con')
    expect(parseQuery(params).filters).toEqual([{ prop: 'replies', op: 'eq', value: 'con' }])
  })

  it('reemplaza o quita el filtro de una propiedad', () => {
    const base = [{ prop: 'area' as const, op: 'eq' as const, value: 'a1' }]
    const next = upsertFilter(base, { prop: 'area', op: 'neq', value: 'a2' })
    expect(next).toEqual([{ prop: 'area', op: 'neq', value: 'a2' }])
    expect(removeFilter(next, 'area')).toEqual([])
  })
})

describe('parámetros para la API', () => {
  it('manda sólo igualdades y traduce «con respuestas»', () => {
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

  it('«sin respuestas» no viaja al servidor', () => {
    expect(toApiParams({ filters: [{ prop: 'replies', op: 'eq', value: 'sin' }], q: '' }).toString()).toBe('')
  })
})

describe('filtros del lado del cliente', () => {
  const list = [
    msg({ id: '1', area_id: 'a1', status: 'open', assignee_ids: ['yo'], reply_count: 0 }),
    msg({ id: '2', area_id: 'a2', status: 'closed', assignee_ids: ['otro'], reply_count: 2 }),
    msg({ id: '3', area_id: 'a1', status: 'answered', assignee_ids: ['yo', 'otro'], reply_count: 1 }),
  ]
  const ids = (q: MessageQuery) => applyClientFilters(list, q, 'yo').map((m) => m.id)

  it('«para no es yo» resuelve me con el miembro de la sesión', () => {
    expect(ids({ filters: [{ prop: 'for', op: 'neq', value: 'me' }], q: '' })).toEqual(['2'])
  })
  it('«área no es» y «estado no es»', () => {
    expect(ids({ filters: [{ prop: 'area', op: 'neq', value: 'a1' }], q: '' })).toEqual(['2'])
    expect(ids({ filters: [{ prop: 'status', op: 'neq', value: 'closed' }], q: '' })).toEqual(['1', '3'])
  })
  it('«sin respuestas»', () => {
    expect(ids({ filters: [{ prop: 'replies', op: 'eq', value: 'sin' }], q: '' })).toEqual(['1'])
  })
  it('las igualdades las resuelve el servidor y no se repiten acá', () => {
    expect(ids({ filters: [{ prop: 'area', op: 'eq', value: 'a2' }], q: '' })).toEqual(['1', '2', '3'])
  })
})
