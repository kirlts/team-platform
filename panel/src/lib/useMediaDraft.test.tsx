// TP-13 (soft-locks 2026-11-04), behavior side: the draft of the send bar and of a reply stops a recording that is still open when it unmounts.
// Fails on the tree before the change: the hook kept the `Recording` in a ref and nobody cancelled it.
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const cancel = vi.fn()
let release: () => void = () => {}
vi.mock('./recorder', () => ({
  canRecord: () => true,
  startRecording: vi.fn(async () => {
    await new Promise<void>((resolve) => (release = resolve))
    return { cancel, stop: vi.fn(), seconds: 0 }
  }),
}))

import { useMediaDraft } from './useMediaDraft'

let toggle: () => Promise<void> = async () => {}
function Probe() {
  toggle = useMediaDraft().toggleRecording
  return null
}

afterEach(() => {
  cleanup()
  cancel.mockClear()
})

describe('leaving the screen with the microphone open', () => {
  it('cancels the recording that was running', async () => {
    const view = render(<Probe />)
    const started = act(async () => {
      const pending = toggle()
      release()
      await pending
    })
    await started
    expect(cancel).not.toHaveBeenCalled()
    view.unmount()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('cancels a recording whose permission answers after the screen was left', async () => {
    const view = render(<Probe />)
    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = toggle()
    })
    view.unmount()
    await act(async () => {
      release()
      await pending
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
