// M8: the microphone works in the interface. It failed on the host site: the page was served in a way that denied the permission.
// Two halves: what the server says about the microphone in the headers of the panel, and what the person gets: «Grabar audio» records and leaves an audio.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

/** The directive of a policy header for `feature`, or null when the header does not name it. */
const directive = (policy, feature) => String(policy ?? '').split(/[,;]/).map((x) => x.trim()).find((x) => x.startsWith(`${feature}=`) || x.startsWith(`${feature} `)) ?? null

describe('M8: the microphone is available in the panel', () => {
  test('M8: no header of the panel document forbids the microphone, and the browser agrees', async () => {
    for (const route of ['/', '/messages/1']) {
      const res = await fetch(`${h.origin}${route}`, { headers: { accept: 'text/html' } })
      for (const header of ['permissions-policy', 'feature-policy']) {
        const mic = directive(res.headers.get(header), 'microphone')
        assert.ok(mic === null || !/=\s*\(\s*\)/.test(mic) && !/'none'/.test(mic), `M8: ${route} answers ${header}: ${mic}, which forbids the microphone`)
      }
    }
    const { page, context } = await h.open('ana', { permissions: ['microphone'] })
    try {
      await page.goto(h.origin)
      await page.locator('main#main').waitFor()
      // Some Chromium builds expose the policy object under its old name or not at all: the check runs where the browser can answer it.
      const allowed = await page.evaluate(() => (document.permissionsPolicy ?? document.featurePolicy)?.allowsFeature('microphone') ?? null)
      assert.notEqual(allowed, false, 'M8: the browser says the page may not use the microphone')
    } finally { await context.close() }
  })

  test('M8: «Grabar audio» records, «Detener grabación» leaves an audio, and the reply carries it', async () => {
    const id = await h.message(h.unique('M8 micrófono'), { as: 'bruno', recipients: ['carla'] })
    const { page, context } = await h.open('ana', { permissions: ['microphone'] })
    try {
      await page.goto(`${h.origin}/messages/${id}`)
      await page.locator('main h1').waitFor()
      await settled(page)
      await page.getByRole('button', { name: 'Grabar audio' }).click()
      const status = page.getByRole('status', { name: 'Grabando audio' })
      await status.waitFor()
      await page.waitForFunction(() => /0?0:0[1-9]/.test(document.querySelector('[role=status][aria-label="Grabando audio"]')?.textContent ?? ''))
      await page.getByRole('button', { name: 'Detener grabación' }).click()
      await status.waitFor({ state: 'detached' })
      assert.equal(await page.getByRole('alert').filter({ hasText: /micrófono|grab/i }).count(), 0, 'M8: the interface reported a problem with the microphone')
      // The server's answer to the reply is the event to wait for: reading the API right after the click raced the request.
      const sent = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/messages\/[^/]+\/replies$/.test(new URL(r.url()).pathname))
      await page.getByRole('button', { name: 'Responder', exact: true }).click()
      await sent
      const reply = await h.api('ana').get(`/messages/${id}`).then((r) => r.data.replies.at(-1))
      assert.ok(reply, 'M8: the recorded reply was not sent')
      assert.equal(reply.attachments?.[0]?.kind, 'audio', `M8: the reply has no audio (${JSON.stringify(reply.attachments)})`)
    } finally { await context.close() }
  })
})
