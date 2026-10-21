import { describe, expect, it } from 'vitest'
import { createUndoCore, type UndoOp } from './undo'

function counter() {
  const log: string[] = []
  const op = (name: string): UndoOp => ({ label: name, undo: () => void log.push(`undo ${name}`), redo: () => void log.push(`do ${name}`) })
  return { log, op }
}

describe('undo core', () => {
  it('runs the change, then undoes and redoes it in order', async () => {
    const { log, op } = counter()
    const core = createUndoCore()
    await core.run(op('a'))
    await core.run(op('b'))
    await core.undo()
    await core.undo()
    await core.redo()
    expect(log).toEqual(['do a', 'do b', 'undo b', 'undo a', 'do a'])
    expect(core.past.map((o) => o.label)).toEqual(['a'])
    expect(core.future.map((o) => o.label)).toEqual(['b'])
  })

  it('a new operation clears what could be redone', async () => {
    const { op } = counter()
    const core = createUndoCore()
    await core.run(op('a'))
    await core.undo()
    expect(core.future).toHaveLength(1)
    await core.run(op('c'))
    expect(core.future).toHaveLength(0)
  })

  it('does nothing when there is nothing to undo or redo', async () => {
    const core = createUndoCore()
    await core.undo()
    await core.redo()
    expect(core.past).toHaveLength(0)
  })

  it('a change that fails is not recorded and a failed undo stays undoable', async () => {
    const core = createUndoCore()
    await expect(core.run({ label: 'x', undo: () => {}, redo: () => Promise.reject(new Error('no')) })).rejects.toThrow('no')
    expect(core.past).toHaveLength(0)
    let fail = true
    await core.run({ label: 'y', undo: () => (fail ? Promise.reject(new Error('no')) : undefined), redo: () => {} })
    await expect(core.undo()).rejects.toThrow('no')
    expect(core.past).toHaveLength(1)
    fail = false
    await core.undo()
    expect(core.past).toHaveLength(0)
  })
})
