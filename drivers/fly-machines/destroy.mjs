// EXECUTE_MACHINE_DESTROY of the fly-machines driver. See destroy.sh.
import { DriverError, call, errorText, findMachine, isMachineOfJob, loadSettings, machineName, main } from './lib/fly.mjs'

await main(async () => {
  const [job, , machine] = process.argv.slice(2)
  if (!job) throw new DriverError('usage: destroy.sh <job_id> <workdir> <machine>')
  const s = loadSettings()
  if (machine && !isMachineOfJob(s, job, machine)) throw new DriverError(`not a machine of this driver: ${machine}`)
  const mine = await findMachine(s, job)
  if (!mine) { console.error(`${machineName(s, job)} does not exist`); return }
  const res = await call(s, 'DELETE', `/v1/apps/${encodeURIComponent(s.app)}/machines/${mine.id}?force=true`)
  // 404: it was removed between the listing and the call (auto_destroy, or another destroy): that is the goal.
  if (res.status !== 200 && res.status !== 404) throw new DriverError(`destroying ${mine.name}: HTTP ${res.status}: ${errorText(res)}`)
  console.error(`${mine.name} destroyed`)
})
