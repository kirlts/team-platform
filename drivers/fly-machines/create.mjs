// EXECUTE_MACHINE_CREATE of the fly-machines driver. See create.sh for the contract.
import { ALIVE_STATES, DRIVER_LABEL, DriverError, NotNow, call, errorText, findMachine, listMachines, loadSettings, machineName, main, safeJob } from './lib/fly.mjs'

// A refusal of Fly for lack of resources, as opposed to a request that is wrong. The Machines API documents no status for it (create machine,
// docs.fly.io, consulted 2026-10-26: «can fail when a region is at capacity»); the forum reports the text «insufficient resources» / «could not reserve resource»
// with HTTP 412. 429 and 503 are not-now by their own meaning. Anything else is a permanent fault: retrying a wrong image does not fix it.
const CAPACITY_TEXT = /insufficient|capacity|could not reserve resource|no (?:available|capacity)/i
export function isNotNow (status, text) {
  return status === 429 || status === 503 || ((status === 412 || status === 409 || status === 422) && CAPACITY_TEXT.test(text))
}

await main(async () => {
  const [job, workdir] = process.argv.slice(2)
  if (!job || !workdir) throw new DriverError('usage: create.sh <job_id> <workdir>')
  const s = loadSettings()
  if (!s.image) throw new DriverError('TP_FLY_IMAGE is not set: the image of the machine (see drivers/fly-machines/Dockerfile)')
  const name = machineName(s, job)
  if (!/^tp-[a-z0-9]+-job-[a-z0-9][a-z0-9-]*$/.test(name)) throw new DriverError(`job id without valid characters: ${job}`)

  const mine = await findMachine(s, job)
  if (mine && ALIVE_STATES.has(mine.state)) { console.log(name); return }
  // A machine of this job that is not alive (it stopped and was not removed): it is retired so that the name is free.
  if (mine) await call(s, 'DELETE', `/v1/apps/${encodeURIComponent(s.app)}/machines/${mine.id}?force=true`)

  if (s.maxMachines) {
    const alive = (await listMachines(s, { team_platform_driver: DRIVER_LABEL, team_platform_instance: s.instance })).filter((m) => ALIVE_STATES.has(m.state)).length
    if (alive >= s.maxMachines) {
      console.error(`${alive} machines alive of ${s.maxMachines} allowed`)
      console.error(`##team quota machines=${s.maxMachines}`)
      throw new NotNow('the cap of machines is reached')
    }
  }

  const config = {
    image: s.image,
    // The machine ends by itself: `sleep` is its only process, the restart policy is `no` and `auto_destroy` removes it when the process ends (see MAX_LIFE_DEFAULT_S).
    init: { exec: ['sleep', String(s.maxLifeS)] },
    auto_destroy: true,
    restart: { policy: 'no' },
    guest: { cpu_kind: s.cpuKind, cpus: s.cpus, memory_mb: s.memoryMb },
    metadata: { team_platform_driver: DRIVER_LABEL, team_platform_instance: s.instance, team_platform_job: safeJob(job) }
  }
  const res = await call(s, 'POST', `/v1/apps/${encodeURIComponent(s.app)}/machines`, { name, ...(s.region ? { region: s.region } : {}), config })
  if (res.status !== 200 && res.status !== 201) {
    const text = errorText(res)
    if (isNotNow(res.status, text)) throw new NotNow(`Fly has no room now: HTTP ${res.status}: ${text}`)
    throw new DriverError(`creating the machine: HTTP ${res.status}: ${text}`)
  }
  const id = res.body.id
  console.error(`machine ${name} (${id}) created`)

  const waited = await call(s, 'GET', `/v1/apps/${encodeURIComponent(s.app)}/machines/${id}/wait?state=started&timeout=${s.startTimeoutS}`)
  if (waited.status !== 200) {
    // A machine that did not start is retired here: the worker does not know its name yet when create fails.
    await call(s, 'DELETE', `/v1/apps/${encodeURIComponent(s.app)}/machines/${id}?force=true`)
    const text = errorText(waited)
    if (isNotNow(waited.status, text)) throw new NotNow(`the machine did not start: HTTP ${waited.status}: ${text}`)
    throw new DriverError(`the machine did not start in ${s.startTimeoutS} s: HTTP ${waited.status}: ${text}`)
  }
  console.log(name)
})
