#!/usr/bin/env node
// Prepares a publication (plan 2026, piece C4): raises package.json `version` (and the two places package-lock.json repeats it) and moves the
// text of `## [Unreleased]` in docs/CHANGELOG.md to a section `## [X.Y.Z] - YYYY-MM-DD`. It writes files and nothing else: the commit that carries
// them goes to `desarrollo` like any other, and scripts/publish-main.sh publishes it afterwards.
//
//   node scripts/prepare-release.mjs <patch|minor|major|current|X.Y.Z> [--date YYYY-MM-DD]
//
//   patch    fixes and changes nobody installing it has to act on
//   minor    a new capability or a new optional variable (the host contract only grows in an additive way)
//   major    a change of `contract_version`, or anything that breaks an installation that works
//   current  publishes the version package.json already has (the first publication, 0.1.0); only the changelog moves
//   X.Y.Z    an explicit version, greater than the current one
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
const parse = (v) => {
  const m = SEMVER.exec(v)
  if (!m) throw new Error(`«${v}» is not a version X.Y.Z`)
  return m.slice(1).map(Number)
}

export function compare(a, b) {
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

export function nextVersion(current, level) {
  const [major, minor, patch] = parse(current)
  if (level === 'current') return current
  if (level === 'major') return `${major + 1}.0.0`
  if (level === 'minor') return `${major}.${minor + 1}.0`
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`
  if (compare(level, current) <= 0) throw new Error(`${level} is not greater than ${current}`)
  return level
}

// Moves what `## [Unreleased]` holds to `## [version] - date` and leaves `## [Unreleased]` empty. Fails if there is nothing to move or the
// section already exists: a publication without a line in the changelog is the thing this step is here to prevent.
export function moveUnreleased(changelog, version, date) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((l) => /^## \[Unreleased\]/.test(l))
  if (start < 0) throw new Error('docs/CHANGELOG.md has no «## [Unreleased]» section')
  if (lines.some((l) => l.startsWith(`## [${version}]`))) throw new Error(`docs/CHANGELOG.md already has «## [${version}]»`)
  let end = lines.findIndex((l, i) => i > start && /^(## \[|<!--)/.test(l))
  if (end < 0) end = lines.length
  const body = lines.slice(start + 1, end)
  if (!body.some((l) => l.trim())) throw new Error('«## [Unreleased]» is empty: there is nothing to publish')
  while (body.length && !body[0].trim()) body.shift()
  while (body.length && !body[body.length - 1].trim()) body.pop()
  return [...lines.slice(0, start + 1), '', `## [${version}] - ${date}`, '', ...body, '', ...lines.slice(end)].join('\n')
}

export function setLockVersion(lock, version) {
  const data = JSON.parse(lock)
  data.version = version
  if (data.packages?.['']) data.packages[''].version = version
  return `${JSON.stringify(data, null, 2)}\n`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const args = process.argv.slice(2)
  const di = args.indexOf('--date')
  // The local day of the machine that prepares the release (TZ), the same day localDay of src/execute/budget.js uses: not UTC, which is already tomorrow at night in the Americas.
  const today = new Date()
  const date = di >= 0 ? args.splice(di, 2)[1] : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const level = args[0]
  if (!level) { console.error('usage: node scripts/prepare-release.mjs <patch|minor|major|current|X.Y.Z> [--date YYYY-MM-DD]'); process.exit(2) }
  try {
    const pkgFile = path.join(root, 'package.json')
    const pkgText = readFileSync(pkgFile, 'utf8')
    const pkg = JSON.parse(pkgText)
    const version = nextVersion(pkg.version, level)
    const changelogFile = path.join(root, 'docs/CHANGELOG.md')
    const changelog = moveUnreleased(readFileSync(changelogFile, 'utf8'), version, date)
    writeFileSync(changelogFile, changelog)
    if (version !== pkg.version) {
      writeFileSync(pkgFile, pkgText.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`))
      const lockFile = path.join(root, 'package-lock.json')
      writeFileSync(lockFile, setLockVersion(readFileSync(lockFile, 'utf8'), version))
    }
    console.log(`prepared ${version} (${date}): package.json, package-lock.json and docs/CHANGELOG.md; commit them to desarrollo, then scripts/publish-main.sh`)
  } catch (error) {
    console.error(`prepare-release: ${error.message}`)
    process.exit(1)
  }
}
