// The tool travels with the job directory to a machine that has no repository around it: the handler copies this folder to `bin/captures` and writes
// `bin/look`. These tests copy it the way the handler does and run it from there. No browser is needed.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { installLook } from './install.mjs'

const exec = promisify(execFile)
let dir
const run = (args, env = {}) => exec(join(dir, 'bin', 'look'), args, { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, ...env } }).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }))

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'look-travel-'))
  await installLook(join(dir, 'bin'))
})
after(() => rm(dir, { recursive: true, force: true }))

describe('look from a copy of the folder', () => {
  it('copies no test, and `look --help` prints the usage from there', async () => {
    const copied = await readdir(join(dir, 'bin', 'captures'), { recursive: true })
    assert.deepEqual(copied.filter((f) => /\.test\./.test(f)), [])
    const result = await run(['--help'])
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /^look \[place…\]/)
  })

  it('every import of the tool stays inside its folder or is a Node built-in: nothing it needs is left behind', async () => {
    const own = new URL('./', import.meta.url)
    const files = (await readdir(own)).filter((f) => /\.m?js$/.test(f) && !/\.test\.m?js$/.test(f))
    assert.ok(files.includes('look.mjs'))
    for (const file of files) {
      const text = await readFile(new URL(file, own), 'utf8')
      for (const m of text.matchAll(/(?:from |import\()\s*'([^']+)'/g)) {
        const spec = m[1]
        assert.ok(spec.startsWith('node:') || /^\.\/[\w.-]+\.m?js$/.test(spec), `${file} imports ${spec}`)
        if (spec.startsWith('./')) assert.ok(files.includes(spec.slice(2)), `${file} imports ${spec}, which is not a source of the folder`)
      }
    }
  })

  it('the installer runs on its own, the way a host command outside a job uses it: `node install.mjs <bin>`', async () => {
    const other = await mkdtemp(join(tmpdir(), 'look-install-'))
    try {
      await exec(process.execPath, [fileURLToPath(new URL('./install.mjs', import.meta.url)), join(other, 'bin')])
      const installed = await readdir(join(other, 'bin'), { recursive: true })
      assert.ok(installed.includes('look') && installed.includes('captures/look.mjs'), installed.join(', '))
      assert.deepEqual(installed.filter((f) => /\.test\.|testing/.test(f)), [])
      assert.equal((await exec(join(other, 'bin', 'look'), ['--help'])).stdout.startsWith('look [place…]'), true)
      await assert.rejects(exec(process.execPath, [fileURLToPath(new URL('./install.mjs', import.meta.url))]), /usage: node install.mjs/)
    } finally { await rm(other, { recursive: true, force: true }) }
  })

  it('refuses to run without an address and says what to set (exit 2)', async () => {
    const result = await run([])
    assert.equal(result.code, 2)
    assert.match(result.stderr, /LOOK_ORIGIN/)
  })

  it('refuses an unknown option, and an adapter that does not exist, with exit 2', async () => {
    assert.equal((await run(['--clinic', 'x'], { LOOK_ORIGIN: 'http://127.0.0.1:9' })).code, 2)
    const missing = await run([], { LOOK_HOST: 'no-such-adapter.mjs' })
    assert.equal(missing.code, 2)
    assert.match(missing.stderr, /no such file/)
  })

  it('refuses a LOOK_TIMEOUT_S that is not a number of seconds greater than zero (exit 2)', async () => {
    const result = await run([], { LOOK_ORIGIN: 'http://127.0.0.1:9', LOOK_TIMEOUT_S: '0' })
    assert.equal(result.code, 2)
    assert.match(result.stderr, /LOOK_TIMEOUT_S/)
  })
})
