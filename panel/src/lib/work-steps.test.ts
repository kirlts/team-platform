// The work of the agent by stretch: the machine, the session and the delivery take their state from the job status and the phase of the timing.
import { describe, expect, it } from 'vitest'
import type { MessageTiming } from '@team-platform/client'
import { stepOfPhase, workSteps } from './work-steps'

const base: MessageTiming = {
  message_id: '7', job_id: '3', job_status: 'running', trace_id: null, phase: null, elapsed_ms: null,
  first_reply_ms: null, final_reply_ms: null, total_ms: null, queue_wait_ms: null, phases: [], slowest: [], tree: null,
}
const phase = (name: string, duration_ms: number, status = 'unset') => ({ name, duration_ms, offset_ms: null, status })
const states = (d: MessageTiming, retry: 'publish' | 'work' | null = null) => workSteps(d, retry).steps.map((s) => `${s.key}:${s.state}`)

describe('stepOfPhase', () => {
  it('puts the transcript copy and the machine destruction in the session, and every delivery phase in the delivery', () => {
    expect(['create', 'run', 'collect', 'destroy', 'deliverVerify', 'deliverDeploy', 'deliver', 'x', null].map(stepOfPhase)).toEqual(['machine', 'session', 'session', 'session', 'deliver', 'deliver', 'deliver', null, null])
  })
})

describe('workSteps', () => {
  it('a queued job shows the stretches the instance will run, all pending', () => {
    const w = workSteps({ ...base, job_status: 'queued', machine: true, delivers: true })
    expect(w.state).toBe('queued')
    expect(w.steps.map((s) => `${s.key}:${s.state}`)).toEqual(['machine:pending', 'session:pending', 'deliver:pending'])
  })

  it('without a declared machine or delivery, only the stretches the job has reached show', () => {
    expect(states({ ...base, job_status: 'queued' })).toEqual(['session:pending'])
    expect(states({ ...base, job_status: 'queued', machine: false, delivers: false })).toEqual(['session:pending'])
  })

  it('on the machine with a declared delivery: the session and the delivery wait', () => {
    expect(states({ ...base, phase: 'create', elapsed_ms: 1000, machine: true, delivers: true })).toEqual(['machine:running', 'session:pending', 'deliver:pending'])
  })

  it('on the machine: it runs, the session waits, and the time is the elapsed one', () => {
    const w = workSteps({ ...base, phase: 'create', elapsed_ms: 12000, phases: [] })
    expect(w.steps.map((s) => `${s.key}:${s.state}`)).toEqual(['machine:running', 'session:pending'])
    expect(w.steps[0]!.ms).toBe(12000)
  })

  it('in the session: the machine is done with its time, the session runs', () => {
    const w = workSteps({ ...base, phase: 'run', elapsed_ms: 300000, phases: [phase('create', 95000)] })
    expect(w.steps.map((s) => `${s.key}:${s.state}`)).toEqual(['machine:done', 'session:running'])
    expect(w.steps[0]!.ms).toBe(95000)
  })

  it('while the delivery runs, the machine and the session are done', () => {
    const w = workSteps({ ...base, phase: 'deliverVerify', elapsed_ms: 5000, phases: [phase('create', 1000), phase('run', 2000), phase('collect', 300), phase('destroy', 200)], deliver: { job_id: '4', job_status: 'running', phase: 'deliverVerify', attempts: 1 } })
    expect(states({ ...base, phase: 'deliverVerify', elapsed_ms: 5000, phases: [phase('create', 1000), phase('run', 2000), phase('collect', 300), phase('destroy', 200)], deliver: { job_id: '4', job_status: 'running', phase: 'deliverVerify', attempts: 1 } })).toEqual(['machine:done', 'session:done', 'deliver:running'])
    expect(w.steps[1]!.ms).toBe(2500)
  })

  it('a session without a machine (local runner) has no machine stretch', () => {
    expect(states({ ...base, phase: 'run', phases: [] })).toEqual(['session:running'])
  })

  it('a failed job stops where its phase has the error; a work retry repeats every stretch', () => {
    const d = { ...base, job_status: 'failed', phases: [phase('create', 95000), phase('run', 1000, 'error')] }
    expect(states(d)).toEqual(['machine:done', 'session:failed'])
    expect(workSteps(d, 'work').steps.map((s) => s.repeats)).toEqual([true, true])
  })

  it('a failed delivery keeps the work: a publish retry repeats only the delivery', () => {
    const d = { ...base, job_status: 'done', phases: [phase('create', 1000), phase('run', 2000), phase('deliver', 900, 'error')], deliver: { job_id: '4', job_status: 'failed', phase: null, attempts: 1 } }
    const w = workSteps(d, 'publish')
    expect(w.state).toBe('failed')
    expect(w.steps.map((s) => `${s.key}:${s.state}:${s.repeats}`)).toEqual(['machine:done:false', 'session:done:false', 'deliver:failed:true'])
  })

  it('a publish retry after a failed session shows the delivery it will run, and the failed stretches are not repeated', () => {
    const d = { ...base, job_status: 'failed', phases: [phase('create', 1000), phase('run', 2000, 'error')] }
    expect(workSteps(d, 'publish').steps.map((s) => `${s.key}:${s.state}:${s.repeats}`)).toEqual(['machine:done:false', 'session:failed:false', 'deliver:pending:true'])
  })

  it('without a retry nothing says what repeats', () => {
    expect(workSteps({ ...base, job_status: 'failed', phases: [phase('run', 1, 'error')] }).steps.every((s) => s.repeats === null)).toBe(true)
  })

  it('a finished job is done in every stretch', () => {
    expect(states({ ...base, job_status: 'done', phases: [phase('create', 1), phase('run', 2)] })).toEqual(['machine:done', 'session:done'])
  })
})
