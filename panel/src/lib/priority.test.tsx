// UD-029: the priority of a notification. A badge's fill is the highest priority present, red > yellow > blue; every
// check is a prohibition (a badge that shows a lower priority than the highest present must fail here).
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NotifyBadge, ToneMark } from '@/components/NotifyBadge'
import { I18nProvider } from '@/i18n'
import { areaMessagesPath, areaPendingCounts, mineCounts } from './pending'
import { parseQuery } from './filters'
import { messageTone, topTone, TONES, toneTotal, type Tone, type ToneCounts } from './priority'

/** Every combination of present and absent priorities: 2^3. */
const COMBINATIONS: ToneCounts[] = Array.from({ length: 8 }, (_, bits) => ({ red: bits & 1 ? 2 : 0, yellow: bits & 2 ? 3 : 0, blue: bits & 4 ? 4 : 0 }))

const highest = (counts: ToneCounts): Tone | null => (counts.red ? 'red' : counts.yellow ? 'yellow' : counts.blue ? 'blue' : null)

describe('notice priority (UD-029)', () => {
  it('the order of the priorities is red, yellow, blue', () => {
    expect([...TONES]).toEqual(['red', 'yellow', 'blue'])
  })

  it('topTone gives the highest priority present in every combination', () => {
    for (const counts of COMBINATIONS) expect(topTone(counts)).toBe(highest(counts))
  })

  it('a lower priority never wins over a higher one, whatever the counts', () => {
    expect(topTone({ red: 1, yellow: 99, blue: 99 })).toBe('red')
    expect(topTone({ red: 0, yellow: 1, blue: 99 })).toBe('yellow')
    expect(topTone({ blue: 5 })).toBe('blue')
    expect(topTone({})).toBeNull()
  })

  it('the badge fill (data-tone) is the highest priority present in every combination, with the total as number and the shape of that priority', () => {
    for (const counts of COMBINATIONS) {
      const { container, unmount } = render(
        <I18nProvider language="es-419">
          <NotifyBadge counts={counts} />
        </I18nProvider>,
      )
      const badge = container.querySelector('[data-tone]')
      const top = highest(counts)
      if (!top) {
        expect(badge).toBeNull()
      } else {
        expect(badge?.getAttribute('data-tone')).toBe(top)
        expect(badge?.getAttribute('data-count')).toBe(String(toneTotal(counts)))
        expect(badge?.textContent).toBe(String(toneTotal(counts)))
        // The color is never the only signal: a shape (svg) and the word in the accessible name say the priority too.
        expect(badge?.querySelector('svg')).not.toBeNull()
        expect(badge?.getAttribute('aria-label')).toContain(String(toneTotal(counts)))
      }
      unmount()
    }
  })

  it('every badge and mark is quiet: the solid fill belongs to the bell alone (J2-B-03, J3-A-04, UD-035)', () => {
    for (const counts of COMBINATIONS) {
      const { container, unmount } = render(
        <I18nProvider language="es-419">
          <NotifyBadge counts={counts} />
          {TONES.map((tone) => (
            <ToneMark key={tone} tone={tone} n={1} />
          ))}
        </I18nProvider>,
      )
      for (const el of container.querySelectorAll('[data-tone]')) expect(el.getAttribute('data-weight')).toBe('quiet')
      unmount()
    }
  })

  it('a count that changes pulses once; one that arrives, or stays, does not (J2-B-27)', () => {
    const draw = (counts: ToneCounts) => (
      <I18nProvider language="es-419">
        <NotifyBadge counts={counts} />
      </I18nProvider>
    )
    const { container, rerender } = render(draw({ red: 2 }))
    const pulse = () => container.querySelector('[data-tone]')?.getAttribute('data-pulse')
    expect(pulse()).toBe('false')
    rerender(draw({ red: 2 }))
    expect(pulse()).toBe('false')
    rerender(draw({ red: 3 }))
    expect(pulse()).toBe('true')
  })

  it('the three priorities have three different words and three different shapes', () => {
    const words = new Set<string>()
    const shapes = new Set<string>()
    for (const tone of TONES) {
      const { container, unmount } = render(
        <I18nProvider language="es-419">
          <ToneMark tone={tone} />
        </I18nProvider>,
      )
      words.add(container.textContent ?? '')
      shapes.add(container.querySelector('svg')?.innerHTML ?? '')
      unmount()
    }
    expect(words.size).toBe(3)
    expect(shapes.size).toBe(3)
  })
})

describe('which priority a message has for me', () => {
  const base = { author_id: 'u-otro', assignee_ids: [] as string[] }
  it('assigned to me and open is red; assigned and answered is yellow', () => {
    expect(messageTone({ ...base, status: 'open', assignee_ids: ['me'] }, 'me')).toBe('red')
    expect(messageTone({ ...base, status: 'answered', assignee_ids: ['me'] }, 'me')).toBe('yellow')
  })
  it('sent by me, not assigned to me and answered is blue; sent by me and unanswered affects nothing', () => {
    expect(messageTone({ ...base, author_id: 'me', status: 'answered' }, 'me')).toBe('blue')
    expect(messageTone({ ...base, author_id: 'me', status: 'open' }, 'me')).toBeNull()
  })
  it('a closed message and a message of others never count', () => {
    expect(messageTone({ ...base, status: 'closed', assignee_ids: ['me'] }, 'me')).toBeNull()
    expect(messageTone({ ...base, status: 'open' }, 'me')).toBeNull()
  })
})

describe('pending items per area (UD-028)', () => {
  const summary = {
    mine: { red: 1, yellow: 2, blue: 0, total: 3 },
    items: [],
    areas: [
      { area_id: '7', open: 3, mine_open: 1 },
      { area_id: '8', open: 2, mine_open: 0 },
      { area_id: '9', open: 0, mine_open: 0 },
    ],
  }
  it('an area is red when one of its open messages is mine, yellow otherwise, and empty with nothing open', () => {
    expect(areaPendingCounts(summary, '7')).toEqual({ red: 3 })
    expect(areaPendingCounts(summary, '8')).toEqual({ yellow: 2 })
    expect(topTone(areaPendingCounts(summary, '9'))).toBeNull()
    expect(areaPendingCounts(undefined, '7')).toEqual({})
  })
  it('the counts of the Mensajes tab come straight from the summary', () => {
    expect(mineCounts(summary)).toEqual({ red: 1, yellow: 2, blue: 0 })
    expect(mineCounts(undefined)).toEqual({})
  })
  it('a pending count leads to Mensajes filtered by that area and by open', () => {
    const query = parseQuery(new URLSearchParams(areaMessagesPath('7').split('?')[1]))
    expect(query.filters).toEqual([
      { prop: 'area', op: 'eq', value: '7' },
      { prop: 'status', op: 'eq', value: 'open' },
    ])
  })
})
