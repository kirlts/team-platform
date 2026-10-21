// UD-041: a message has three states and only those categories are shown. The fill of a notice is the color of the highest
// state present, open > answered > closed; every check is a prohibition (a badge that shows a lower state than the highest
// present must fail here).
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NotifyBadge, StateMark } from '@/components/NotifyBadge'
import { I18nProvider } from '@/i18n'
import { en } from '@/i18n/en'
import { es419 } from '@/i18n/es-419'
import { areaCounts, areaMessagesPath, mineCounts } from './pending'
import { parseQuery } from './filters'
import { noticeState, STATES, stateTotal, topState, type StateCounts } from './states'
import type { MessageStatus } from './types'

/** Every combination of present and absent states: 2^3. */
const COMBINATIONS: StateCounts[] = Array.from({ length: 8 }, (_, bits) => ({ open: bits & 1 ? 2 : 0, answered: bits & 2 ? 3 : 0, closed: bits & 4 ? 4 : 0 }))

const highest = (counts: StateCounts): MessageStatus | null => (counts.open ? 'open' : counts.answered ? 'answered' : counts.closed ? 'closed' : null)

describe('message states (UD-041)', () => {
  it('the order of the states is open, answered, closed', () => {
    expect([...STATES]).toEqual(['open', 'answered', 'closed'])
  })

  it('topState gives the highest state present in every combination', () => {
    for (const counts of COMBINATIONS) expect(topState(counts)).toBe(highest(counts))
  })

  it('a lower state never wins over a higher one, whatever the counts', () => {
    expect(topState({ open: 1, answered: 99, closed: 99 })).toBe('open')
    expect(topState({ open: 0, answered: 1, closed: 99 })).toBe('answered')
    expect(topState({ closed: 5 })).toBe('closed')
    expect(topState({})).toBeNull()
  })

  it('the badge fill (data-status) is the highest state present in every combination, with the total as number and the shape of that state', () => {
    for (const counts of COMBINATIONS) {
      const { container, unmount } = render(
        <I18nProvider language="es-419">
          <NotifyBadge counts={counts} />
        </I18nProvider>,
      )
      const badge = container.querySelector('[data-status]')
      const top = highest(counts)
      if (!top) {
        expect(badge).toBeNull()
      } else {
        expect(badge?.getAttribute('data-status')).toBe(top)
        expect(badge?.getAttribute('data-count')).toBe(String(stateTotal(counts)))
        expect(badge?.textContent).toBe(String(stateTotal(counts)))
        // The color is never the only signal: a shape (svg) and the word of each state with its number in the accessible name.
        expect(badge?.querySelector('svg')).not.toBeNull()
        const label = badge?.getAttribute('aria-label') ?? ''
        if (counts.open) expect(label).toContain(`${counts.open} abiertos`)
        if (counts.answered) expect(label).toContain(`${counts.answered} respondidos`)
      }
      unmount()
    }
  })

  it('every badge and mark is quiet: the solid fill belongs to the bell alone (J2-B-03, J3-A-04, UD-036)', () => {
    for (const counts of COMBINATIONS) {
      const { container, unmount } = render(
        <I18nProvider language="es-419">
          <NotifyBadge counts={counts} />
          {STATES.map((status) => (
            <StateMark key={status} status={status} n={1} />
          ))}
        </I18nProvider>,
      )
      for (const el of container.querySelectorAll('[data-status]')) expect(el.getAttribute('data-weight')).toBe('quiet')
      unmount()
    }
  })

  it('a count that changes pulses once; one that arrives, or stays, does not (J2-B-27)', () => {
    const draw = (counts: StateCounts) => (
      <I18nProvider language="es-419">
        <NotifyBadge counts={counts} />
      </I18nProvider>
    )
    const { container, rerender } = render(draw({ open: 2 }))
    const pulse = () => container.querySelector('[data-status]')?.getAttribute('data-pulse')
    expect(pulse()).toBe('false')
    rerender(draw({ open: 2 }))
    expect(pulse()).toBe('false')
    rerender(draw({ open: 3 }))
    expect(pulse()).toBe('true')
  })

  it('the three states have three different words and three different shapes, and the word agrees with the count', () => {
    const words = new Set<string>()
    const shapes = new Set<string>()
    for (const status of STATES) {
      const { container, unmount } = render(
        <I18nProvider language="es-419">
          <StateMark status={status} />
        </I18nProvider>,
      )
      words.add(container.textContent ?? '')
      shapes.add(container.querySelector('svg')?.innerHTML ?? '')
      unmount()
    }
    expect(words).toEqual(new Set(['Abierto', 'Respondido', 'Cerrado']))
    expect(shapes.size).toBe(3)
    const { container } = render(
      <I18nProvider language="es-419">
        <StateMark status="answered" n={1} />
        <StateMark status="open" n={3} />
      </I18nProvider>,
    )
    expect(container.textContent).toBe('1 respondido3 abiertos')
  })
})

describe('which state a message has for me', () => {
  const base = { author_id: 'u-otro', assignee_ids: [] as string[] }
  it('assigned to me, open is open and answered is answered', () => {
    expect(noticeState({ ...base, status: 'open', assignee_ids: ['me'] }, 'me')).toBe('open')
    expect(noticeState({ ...base, status: 'answered', assignee_ids: ['me'] }, 'me')).toBe('answered')
  })
  it('sent by me, not assigned to me and answered is answered; sent by me and unanswered affects nothing', () => {
    expect(noticeState({ ...base, author_id: 'me', status: 'answered' }, 'me')).toBe('answered')
    expect(noticeState({ ...base, author_id: 'me', status: 'open' }, 'me')).toBeNull()
  })
  it('a closed message and a message of others never raise a notice', () => {
    expect(noticeState({ ...base, status: 'closed', assignee_ids: ['me'] }, 'me')).toBeNull()
    expect(noticeState({ ...base, status: 'open' }, 'me')).toBeNull()
  })
})

describe('counts per area (UD-028, UD-041)', () => {
  const summary = {
    mine: { open: 1, answered: 2, total: 3 },
    items: [],
    areas: [
      { area_id: '7', open: 3, answered: 1, closed: 5, mine_open: 1 },
      { area_id: '9', open: 0, answered: 0, closed: 0, mine_open: 0 },
    ],
  }
  it('each area has one count per state, straight from the summary', () => {
    expect(areaCounts(summary, '7')).toEqual({ open: 3, answered: 1, closed: 5 })
    expect(areaCounts(summary, '9')).toEqual({ open: 0, answered: 0, closed: 0 })
    expect(areaCounts(undefined, '7')).toEqual({ open: 0, answered: 0, closed: 0 })
  })
  it('the counts of the Mensajes tab come straight from the summary', () => {
    expect(mineCounts(summary)).toEqual({ open: 1, answered: 2 })
    expect(mineCounts(undefined)).toEqual({})
  })
  it('a count leads to Mensajes filtered by that area and by that state', () => {
    const open = parseQuery(new URLSearchParams(areaMessagesPath('7').split('?')[1]))
    expect(open.filters).toEqual([
      { prop: 'area', op: 'eq', value: '7' },
      { prop: 'status', op: 'eq', value: 'open' },
    ])
    const answered = parseQuery(new URLSearchParams(areaMessagesPath('7', 'answered').split('?')[1]))
    expect(answered.filters[1]).toEqual({ prop: 'status', op: 'eq', value: 'answered' })
  })
})

describe('words retired as a state or priority (UD-041)', () => {
  // The owner defined three states and no other category of a message: none of these words may reappear in a catalog.
  const RETIRED = /\b(por atender|pendientes?|novedad(es)?|pending|needs action|prioridad|priority)\b|^(to do|news)$/i
  for (const [name, catalog] of [['es-419', es419], ['en', en]] as const) {
    it(`the ${name} catalog has no retired word`, () => {
      const hits: string[] = []
      for (const [key, value] of Object.entries(catalog as Record<string, string | Record<string, string>>)) {
        for (const text of typeof value === 'string' ? [value] : Object.values(value)) if (RETIRED.test(text)) hits.push(`${key}: ${text}`)
      }
      expect(hits).toEqual([])
    })
  }
})
