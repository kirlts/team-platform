// A2: only the Editor changes the models of an area, in the interface and in the API (403 for anyone else, nothing saved).
// The Areas screen is closed to a member altogether (it says only the Editor administers areas), so «reads as text» holds as «cannot reach a selector».
// The API half is also covered by src/api/area-model-editor.test.js (403 for each field); this adds what the person sees.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

/** The area as the list of areas gives it (there is no route for one area). */
const areaOf = async (id) => { const l = (await h.api('ana').get('/areas')).data; return (Array.isArray(l) ? l : l.items).find((a) => String(a.id) === String(id)) }
const newArea = async () => (await h.api('ana').post('/areas', { title: h.unique('A2 área'), description: 'Área para los modelos' })).data

describe('A2: the models of an area belong to the Editor', () => {
  test('A2: ana (Editor) sees both selectors, changes the light model in the interface and it is saved', async () => {
    const area = await newArea()
    const { page, context } = await h.open('ana')
    try {
      await page.goto(`${h.origin}/areas/${area.id}`)
      const light = page.getByTestId('area-execute-model-light-select')
      await light.waitFor()
      assert.equal(await page.getByTestId('area-execute-model-select').count(), 1, 'A2: the Editor does not see the selector of the larger model')
      const options = await light.locator('option').evaluateAll((els) => els.map((e) => e.value))
      const current = await light.inputValue()
      const other = options.find((o) => o !== current)
      assert.ok(other, 'A2: the selector offers one model only')
      await light.selectOption(other)
      await settled(page)
      let saved = await areaOf(area.id)
      for (let i = 0; i < 50 && saved.execute_model_light !== other; i++) { await new Promise((r) => setTimeout(r, 40)); saved = await areaOf(area.id) }
      assert.equal(saved.execute_model_light, other, 'A2: the change of the Editor was not saved')
    } finally { await context.close() }
  })

  test('A2: bruno (member) has no selector of models anywhere in the area screen', async () => {
    const area = await newArea()
    const { page, context } = await h.open('bruno')
    try {
      await page.goto(`${h.origin}/areas/${area.id}`)
      await page.locator('main h1, main h2').first().waitFor()
      await settled(page)
      assert.equal(await page.getByTestId('area-execute-model-light-select').count(), 0, 'A2: a member sees the selector of the light model')
      assert.equal(await page.getByTestId('area-execute-model-select').count(), 0, 'A2: a member sees the selector of the larger model')
      assert.equal(await page.locator('main select').count(), 0, 'A2: a member sees a selector in the area screen')
    } finally { await context.close() }
  })

  test('A2: the API answers 403 to bruno for each model field, alone or with another field, and saves nothing', async () => {
    const area = await newArea()
    const before = await areaOf(area.id)
    for (const patch of [{ execute_model: 'claude-haiku-5-5' }, { execute_model_light: 'claude-sonnet-5-5' }, { description: 'otra', execute_model: 'claude-haiku-5-5' }]) {
      const res = await h.api('bruno').patch(`/areas/${area.id}`, patch)
      assert.equal(res.status, 403, `A2: a member changed ${Object.keys(patch)} (answer ${res.status})`)
    }
    const after = await areaOf(area.id)
    assert.equal(after.execute_model, before.execute_model)
    assert.equal(after.execute_model_light, before.execute_model_light)
    assert.equal(after.description, before.description)
  })
})
