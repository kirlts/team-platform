import { describe, expect, it } from 'vitest'
import { canReplyTo } from './handoff'

const members = [{ id: '1', kind: 'person' as const }, { id: '2', kind: 'agent' as const }]
const question = { author_id: '1', status: 'open' as const, assignee_ids: ['1'], replies: [{ author_id: '2', kind: 'clarification' }] }

describe('canReplyTo (UD-269)', () => {
  it('the sender replies while they hold the question of an agent', () => {
    expect(canReplyTo(question as never, '1', members)).toBe(true)
  })
  it('the rule holds in every other case', () => {
    expect(canReplyTo({ ...question, replies: [{ author_id: '2', kind: 'answer' }] } as never, '1', members)).toBe(false)
    expect(canReplyTo({ ...question, assignee_ids: ['2'] } as never, '1', members)).toBe(false)
    expect(canReplyTo({ ...question, replies: [{ author_id: '1', kind: 'clarification' }] } as never, '1', members)).toBe(false)
    expect(canReplyTo({ ...question, status: 'closed' } as never, '1', members)).toBe(false)
    expect(canReplyTo(question as never, undefined, members)).toBe(false)
  })
  it('anyone else replies unless it is closed', () => {
    expect(canReplyTo({ ...question, assignee_ids: [], replies: [] } as never, '3', members)).toBe(true)
  })
})
