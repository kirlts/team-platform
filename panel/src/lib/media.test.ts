import { describe, expect, it } from 'vitest'
import { kindsOf, mainAttachment, mediaKinds } from './media'

describe('mediaKinds', () => {
  it('returns one entry per kind in a fixed order, with its count', () => {
    const list = [{ kind: 'link' }, { kind: 'audio' }, { kind: 'image' }, { kind: 'image' }, { kind: 'document' }, { kind: 'video' }] as const
    expect(mediaKinds(list)).toEqual([
      { kind: 'image', count: 2 },
      { kind: 'video', count: 1 },
      { kind: 'audio', count: 1 },
      { kind: 'document', count: 1 },
      { kind: 'link', count: 1 },
    ])
  })

  it('returns nothing without attachments', () => {
    expect(mediaKinds([])).toEqual([])
    expect(mediaKinds(undefined)).toEqual([])
  })
})

describe('mainAttachment', () => {
  it('prefers a photo, then a video, then whatever comes first', () => {
    expect(mainAttachment([{ kind: 'audio' }, { kind: 'video' }, { kind: 'image' }])?.kind).toBe('image')
    expect(mainAttachment([{ kind: 'audio' }, { kind: 'video' }])?.kind).toBe('video')
    expect(mainAttachment([{ kind: 'link' }, { kind: 'audio' }])?.kind).toBe('link')
    expect(mainAttachment([])).toBeUndefined()
  })
})

describe('kindsOf', () => {
  it('uses the attachments when there are, else the kinds the API sends', () => {
    expect(kindsOf({ attachments: [{ kind: 'image' }, { kind: 'image' }], attachment_kinds: ['audio'] })).toEqual([{ kind: 'image', count: 2 }])
    expect(kindsOf({ attachments: [], attachment_kinds: ['link', 'audio'] })).toEqual([
      { kind: 'audio', count: 1 },
      { kind: 'link', count: 1 },
    ])
    expect(kindsOf({})).toEqual([])
  })
})
