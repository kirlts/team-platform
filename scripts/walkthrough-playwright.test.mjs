// Where `team walkthrough` finds the host's Playwright: no directory name of a host is written in the search, and a subproject of the branch is found.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { loadPlaywright } from './walkthrough.mjs'

describe('loadPlaywright', () => {
  const root = mkdtempSync(join(tmpdir(), 'walkthrough-playwright-'))
  after(() => rmSync(root, { recursive: true, force: true }))

  function fakePlaywright (base, marker) {
    const dir = join(base, 'node_modules', 'playwright')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'playwright', main: 'index.js' }))
    writeFileSync(join(dir, 'index.js'), `module.exports = { marker: ${JSON.stringify(marker)} }`)
  }

  it('finds the copy of a first-level subproject of the working directory, whatever its name', () => {
    const repo = join(root, 'repo')
    mkdirSync(join(repo, 'docs'), { recursive: true })
    fakePlaywright(join(repo, 'any-subproject'), 'subproject')
    assert.equal(loadPlaywright({ HOME: join(root, 'home') }, repo)?.marker, 'subproject')
  })

  it('TEAM_PLAYWRIGHT_DIR rules over what the working directory carries', () => {
    const declared = join(root, 'declared')
    fakePlaywright(declared, 'declared')
    assert.equal(loadPlaywright({ TEAM_PLAYWRIGHT_DIR: declared, HOME: join(root, 'home') }, join(root, 'repo'))?.marker, 'declared')
  })

  it('null when nothing has it', () => {
    const empty = join(root, 'empty')
    mkdirSync(empty, { recursive: true })
    assert.equal(loadPlaywright({ HOME: join(root, 'nohome') }, empty), null)
  })
})
