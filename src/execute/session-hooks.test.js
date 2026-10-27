// The hooks of the session that the host's guards file declares (EXECUTE_GUARDS_FILE): the command guard, the tool guard and the closing check. Each one is run as Claude Code
// runs it: `team hook <name>` with the event as JSON on stdin and the guards file named by TEAM_GUARDS_FILE, and what it answers is read from stdout and the exit code.
// The file below stands for a host: its rules are the kind a host writes (a deploy script it owns, a test runner it shares), and none belongs to the core.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../config.js'
import { BUILTIN_NAMES } from './hooks/common.mjs'
import { guardHooks, parseGuards } from './hooks/guards.js'
import { claudeArgs, sessionSettings } from './handler.js'

const TEAM = fileURLToPath(new URL('../../scripts/team.mjs', import.meta.url))
const scratch = []
const temp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); scratch.push(d); return d }
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }) })

// The shape of an event as Claude Code sends it to a command hook (https://code.claude.com/docs/en/hooks, read 2026-10-26).
const base = { session_id: 'a1b2c3', transcript_path: '/home/node/.claude/projects/-job/a1b2c3.jsonl', cwd: '/job/repo', permission_mode: 'bypassPermissions' }
const preToolUse = (tool_name, tool_input) => ({ ...base, hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id: 'toolu_01A' })
const bashEvent = (command) => preToolUse('Bash', { command, description: 'x' })
const stopEvent = (extra = {}) => ({ ...base, hook_event_name: 'Stop', stop_hook_active: false, ...extra })

// A host's file. Messages are the sentences the model reads when its call is refused.
const HOST = {
  commands: {
    builtin: ['forced-push', 'protected-push', 'no-verify', 'amend', 'add-all', 'stash', 'waiting'],
    protected_branches: ['main', 'release'],
    rules: [
      { id: 'deploy', match: 'deploy-now\\.sh|release-tool\\.py', message: 'Deploying is not done by this session.' },
      { id: 'install', match: '{START}npm\\s+(?:ci|install|i)(?=\\s|$|;|&|\\|)', message: 'Dependencies are already installed.' },
      { id: 'whole-suite', match: '{START}npm\\s+(?:run\\s+)?test(?=\\s|$|;|&|\\|)', message: 'The whole suite does not run in the session.' },
      { id: 'named-files', match: 'vitest\\s+run\\b([^;&|\\n]*)', args_required: true, message: 'Name the test files.' },
      { id: 'in-the-pool', match: ['(?:npx\\s+)?vitest\\s+run\\b|node\\s+--test\\b|npx\\s+playwright\\s+test\\b'], line_requires: 'pool run', message: 'Run it inside the shared pool: `pool run -- <the same command>`.' },
      { id: 'read-only', match: ['example\\.org', '\\s-X\\s*(?:POST|PUT|PATCH|DELETE)\\b|\\s(?:-d|--data\\S*|-F|--form)\\s'], unless: '/api/login', message: 'example.org is read only.' }
    ]
  },
  tools: {
    deny: [{ tools: ['Monitor', 'ReadNotifications', 'ListAgents'], message: 'This session does not watch.' }],
    deny_background: [{ tools: ['Agent', 'Task'], message: 'Run the subagent in the foreground.' }]
  },
  close: {
    clean_tree: true,
    pushed_branch: true,
    base: 'origin/main',
    review: {
      paths: '^app/screens/',
      except: '\\.test\\.',
      only: '^docs/',
      only_except: '\\.json$',
      trailer: 'Reviewed-by',
      not_by: ['Agent (Team Platform)'],
      message: 'The change needs the mark of a reviewer on the final tree: git commit --allow-empty -m "Mark" -m "Reviewed-by: reviewer-{job} {tree}"'
    }
  }
}

const withoutGit = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
function guardsFile (guards = HOST) {
  const file = join(temp('guards-'), 'guards.json')
  writeFileSync(file, JSON.stringify(guards))
  return file
}
/** Runs `team hook <name>` as the session does. Returns { status, answer (parsed stdout or null), stderr }. */
function hook (name, event, { guards = HOST, env = {} } = {}) {
  const r = spawnSync(process.execPath, [TEAM, 'hook', name], { input: JSON.stringify(event), encoding: 'utf8', env: { ...withoutGit(), ...(guards ? { TEAM_GUARDS_FILE: guardsFile(guards) } : {}), ...env } })
  return { status: r.status, answer: r.stdout.trim() ? JSON.parse(r.stdout) : null, stderr: r.stderr }
}
const denied = (r) => r.answer?.hookSpecificOutput?.permissionDecision === 'deny'
const reasonOf = (r) => r.answer?.hookSpecificOutput?.permissionDecisionReason

describe('command guard (team hook commands)', () => {
  const refuse = [
    'sleep 30', 'until curl -s localhost:3000; do sleep 5; done', 'watch git status',
    'bash tools/deploy-now.sh --urgent tp/12', 'python3 tools/release-tool.py',
    'git push --force origin tp/12', 'git push origin +tp/12', 'git push origin main', 'git push origin HEAD:release', 'git push origin refs/heads/main',
    'git commit --no-verify -m x', 'git commit --amend', 'git add -A', 'git add .', 'git stash',
    'npm ci', 'cd app && npm install', 'npm test', 'pool run -- npx vitest run', 'npx vitest run src/a.test.js',
    'node --test src/a.test.js', 'curl -X POST https://example.org/api/patients -d \'{}\''
  ]
  const allow = [
    'git push -u origin HEAD', 'git push origin tp/12', 'git add app/a.js', 'git commit -m "Fix the label"', 'git commit -m "push to main"',
    'pool run -- npx vitest run src/a.test.js src/b.test.js', 'pool run -- node --test src/a.test.js', 'cd app && node scripts/what-the-change-touches.mjs --range origin/main..HEAD',
    'timeout 590 node scripts/own-stack.mjs', 'curl -s https://example.org/api/agenda', 'curl -X POST https://example.org/api/login -d @credentials',
    'grep -rn "sleep" app/src', 'echo done; git push origin tp/12', 'npm run build'
  ]

  it('refuses every command of the list, with the reason of its rule', () => {
    for (const command of refuse) {
      const r = hook('commands', bashEvent(command))
      assert.equal(r.status, 0, command)
      assert.ok(denied(r), `let through: ${command}`)
      assert.equal(r.answer.hookSpecificOutput.hookEventName, 'PreToolUse')
      assert.ok(reasonOf(r)?.trim(), command)
    }
    assert.equal(reasonOf(hook('commands', bashEvent('python3 tools/release-tool.py'))), 'Deploying is not done by this session.')
    assert.match(reasonOf(hook('commands', bashEvent('git push origin release'))), /Pushing to main or release/)
  })

  it('lets the normal work through, with no output and exit code 0', () => {
    for (const command of allow) {
      const r = hook('commands', bashEvent(command))
      assert.deepEqual([r.status, r.answer], [0, null], `refused: ${command}`)
    }
  })

  it('does nothing for a tool that is not Bash, for an event it cannot read, and without a guards file', () => {
    assert.equal(hook('commands', preToolUse('Read', { file_path: '/a', command: 'sleep 30' })).answer, null)
    const r = spawnSync(process.execPath, [TEAM, 'hook', 'commands'], { input: 'not json', encoding: 'utf8', env: { ...withoutGit(), TEAM_GUARDS_FILE: guardsFile() } })
    assert.equal(r.status, 0)
    assert.equal(r.stdout, '')
    assert.equal(hook('commands', bashEvent('sleep 30'), { guards: null }).answer, null, 'no TEAM_GUARDS_FILE: the call goes through')
    assert.equal(hook('commands', bashEvent('sleep 30'), { guards: null, env: { TEAM_GUARDS_FILE: '/does/not/exist.json' } }).answer, null, 'an unreadable copy lets the call through')
  })

  it('a host that turns on no named rule gets only its own, and the default list of protected branches is main and master', () => {
    const only = { commands: { rules: [{ match: 'rm -rf /', message: 'never' }] } }
    assert.ok(denied(hook('commands', bashEvent('rm -rf /'), { guards: only })))
    assert.equal(hook('commands', bashEvent('git push --force origin main'), { guards: only }).answer, null)
    const named = { commands: { builtin: ['protected-push'] } }
    for (const branch of ['main', 'master']) assert.ok(denied(hook('commands', bashEvent(`git push origin ${branch}`), { guards: named })), branch)
    assert.equal(hook('commands', bashEvent('git push origin develop'), { guards: named }).answer, null)
  })
})

describe('tool guard (team hook tools)', () => {
  it('refuses the tools of the list and a subagent in the background; a subagent in the foreground goes through', () => {
    const background = hook('tools', preToolUse('Agent', { description: 'judge', prompt: 'judge it', run_in_background: true }))
    assert.equal(reasonOf(background), 'Run the subagent in the foreground.')
    assert.ok(denied(hook('tools', preToolUse('Task', { prompt: 'judge it', run_in_background: true }))))
    for (const tool of ['Monitor', 'ReadNotifications', 'ListAgents']) assert.equal(reasonOf(hook('tools', preToolUse(tool, {}))), 'This session does not watch.', tool)
    const foreground = hook('tools', preToolUse('Agent', { prompt: 'judge it' }))
    assert.deepEqual([foreground.status, foreground.answer], [0, null])
    assert.equal(hook('tools', preToolUse('Bash', { command: 'ls', run_in_background: true })).answer, null, 'the list names the tools it takes away')
    assert.equal(hook('tools', preToolUse('Monitor', {}), { guards: null }).answer, null)
  })
})

describe('closing check (team hook close)', () => {
  function repo () {
    const dir = temp('close-')
    const git = (...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: withoutGit() })
    git('init', '-q', '-b', 'tp/1')
    git('config', 'user.email', 'agent@example.test'); git('config', 'user.name', 'Agent (Team Platform)')
    mkdirSync(join(dir, 'app/screens'), { recursive: true }); mkdirSync(join(dir, 'docs'), { recursive: true })
    writeFileSync(join(dir, 'a'), '1'); git('add', 'a'); git('commit', '-qm', 'base')
    git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    const commit = (file, text = 'x') => { writeFileSync(join(dir, file), text); git('add', file); git('commit', '-qm', `change ${file}`) }
    const tree = () => git('rev-parse', 'HEAD^{tree}').stdout.trim()
    const push = () => { git('remote', 'add', 'origin', dir); git('update-ref', 'refs/remotes/origin/tp/1', 'HEAD'); git('branch', '-u', 'origin/tp/1') }
    const close = (event = stopEvent(), guards = HOST) => hook('close', { ...event, cwd: dir }, { guards, env: { CLAUDE_PROJECT_DIR: dir, TEAM_JOB_ID: '7', TEAM_BRANCH: 'tp/1' } })
    return { dir, git, commit, tree, push, close }
  }
  const held = (r) => r.answer?.decision === 'block' ? r.answer.reason : null

  it('lets the session end when the repository has no change', () => {
    const { close } = repo()
    const r = close()
    assert.deepEqual([r.status, r.answer], [0, null])
  })

  it('holds a change to a screen that has no mark and no push, once, with the exact commands', () => {
    const { commit, close, tree } = repo()
    commit('app/screens/Record.tsx')
    const reason = held(close())
    assert.match(reason, /needs the mark of a reviewer/)
    assert.ok(reason.includes(`Reviewed-by: reviewer-7 ${tree()}`), 'the command carries the tree and the job')
    assert.match(reason, /git push -u origin HEAD/)
    assert.equal(close(stopEvent({ stop_hook_active: true })).answer, null, 'the second time it lets the session end')
  })

  it('accepts the mark of another reviewer on the final tree once the branch is pushed', () => {
    const { git, commit, close, tree, push } = repo()
    commit('app/screens/Record.tsx')
    git('commit', '--allow-empty', '-qm', 'Mark', '-m', `Reviewed-by: judge-7 ${tree()}`)
    assert.match(held(close()), /not pushed/, 'with the mark but unpushed it still holds')
    assert.doesNotMatch(held(close()), /reviewer/)
    push()
    assert.equal(close().answer, null)
  })

  it('does not accept the author, the name the host excludes, or a mark of an older tree', () => {
    const { git, commit, close, tree, push } = repo()
    commit('app/screens/Record.tsx')
    git('commit', '--allow-empty', '-qm', 'Mark', '-m', `Reviewed-by: Agent (Team Platform) ${tree()}`)
    push()
    assert.match(held(close()), /needs the mark of a reviewer/, 'the author does not review themselves')
    const second = repo()
    second.commit('app/screens/Record.tsx')
    second.git('commit', '--allow-empty', '-qm', 'Mark', '-m', `Reviewed-by: someone ${second.tree()}`)
    second.push()
    assert.equal(second.close().answer, null)
    second.commit('app/screens/Other.tsx') // the tree changed after the mark
    second.push()
    assert.match(held(second.close()), /needs the mark of a reviewer/, 'a mark on the tree before the last change is not a mark')
    const named = repo()
    named.commit('app/screens/Record.tsx')
    named.git('config', 'user.name', 'Someone Else')
    named.git('commit', '--allow-empty', '-qm', 'Mark', '-m', `Reviewed-by: agent (team platform) ${named.tree()}`)
    named.push()
    assert.match(held(named.close()), /needs the mark of a reviewer/, 'the names the host excludes never count, whatever their case')
  })

  it('a change only to documents needs the mark; a document that is JSON, a test of a screen and a file outside the lists do not', () => {
    const docs = repo()
    docs.commit('docs/plan.md'); docs.push()
    assert.match(held(docs.close()), /needs the mark of a reviewer/)
    for (const file of ['docs/data.json', 'app/screens/Record.test.js', 'other.txt']) {
      const r = repo()
      r.commit(file); r.push()
      assert.equal(r.close().answer, null, file)
    }
    const mixed = repo()
    mixed.commit('docs/plan.md'); mixed.commit('other.txt'); mixed.push()
    assert.equal(mixed.close().answer, null, 'documents plus another file is not «only documents»')
  })

  it('holds a change that is not committed and names the files', () => {
    const { dir, commit, close } = repo()
    commit('other.txt')
    writeFileSync(join(dir, 'other.txt'), 'edited')
    const reason = held(close())
    assert.match(reason, /uncommitted changes \(other\.txt\)/)
    assert.match(reason, /git restore <file>/)
  })

  it('does only what the host asked for, and nothing without a base to count from', () => {
    const { commit, close } = repo()
    commit('app/screens/Record.tsx')
    assert.equal(close(stopEvent(), { close: { clean_tree: true } }).answer, null, 'no push, no review asked')
    assert.match(held(close(stopEvent(), { close: { pushed_branch: true, base: 'origin/main' } })), /not pushed/)
    const noBase = { close: { clean_tree: true, pushed_branch: true, base: 'origin/does-not-exist' } }
    assert.equal(close(stopEvent(), noBase).answer, null, 'a base that does not resolve: there is nothing to count from')
  })

  it('without `base` it counts from the default branch of the remote', () => {
    const { git, commit, close } = repo()
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    commit('other.txt')
    assert.match(held(close(stopEvent(), { close: { pushed_branch: true } })), /not pushed/)
  })
})

describe('the guards file', () => {
  it('accepts the file of a host and writes nothing it was not given', () => {
    assert.deepEqual(parseGuards(JSON.stringify(HOST)), HOST)
    assert.deepEqual(parseGuards('{}'), {})
  })

  it('names what is wrong, so that a typo fails the job instead of guarding nothing', () => {
    const wrong = (guards, pattern) => assert.throws(() => parseGuards(typeof guards === 'string' ? guards : JSON.stringify(guards)), pattern)
    wrong('{', /not JSON/)
    wrong({ comands: {} }, /does not know «comands»/)
    wrong({ commands: { builtin: ['forced-pushh'] } }, /does not know «forced-pushh»/)
    wrong({ commands: { rules: [{ match: '(', message: 'm' }] } }, /commands\.rules\[0\]\.match is not a regular expression/)
    wrong({ commands: { rules: [{ id: 'x', match: 'a' }] } }, /commands\.rules\[0\] \(«x»\)\.message is required/)
    wrong({ commands: { rules: [{ message: 'm' }] } }, /\.match is required/)
    wrong({ commands: { rules: [{ match: 'a', message: 'm', typo: 1 }] } }, /does not know «typo»/)
    wrong({ commands: { protected_branches: [] } }, /non-empty list/)
    wrong({ tools: { deny: [{ tools: ['Monitor'] }] } }, /message is required/)
    wrong({ tools: { deny: [{ tools: [], message: 'm' }] } }, /non-empty list/)
    wrong({ close: { clean_tree: 'yes' } }, /must be true or false/)
    wrong({ close: { review: { trailer: 'T', message: 'm' } } }, /needs «paths» or «only»/)
    wrong({ close: { review: { paths: '^a', message: 'm' } } }, /trailer is required/)
    wrong({ close: { review: { paths: '^a', trailer: 'T' } } }, /message is required/)
    wrong([], /must be an object/)
  })

  it('knows the named rules of the contract', () => {
    assert.deepEqual(BUILTIN_NAMES, ['forced-push', 'protected-push', 'no-verify', 'amend', 'add-all', 'stash', 'waiting'])
  })
})

describe('what the session declares', () => {
  const x = { ...loadConfig({ DATA_DIR: '/tmp/x' }).execute, model: 'claude-sonnet-5-5', budgetUsd: 1, maxTurns: 0 }
  const flag = (args, name) => args[args.indexOf(name) + 1]

  it('a host with no guards file declares the hooks it declared before, in every kind of session', () => {
    assert.equal(loadConfig({ DATA_DIR: '/tmp/x' }).execute.guardsFile, '')
    assert.deepEqual(Object.keys(sessionSettings({}).hooks), ['PostToolBatch'])
    assert.deepEqual(Object.keys(sessionSettings({ light: true, assessed: true }).hooks).sort(), ['PostToolBatch', 'PreToolUse', 'SessionStart'])
    assert.deepEqual(guardHooks(null), {})
    assert.deepEqual(guardHooks({ commands: {}, tools: { deny: [] }, close: {} }), {}, 'empty blocks declare nothing')
  })

  it('declares the three hooks for any model, with the tools of the list as the matcher, and keeps the ones the session already had', () => {
    const hooks = sessionSettings({ guards: HOST }).hooks
    assert.deepEqual(hooks.PreToolUse.map((g) => [g.matcher, g.hooks[0].command]), [['Bash', 'team hook commands'], ['Monitor|ReadNotifications|ListAgents|Agent|Task', 'team hook tools']])
    assert.deepEqual(hooks.Stop.map((g) => g.hooks[0].command), ['team hook close'])
    assert.ok(hooks.PostToolBatch, 'the live mentions stay')
    const light = sessionSettings({ light: true, assessed: true, stopCommand: 'bash check.sh', guards: HOST }).hooks
    assert.deepEqual(light.PreToolUse.map((g) => g.hooks[0].command), ['team guard', 'team hook commands', 'team hook tools'])
    assert.deepEqual(light.Stop.map((g) => g.hooks[0].command), ['bash check.sh', 'team hook close'], 'the host check of a light session and the closing check both run')
    assert.equal(JSON.parse(flag(claudeArgs(x, {}, { guards: HOST }), '--settings')).hooks.Stop[0].hooks[0].command, 'team hook close')
  })

  it('declares a block only when it has something in it', () => {
    assert.deepEqual(Object.keys(guardHooks({ commands: { builtin: ['stash'] } })), ['PreToolUse'])
    assert.deepEqual(Object.keys(guardHooks({ close: { clean_tree: true } })), ['Stop'])
    assert.equal(guardHooks({ tools: { deny_background: [{ tools: ['Agent'], message: 'm' }] } }).PreToolUse[0].matcher, 'Agent')
  })
})
