// A5: the Equipo tab does not jump or reload when it is clicked, and it keeps the heading hierarchy of the kit.
// «Jump» is measured: the vertical position of the side navigation and of the rows of members before and after each click; «reload» is a document
// request or the loss of a mark set on `window` before the click.
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { harness, settled } from './harness.mjs'

let h
before(async () => { h = await harness() })

/** The top of each visible element matching `selector`. */
const tops = (page, selector) => page.locator(selector).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top * 10) / 10))

async function watch (page) {
  const documents = []
  page.on('request', (r) => { if (r.resourceType() === 'document') documents.push(r.url()) })
  await page.evaluate(() => { window.__markA5 = 'alive' })
  return documents
}
const alive = (page) => page.evaluate(() => window.__markA5 === 'alive')

describe('A5: the Equipo tab does not jump or reload', () => {
  test('A5: clicking «Equipo» in the side navigation changes the screen without a document request, and the navigation does not move', async () => {
    const { page, context } = await h.open('ana')
    try {
      await page.goto(h.origin)
      await page.locator('main#main').waitFor()
      await settled(page)
      const documents = await watch(page)
      const before = await tops(page, '[data-testid=sidebar] a')
      await page.getByTestId('sidebar').getByRole('link', { name: 'Equipo', exact: true }).click()
      await page.getByRole('heading', { level: 1, name: 'Equipo' }).waitFor()
      await settled(page)
      assert.equal(await alive(page), true, 'A5: the page was reloaded by the click on Equipo')
      assert.deepEqual(documents, [], `A5: the click requested documents: ${documents.join(', ')}`)
      assert.deepEqual(await tops(page, '[data-testid=sidebar] a'), before, 'A5: the side navigation moved when Equipo opened')
      assert.equal(await page.evaluate(() => window.scrollY), 0, 'A5: the page scrolled')
      // Clicking it again, already there, changes nothing either.
      await page.getByTestId('sidebar').getByRole('link', { name: 'Equipo', exact: true }).click()
      await settled(page)
      assert.equal(await alive(page), true, 'A5: clicking Equipo again reloaded the page')
      assert.deepEqual(await tops(page, '[data-testid=sidebar] a'), before, 'A5: the side navigation moved on the second click')
    } finally { await context.close() }
  })

  test('A5: inside Equipo, opening the actions of a member and the profile of another does not reload or move the rows', async () => {
    const { page, context } = await h.open('ana')
    try {
      await page.goto(`${h.origin}/team`)
      await page.getByRole('button', { name: 'Agregar miembro' }).waitFor()
      await settled(page)
      const documents = await watch(page)
      const rows = 'main div.border-b'
      const before = await tops(page, rows)
      assert.ok(before.length >= 4, 'A5: Equipo shows fewer members than the team has')
      await page.getByRole('button', { name: 'Acciones de Bruno Miembro' }).click()
      await page.getByRole('menu').waitFor()
      assert.deepEqual(await tops(page, rows), before, 'A5: the rows moved when the actions menu opened')
      await page.keyboard.press('Escape')
      await page.getByRole('menu').waitFor({ state: 'detached' })
      await page.getByRole('button', { name: 'Perfil de Carla Miembro' }).click()
      await page.getByRole('dialog').waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      await settled(page)
      assert.deepEqual(await tops(page, rows), before, 'A5: the rows moved after opening and closing a profile')
      assert.equal(await alive(page), true, 'A5: a click inside Equipo reloaded the page')
      assert.deepEqual(documents, [], `A5: a click inside Equipo requested documents: ${documents.join(', ')}`)
    } finally { await context.close() }
  })

  test('A5: Equipo has one h1, no heading level jumps, and one main region', async () => {
    const { page, context } = await h.open('ana')
    try {
      await page.goto(`${h.origin}/team`)
      await page.getByRole('button', { name: 'Agregar miembro' }).waitFor()
      await settled(page)
      const levels = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((e) => Number(e.tagName[1])))
      assert.equal(levels.filter((l) => l === 1).length, 1, `A5: ${levels.filter((l) => l === 1).length} h1 in Equipo`)
      assert.equal(levels[0], 1, 'A5: the first heading is not the h1')
      levels.forEach((l, i) => { if (i > 0) assert.ok(l <= levels[i - 1] + 1, `A5: heading level jumps from h${levels[i - 1]} to h${l}`) })
      assert.equal(await page.locator('main').count(), 1, 'A5: more than one main region')
    } finally { await context.close() }
  })
})
