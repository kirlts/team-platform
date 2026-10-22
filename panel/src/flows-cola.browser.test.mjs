// UD-251: «Cola» and «Auditoría» in Configuración, and the summary under «Telemetría de uso». The Editor sees the sends of
// everybody, reprocesses one, opens a trace, deletes a send of someone else and purges the finished jobs with one click and no
// step that confirms it (UD-253); the log shows that purge. A member sees none of it. Against dev-server.mjs serving panel/dist: `npm run test:flows`.
import assert from 'node:assert'
import { after, before, beforeEach, describe, test } from 'node:test'
import { login, settled, startPanel } from './browser-support.mjs'

process.env.PANEL_DEV_AUTO_PUBLISH = '0'

let panel
let origin = ''

before(async () => {
  panel = await startPanel(Number(process.env.PANEL_FLOWS_COLA_PORT ?? 8473), { stepMs: 40 })
  origin = panel.origin
})

beforeEach(async () => {
  await panel.control.reset()
})

after(async () => {
  await panel?.stop()
})

const DESKTOP = { width: 1440, height: 900 }

async function session(who, path = '/settings') {
  const context = await panel.browser.newContext({ viewport: DESKTOP, locale: 'es-CL', colorScheme: 'light' })
  const page = await context.newPage()
  await login(page, origin, who)
  await page.goto(`${origin}${path}`)
  await page.getByRole('heading', { name: 'Cuenta' }).waitFor()
  await settled(page)
  return { page, context }
}

/** Sends from another member's session, through the API like the panel does. */
async function sendAs(who, texts) {
  const context = await panel.browser.newContext({ viewport: DESKTOP, locale: 'es-CL' })
  const page = await context.newPage()
  await login(page, origin, who)
  try {
    for (const text of texts) {
      const res = await page.request.post(`${origin}/api/inputs`, { headers: { 'x-team-request': 'panel' }, multipart: { text } })
      assert.ok(res.ok(), `the send of ${who} was accepted`)
    }
  } finally {
    await context.close()
  }
}

/** Waits, inside the page, until every send has left the analysis. */
const analysed = (page) =>
  page.waitForFunction(async () => {
    const list = (await (await fetch('/api/inputs?all=1')).json()).items
    return list.length > 0 && list.every((i) => ['proposed', 'failed', 'published'].includes(i.status))
  })

const row = (section, name) => section.locator('[data-queue-row]').filter({ hasText: name })

describe('Configuración, Cola y Auditoría (UD-251)', () => {
  test('a member does not see the sections nor the list of everybody', async () => {
    const { page, context } = await session('bruno')
    try {
      assert.equal(await page.locator('[data-queue]').count(), 0)
      assert.equal(await page.locator('[data-audit]').count(), 0)
      assert.equal(await page.getByRole('heading', { name: 'Cola' }).count(), 0)
      const status = await page.evaluate(async () => (await fetch('/api/inputs?all=1')).status)
      assert.equal(status, 403)
    } finally {
      await context.close()
    }
  })

  test('the Editor sees the sends of others with sender, state and counts', async () => {
    await sendAs('carla', ['Primer envío de Carla'])
    await sendAs('diego', ['Envío de Diego [simular falla]'])
    const { page, context } = await session('ana')
    try {
      await analysed(page)
      await page.reload()
      const queue = page.locator('[data-queue]')
      await queue.waitFor()
      await queue.getByText('Envíos de todos, estado de los trabajos y traza del análisis').waitFor()
      await row(queue, 'Carla Prueba').waitFor()
      assert.match(await row(queue, 'Carla Prueba').locator('[data-queue-state]').innerText(), /Para revisar/)
      assert.match(await row(queue, 'Diego Prueba').locator('[data-queue-state]').innerText(), /Fallido/)
      assert.equal(await queue.locator('[data-job-count="failed"]').innerText(), '2', 'the failed send and the older failed job')
      assert.equal(await queue.locator('[data-job-count="running"]').innerText(), '0')
      for (const name of ['Reprocesar', 'Borrar', 'Traza']) assert.ok((await row(queue, 'Carla Prueba').getByRole('button', { name, exact: true }).count()) === 1, name)
    } finally {
      await context.close()
    }
  })

  test('reprocess takes a failed send of someone else back to the proposal and the log records it', async () => {
    await sendAs('diego', ['Envío de Diego [simular falla]'])
    const { page, context } = await session('ana')
    try {
      await analysed(page)
      await page.reload()
      const queue = page.locator('[data-queue]')
      const diego = row(queue, 'Diego Prueba')
      await diego.getByRole('button', { name: 'Reprocesar' }).click()
      await diego.locator('[data-queue-state]').getByText('Para revisar').waitFor()
      await settled(page)
      const audit = page.locator('[data-audit]')
      await audit.locator('[data-audit-row="input.reprocess"]').waitFor()
      assert.match(await audit.locator('[data-audit-row="input.reprocess"]').innerText(), /Ana Prueba/)
    } finally {
      await context.close()
    }
  })

  test('the trace opens as a tree with duration, tokens and cost; a send still queued has none', async () => {
    await sendAs('carla', ['Envío con traza'])
    const { page, context } = await session('ana')
    try {
      await analysed(page)
      await page.reload()
      const queue = page.locator('[data-queue]')
      const carla = row(queue, 'Carla Prueba')
      await carla.getByRole('button', { name: 'Traza' }).click()
      const trace = carla.locator('[data-trace]')
      await trace.waitFor()
      await trace.locator('[data-span="llm.split_messages"]').waitFor()
      const text = await trace.innerText()
      assert.match(text, /Entrada/)
      assert.match(text, /Costo/)
      assert.match(text, /US\$ 0\.\d{4}/)
      assert.match(await trace.locator('[data-span="job.analyze"]').innerText(), /\d+(\.\d)? s/)
      await carla.getByRole('button', { name: 'Traza' }).click()
      assert.equal(await carla.locator('[data-trace]').count(), 0, 'the same button closes it')

      await panel.control.hold()
      await sendAs('diego', ['Envío que espera'])
      await page.reload()
      const diego = row(page.locator('[data-queue]'), 'Diego Prueba')
      await diego.getByRole('button', { name: 'Traza' }).click()
      await diego.locator('[data-trace-none]').getByText('Sin traza').waitFor()
      await panel.control.release()
    } finally {
      await context.close()
    }
  })

  test('the Editor deletes a send of someone else with one click, no step that confirms it', async () => {
    await sendAs('carla', ['Para borrar'])
    const { page, context } = await session('ana')
    try {
      await analysed(page)
      await page.reload()
      const queue = page.locator('[data-queue]')
      const carla = row(queue, 'Carla Prueba')
      await carla.getByRole('button', { name: 'Borrar', exact: true }).click()
      await page.locator('[data-notice]').getByText('Envío borrado', { exact: true }).waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0, 'no window over the page')
      await carla.waitFor({ state: 'detached' })
      assert.equal(await page.evaluate(async () => (await (await fetch('/api/inputs?all=1')).json()).total), 0)
    } finally {
      await context.close()
    }
  })

  test('purging asks for the state, empties it with one click and leaves a row in the log', async () => {
    await sendAs('carla', ['Uno', 'Dos'])
    const { page, context } = await session('ana')
    try {
      await analysed(page)
      await page.reload()
      const queue = page.locator('[data-queue]')
      const done = queue.locator('[data-job-count="done"]')
      await page.waitForFunction(() => Number(document.querySelector('[data-job-count="done"]')?.textContent) >= 4)
      await queue.getByLabel('Estado a purgar').selectOption('done')
      await queue.getByRole('button', { name: 'Purgar' }).click()
      await queue.locator('[data-purged]').waitFor()
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(await queue.getByRole('button', { name: 'Cancelar' }).count(), 0, 'no step that confirms it')
      await settled(page)
      assert.equal(await done.innerText(), '0')
      assert.match(await queue.locator('[data-purged]').innerText(), /\d+ purgados/)
      const entry = page.locator('[data-audit-row="jobs.purge"]')
      await entry.waitFor()
      assert.match(await entry.innerText(), /Ana Prueba/)
      assert.match(await entry.innerText(), /state done/)
    } finally {
      await context.close()
    }
  })

  test('the log filters by action and starts with the newest entry', async () => {
    const { page, context } = await session('ana')
    try {
      const audit = page.locator('[data-audit]')
      await audit.waitFor()
      await audit.getByText('Cambios hechos en la plataforma, del más reciente al más antiguo').waitFor()
      const first = await audit.locator('[data-audit-row]').first().getAttribute('data-audit-row')
      assert.equal(first, 'settings.telemetry', 'the seeded entries come newest first')
      await audit.getByLabel('Acción').selectOption('area.create')
      await settled(page)
      const actions = await audit.locator('[data-audit-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-audit-row')))
      assert.deepEqual(actions, ['area.create'])
      await audit.getByLabel('Acción').selectOption('member.password')
      await audit.getByText('Sin registros').waitFor()
    } finally {
      await context.close()
    }
  })

  test('the usage summary shows next to the switch only while it is on', async () => {
    const { page, context } = await session('ana')
    try {
      await page.getByRole('radio', { name: 'Apagada' }).check().catch(() => undefined)
      const apagada = page.getByRole('radio', { name: 'Apagada' })
      if (!(await apagada.isChecked())) await apagada.click()
      await settled(page)
      assert.equal(await page.locator('[data-ui-summary]').count(), 0)
      await page.getByRole('radio', { name: 'Encendida' }).click()
      await page.locator('[data-ui-summary]').waitFor()
      await page.getByRole('radio', { name: 'Apagada' }).click()
      await page.locator('[data-ui-summary]').waitFor({ state: 'detached' })
    } finally {
      await context.close()
    }
  })
})
