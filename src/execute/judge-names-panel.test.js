// The panel names each indicator of the judgement by its id (the API sends only the id): its catalog must say what the judge calls it, or the sheet shows a name the judge no longer uses.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { KPIS } from './judge.js'

const catalog = readFileSync(new URL('../../panel/src/i18n/es-419.ts', import.meta.url), 'utf8')

test('the Spanish catalog of the panel names every indicator of the judge as the judge does', () => {
  const named = Object.fromEntries([...catalog.matchAll(/'judgment\.kpi\.(\d\.\d)': '([^']*)'/g)].map((m) => [m[1], m[2]]))
  assert.deepEqual(named, Object.fromEntries(KPIS.map((k) => [k.id, k.name])))
})
