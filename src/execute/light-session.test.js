// UD-295, KAIROS-PARA-TEAM-PLATFORM.md of the host §6: what a direct fix on the area's light model gets that the others do not. A smaller prompt with its guards in the last
// block, the paths it will probably touch and the tools it needs, and hooks that enforce what must always hold; the larger model gets the short map; only level 1 closes alone.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadConfig } from '../config.js'
import { buildExecuteParts } from './prompt.js'
import { claudeArgs, sessionSettings } from './handler.js'
import { refuseCommand } from '../../scripts/team.mjs'

const input = (extra = {}) => ({
  message: { id: 1, title: 't', body: 'b', fields: {}, area: 'A', status: 'open' }, template: { body_markdown: '# Plantilla' },
  author: { name: 'Ana', profile: 'p', language: 'es-419' }, agent: { name: 'Claude', profile: 'Perfil' }, project: { name: 'P', description: 'D' },
  jobId: 1, maxSubagents: 3, branch: 'tp/1', hostInstructions: 'Reglas del anfitrión', deliver: true, ...extra
})

describe('prompt of a direct fix on a light model', () => {
  it('is a fraction of the full one and keeps the duties, the template and the host rules', () => {
    const full = buildExecuteParts(input()).stable
    const light = buildExecuteParts(input({ compact: true })).stable
    assert.ok(light.length < full.length * 0.5, `${light.length} against ${full.length}`)
    for (const piece of ['not_mine', 'needs_decision', 'decision_check', '`summary`', 'Reglas del anfitrión', '<template>', 'team reply']) assert.ok(light.includes(piece), piece)
  })

  it('ends with the guards that have a mechanism, in one block, and the full prompt does not carry it', () => {
    const light = buildExecuteParts(input({ compact: true }))
    assert.match(light.variable.trimEnd().split('\n').at(-3) + light.variable.trimEnd().split('\n').at(-2), /limits|never push|Push only/i)
    assert.ok(!buildExecuteParts(input()).variable.includes('<limits>'))
  })
})

describe('the invocation of a light session', () => {
  const x = { ...loadConfig({ DATA_DIR: '/tmp/x' }).execute, model: 'claude-haiku-5-5', budgetUsd: 1 }
  const flag = (args, name) => args[args.indexOf(name) + 1]

  it('restricts the tools and declares the hooks only for a session on the light model', () => {
    const light = claudeArgs({ ...x, maxTurns: 0 }, {}, { light: true, assessed: true })
    assert.equal(flag(light, '--tools'), 'Bash,Read,Edit,Write,Grep,Glob,Agent')
    const plain = claudeArgs(x, {}, {})
    assert.ok(!plain.includes('--tools'))
    assert.deepEqual(Object.keys(JSON.parse(flag(plain, '--settings')).hooks), ['PostToolBatch'])
    assert.ok(!light.includes('--max-turns'), 'no cap on steps: only the budget governs (UD-283)')
  })

  it('light: the brief map at the start, the guard before every Bash call, and the host check at the end when it declares one', () => {
    const hooks = sessionSettings({ light: true, assessed: true, stopCommand: 'bash check.sh' }).hooks
    assert.equal(hooks.SessionStart[0].hooks[0].command, 'team map --hook --brief')
    assert.deepEqual([hooks.PreToolUse[0].matcher, hooks.PreToolUse[0].hooks[0].command], ['Bash', 'team guard'])
    assert.equal(hooks.Stop[0].hooks[0].command, 'bash check.sh')
    assert.ok(!sessionSettings({ light: true }).hooks.Stop, 'no host command, no Stop hook')
  })

  it('a larger model gets the whole map only when the analyzer assessed the message; without it, the hooks of before', () => {
    assert.equal(sessionSettings({ assessed: true }).hooks.SessionStart[0].hooks[0].command, 'team map --hook')
    assert.deepEqual(Object.keys(sessionSettings({}).hooks), ['PostToolBatch'])
  })

  it('the session of a light model gets no limit that cuts it: no default environment, no step cap', () => {
    assert.deepEqual(loadConfig({ DATA_DIR: '/tmp/x' }).execute.directSessionEnv, {})
    assert.equal(loadConfig({ DATA_DIR: '/tmp/x', EXECUTE_DIRECT_SESSION_ENV: 'BASH_MAX_OUTPUT_LENGTH=5000' }).execute.directSessionEnv.BASH_MAX_OUTPUT_LENGTH, '5000')
  })
})

describe('team guard', () => {
  it('refuses a push to main or master and a forced push, and lets the branch of the job through', () => {
    for (const c of ['git push origin main', 'git push origin HEAD:main', 'git -C x push origin master', 'git push --force origin tp/5', 'git push -f', 'echo a && git push origin main']) assert.ok(refuseCommand(c), c)
    for (const c of ['git push -u origin tp/5', 'git commit -m "push to main"', 'echo hi && git push origin tp/5', 'npm test']) assert.equal(refuseCommand(c), null, c)
  })
})
