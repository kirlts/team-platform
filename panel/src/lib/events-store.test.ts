import { describe, expect, it } from 'vitest'
import { EventsStore } from './events-store'

describe('the end of a job', () => {
  it('carries what the job left the input as, so the telemetry can tell an automatic publication (UD-070, H-1705)', () => {
    const store = new EventsStore()
    const seen: Array<string | undefined> = []
    store.onDone((e) => seen.push(e.input_status))
    store.dispatch('done', JSON.stringify({ job_id: 'j1', input_id: 'i1', status: 'done', input_status: 'published', message_ids: ['3'] }))
    store.dispatch('done', JSON.stringify({ job_id: 'j2', input_id: 'i2', status: 'done', input_status: 'proposed' }))
    store.dispatch('done', JSON.stringify({ job_id: 'j3', done: true }))
    expect(seen).toEqual(['published', 'proposed', undefined])
  })
})
