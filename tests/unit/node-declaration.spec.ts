// @vitest-environment node
/** #936: node install and rollback keep the profile's declaration of this plugin (package.json, pnpm-lock.yaml) in step. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, renameSync: vi.fn(fs.renameSync) }
})
import { NodeOps, OWN_PACKAGE } from '../../src/superagent/host/node-ops.ts'
import { declarationStatus, dependencyGaps, integrityOf, lockedDependencies, versionSatisfies, profileDirOf, rewriteLock, rewriteManifest } from '../../src/superagent/host/node-declaration.ts'

const OTHER = `      '@example/other-plugin':
        specifier: 0.24.0
        version: 0.24.0`
const peers = `    engines: {pnpm: '>=11.24 <12'}
    hasBin: true
    peerDependencies:
      '@deepseek-ai/cordis': '>=4.0.1'`
/** A lockfile v9 in the shape the profiles on 3080 have, declaring this plugin by `decl` (npm version or file: path). */
function lock(spec: string, ref: string, integrity: string, version: string): string {
  const file = ref.startsWith('file:')
  return [`lockfileVersion: '9.0'`, '', 'settings:', '  autoInstallPeers: false', '', 'importers:', '', '  .:', '    dependencies:',
    `      '${OWN_PACKAGE}':`, `        specifier: ${spec}`, `        version: ${ref}`, OTHER, '', 'packages:', '',
    `  '${OWN_PACKAGE}@${ref}':`, file ? `    resolution: {integrity: ${integrity}, tarball: ${ref}}` : `    resolution: {integrity: ${integrity}}`,
    ...(file ? [`    version: ${version}`] : []), peers, '', `  '@example/other-plugin@0.24.0':`, '    resolution: {integrity: sha512-OTHER==}', '',
    'snapshots:', '', `  '${OWN_PACKAGE}@${ref}': {}`, '', `  '@example/other-plugin@0.24.0': {}`, ''].join('\n')
}
const manifest = (spec: string) => JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies: { [OWN_PACKAGE]: spec, '@example/other-plugin': '0.24.0' } }, null, 2) + '\n'

let base = '', profile = '', root = '', dir = ''
let tick = 0
const clock = () => new Date(Date.parse('2026-11-25T00:00:00Z') + (tick++) * 1000)
const tarball = (version: string, deps?: Record<string, string>): Buffer => {
  const work = mkdtempSync(join(base, 'pack-'))
  mkdirSync(join(work, 'package'), { recursive: true })
  writeFileSync(join(work, 'package', 'package.json'), JSON.stringify({ name: OWN_PACKAGE, version, ...(deps ? { dependencies: deps } : {}) }))
  execFileSync('tar', ['-czf', 'out.tgz', 'package'], { cwd: work })
  return readFileSync(join(work, 'out.tgz'))
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const read = (name: string) => readFileSync(join(profile, name), 'utf8')

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'node-decl-'))
  profile = join(base, 'profiles', 'web')
  root = join(profile, 'node_modules', '@nelsonlongxiang', 'dsh-open-a2a-net')
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: OWN_PACKAGE, version: '0.8.1' }))
  writeFileSync(join(profile, 'package.json'), manifest('0.8.1'))
  writeFileSync(join(profile, 'pnpm-lock.yaml'), lock('0.8.1', '0.8.1', 'sha512-OLD==', '0.8.1'))
  dir = join(base, 'dsh', 'a2a', 'node-ops')
  tick = 0
})
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

describe('#936 the declaration rewrite', () => {
  it('finds the profile above node_modules', () => {
    expect(profileDirOf(root)).toBe(profile)
    expect(profileDirOf(join(base, 'src'))).toBeUndefined()
  })
  it('changes only this plugin in package.json, keeping the indent and final newline', () => {
    const out = rewriteManifest(manifest('0.8.1'), '0.8.2')
    expect(out).toEqual({ ok: true, text: manifest('0.8.2') })
    expect(rewriteManifest('{"dependencies":{}}', '0.8.2')).toMatchObject({ ok: false })
  })
  it('moves npm → file: and file: → npm, other plugins byte for byte', () => {
    const npm = lock('0.8.1', '0.8.1', 'sha512-OLD==', '0.8.1')
    const toFile = rewriteLock(npm, 'file:/kept/a.tgz', 'file:../../kept/a.tgz', 'sha512-NEW==', '0.8.2')
    expect(toFile).toEqual({ ok: true, text: lock('file:/kept/a.tgz', 'file:../../kept/a.tgz', 'sha512-NEW==', '0.8.2') })
    const back = rewriteLock((toFile as { text: string }).text, '0.8.3', '0.8.3', 'sha512-N3==', '0.8.3')
    expect(back).toEqual({ ok: true, text: lock('0.8.3', '0.8.3', 'sha512-N3==', '0.8.3') })
    for (const text of [(toFile as { text: string }).text, (back as { text: string }).text]) expect(text).toContain(OTHER)
  })
  it('refuses a lockfile it does not recognise, rather than guess', () => {
    expect(rewriteLock("lockfileVersion: '6.0'\n", '0.8.2', '0.8.2', 'x', '0.8.2')).toMatchObject({ ok: false, why: expect.stringContaining('version 9') })
    const peered = lock('0.8.1', '0.8.1', 'sha512-OLD==', '0.8.1').replace(`  '${OWN_PACKAGE}@0.8.1': {}`, `  '${OWN_PACKAGE}@0.8.1(@deepseek-ai/cordis@4.0.1)': {}`)
    expect(rewriteLock(peered, '0.8.2', '0.8.2', 'x', '0.8.2')).toMatchObject({ ok: false })
  })
})

describe('#936 node install, rollback and status', () => {
  it('install as file: makes package.json, the lockfile and node_modules agree; another plugin is untouched', () => {
    const tgz = tarball('0.8.2')
    const out = new NodeOps({ root, dir }, clock).install(tgz, sha(tgz), 'owner')
    expect(out).toMatchObject({ ok: true, to: '0.8.2', declaration: { updated: true, lockfile: 'updated' } })
    const spec = (JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies[OWN_PACKAGE]!
    expect(spec.startsWith('file:') && spec.endsWith('.tgz')).toBe(true)
    expect(readFileSync(spec.slice('file:'.length))).toEqual(tgz)
    expect(read('pnpm-lock.yaml')).toContain(`integrity: ${integrityOf(tgz)}`)
    expect(read('pnpm-lock.yaml')).toContain(OTHER)
    expect((JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies['@example/other-plugin']).toBe('0.24.0')
    expect(new NodeOps({ root, dir }, clock).status().declaration).toMatchObject({ drift: false, installed: '0.8.2' })
  })
  it('install as npm declares the version', () => {
    const tgz = tarball('0.8.2')
    expect(new NodeOps({ root, dir }, clock).install(tgz, sha(tgz), 'owner', false, 'npm')).toMatchObject({ ok: true, declaration: { updated: true, spec: '0.8.2' } })
    expect(read('pnpm-lock.yaml')).toBe(lock('0.8.2', '0.8.2', integrityOf(tgz), '0.8.2'))
    expect(new NodeOps({ root, dir }, clock).status().declaration).toMatchObject({ drift: false })
  })
  it('rollback puts both files back byte for byte', () => {
    const before = { manifest: read('package.json'), lock: read('pnpm-lock.yaml') }
    const tgz = tarball('0.8.2')
    const ops = new NodeOps({ root, dir }, clock)
    ops.install(tgz, sha(tgz), 'owner')
    expect(ops.rollback('owner')).toMatchObject({ ok: true, to: '0.8.1', declaration: { restored: true } })
    expect({ manifest: read('package.json'), lock: read('pnpm-lock.yaml') }).toEqual(before)
    expect(ops.status().declaration).toMatchObject({ drift: false, installed: '0.8.1' })
  })
  it('changed dependencies (forceDeps) leave the declaration alone, and status shows the drift', () => {
    const before = { manifest: read('package.json'), lock: read('pnpm-lock.yaml') }
    const tgz = tarball('0.8.2', { extra: '1.0.0' })
    expect(new NodeOps({ root, dir }, clock).install(tgz, sha(tgz), 'owner', true)).toMatchObject({ ok: true, declaration: { updated: false } })
    expect({ manifest: read('package.json'), lock: read('pnpm-lock.yaml') }).toEqual(before)
    expect(new NodeOps({ root, dir }, clock).status().declaration).toMatchObject({ drift: true, why: expect.arrayContaining([expect.stringContaining('0.8.1')]) })
  })
  it('status reports drift when the declaration was changed by hand', () => {
    writeFileSync(join(profile, 'package.json'), manifest('0.8.0'))
    const status = declarationStatus(profile, '0.8.1')
    expect(status).toMatchObject({ drift: true, declared: '0.8.0' })
    expect((status.why as string[]).join(' ')).toMatch(/another declaration|declares 0\.8\.0/)
  })
})

describe('#937 review: node-ops boundaries', () => {
  it('1: a rollback whose lockfile rename fails leaves the profile as it was and keeps the saved pair', async () => {
    const real = (await vi.importActual<typeof import('node:fs')>('node:fs')).renameSync
    const tgz = tarball('0.8.2')
    const ops = new NodeOps({ root, dir }, clock)
    ops.install(tgz, sha(tgz), 'owner')
    const installed = { manifest: read('package.json'), lock: read('pnpm-lock.yaml') }
    vi.mocked(renameSync).mockImplementation(((from: string, to: string) => {
      if (String(to) === join(profile, 'pnpm-lock.yaml')) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      return real(from, to)
    }) as never)
    try {
      const out = ops.rollback('owner')
      expect(out).toMatchObject({ ok: true, to: '0.8.1', declaration: { restored: false } })
      expect({ manifest: read('package.json'), lock: read('pnpm-lock.yaml') }).toEqual(installed)
      const kept = (out as { declaration: { kept: string } }).declaration.kept
      expect(existsSync(join(kept, 'package.json')) && existsSync(join(kept, 'pnpm-lock.yaml'))).toBe(true)
    } finally { vi.mocked(renameSync).mockImplementation(real as never) }
  })
  it('2: a lockfile that already has entries for the new package is refused, not doubled', () => {
    const both = lock('0.8.1', '0.8.1', 'sha512-OLD==', '0.8.1').replace('snapshots:', `  '${OWN_PACKAGE}@0.8.2':\n    resolution: {integrity: sha512-X==}\n\nsnapshots:`).replace(`  '${OWN_PACKAGE}@0.8.1': {}`, `  '${OWN_PACKAGE}@0.8.1': {}\n\n  '${OWN_PACKAGE}@0.8.2': {}`)
    expect(rewriteLock(both, '0.8.2', '0.8.2', 'sha512-N==', '0.8.2')).toMatchObject({ ok: false, why: expect.stringContaining('already has entries') })
  })
  it('3: a damaged kept tarball of the same name is written again', () => {
    const tgz = tarball('0.8.2')
    mkdirSync(join(dir, 'packages'), { recursive: true })
    const kept = join(dir, 'packages', `nelsonlongxiang-dsh-open-a2a-net-0.8.2-${sha(tgz).slice(0, 8)}.tgz`)
    writeFileSync(kept, 'truncated')
    expect(new NodeOps({ root, dir }, clock).install(tgz, sha(tgz), 'owner')).toMatchObject({ ok: true, declaration: { updated: true } })
    expect(readFileSync(kept)).toEqual(tgz)
  })
  it('4: same version with changed dependencies (forceDeps) keeps the files and status reports the drift', () => {
    const before = { manifest: read('package.json'), lock: read('pnpm-lock.yaml') }
    const tgz = tarball('0.8.1', { extra: '1.0.0' })
    expect(new NodeOps({ root, dir }, clock).install(tgz, sha(tgz), 'owner', true)).toMatchObject({ ok: true, to: '0.8.1', declaration: { updated: false } })
    expect({ manifest: read('package.json'), lock: read('pnpm-lock.yaml') }).toEqual(before)
    expect(new NodeOps({ root, dir }, clock).status().declaration).toMatchObject({ drift: true, why: expect.arrayContaining([expect.stringContaining('dependencies changed')]) })
  })
})

describe('#937 re-review: carry-over boundaries', () => {
  it('B2 carry-over: reinstalling the forced package does not clear the drift while the lockfile lacks its dependency', () => {
    const forced = tarball('0.8.2', { extra: '1.0.0' })
    const ops = new NodeOps({ root, dir }, clock)
    expect(ops.install(forced, sha(forced), 'owner', true)).toMatchObject({ ok: true, declaration: { updated: false } })
    const before = { manifest: read('package.json'), lock: read('pnpm-lock.yaml') }
    // An ordinary reinstall of the same package: the dependencies equal the running ones now, but the lock never saw them.
    expect(ops.install(forced, sha(forced), 'owner')).toMatchObject({ ok: true, declaration: { updated: false, why: expect.stringContaining('run pnpm install') } })
    expect({ manifest: read('package.json'), lock: read('pnpm-lock.yaml') }).toEqual(before)
    expect(ops.status().declaration).toMatchObject({ drift: true, why: expect.arrayContaining([expect.stringContaining('extra 1.0.0 is not in the lockfile')]) })
  })
  it('status reads the lockfile\'s dependency list directly, with no marker', () => {
    expect(declarationStatus(profile, '0.8.1', [['extra', '1.0.0']])).toMatchObject({ drift: true })
    expect(declarationStatus(profile, '0.8.1', [])).toMatchObject({ drift: false })
    const withDeps = lock('0.8.1', '0.8.1', 'sha512-OLD==', '0.8.1').replace(`  '${OWN_PACKAGE}@0.8.1': {}`, `  '${OWN_PACKAGE}@0.8.1':\n    dependencies:\n      extra: 1.0.0\n      '@example/scoped': 2.0.0`)
    expect(lockedDependencies(withDeps, '0.8.1')).toEqual({ extra: '1.0.0', '@example/scoped': '2.0.0' })
    expect(lockedDependencies(withDeps, '9.9.9')).toBeUndefined()
  })
  it('B4 carry-over: a target key written as an inline mapping is refused, not doubled', () => {
    const inline = lock('0.8.1', '0.8.1', 'sha512-OLD==', '0.8.1').replace('snapshots:', `  '${OWN_PACKAGE}@0.8.2': {resolution: {integrity: sha512-X==}}\n\nsnapshots:`)
    expect(rewriteLock(inline, '0.8.2', '0.8.2', 'sha512-N==', '0.8.2')).toMatchObject({ ok: false, why: expect.stringContaining('already has entries') })
  })
  it('B4 carry-over, the review\'s exact order: same-version force install, then an ordinary reinstall of the same archive', () => {
    const forced = tarball('0.8.1', { extra: '1.0.0' })
    const ops = new NodeOps({ root, dir }, clock)
    expect(ops.install(forced, sha(forced), 'owner', true)).toMatchObject({ ok: true, to: '0.8.1', declaration: { updated: false } })
    expect(ops.status().declaration).toMatchObject({ drift: true })
    const before = { manifest: read('package.json'), lock: read('pnpm-lock.yaml') }
    expect(ops.install(forced, sha(forced), 'owner')).toMatchObject({ ok: true, declaration: { updated: false } })
    expect({ manifest: read('package.json'), lock: read('pnpm-lock.yaml') }).toEqual(before)
    expect(lockedDependencies(read('pnpm-lock.yaml'), '0.8.1')).toEqual({})
    expect(ops.status().declaration).toMatchObject({ drift: true, why: expect.arrayContaining([expect.stringContaining('extra 1.0.0 is not in the lockfile')]) })
  })
  it('B2 carry-over: a target entry inline in snapshots ({optional: true}) is refused too', () => {
    const inline = lock('0.8.1', '0.8.1', 'sha512-OLD==', '0.8.1').replace(`  '${OWN_PACKAGE}@0.8.1': {}`, `  '${OWN_PACKAGE}@0.8.1': {}\n\n  '${OWN_PACKAGE}@0.8.2': {optional: true}`)
    expect(rewriteLock(inline, '0.8.2', '0.8.2', 'sha512-N==', '0.8.2')).toMatchObject({ ok: false, why: expect.stringContaining('already has entries') })
  })
})

describe('#937 second re-review B4: dependency versions, not only names', () => {
  it('versionSatisfies: exact, ^, ~ and *; other forms are not confirmed', () => {
    expect(versionSatisfies('1.0.0', '1.0.0')).toBe(true)
    expect(versionSatisfies('1.0.0', '2.0.0')).toBe(false)
    expect(versionSatisfies('1.4.2', '^1.2.0')).toBe(true)
    expect(versionSatisfies('2.0.0', '^1.2.0')).toBe(false)
    expect(versionSatisfies('1.1.0', '^1.2.0')).toBe(false)
    expect(versionSatisfies('0.3.9', '^0.3.1')).toBe(true)
    expect(versionSatisfies('0.4.0', '^0.3.1')).toBe(false)
    expect(versionSatisfies('0.0.4', '^0.0.3')).toBe(false)
    expect(versionSatisfies('1.2.9', '~1.2.3')).toBe(true)
    expect(versionSatisfies('1.3.0', '~1.2.3')).toBe(false)
    expect(versionSatisfies('9.9.9', '*')).toBe(true)
    for (const spec of ['>=1 <2', '1.x', 'latest', 'file:../x.tgz', '^1.0.0-beta.1']) expect(versionSatisfies('1.0.0', spec)).toBeUndefined()
    expect(versionSatisfies('1.0.0-beta.1', '1.0.0-beta.1')).toBeUndefined()
  })
  it('dependencyGaps names a missing, an extra, an out-of-spec and an unconfirmed dependency', () => {
    expect(dependencyGaps({ extra: '1.0.0' }, [['extra', '^1.0.0']])).toEqual([])
    expect(dependencyGaps({ extra: '1.0.0' }, [['extra', '2.0.0']])).toEqual(['extra: locked 1.0.0 does not meet 2.0.0'])
    expect(dependencyGaps({}, [['extra', '1.0.0']])).toEqual(['extra 1.0.0 is not in the lockfile'])
    expect(dependencyGaps({ old: '1.0.0' }, [])).toEqual(['old is in the lockfile but not a dependency'])
    expect(dependencyGaps({ extra: '1.0.0' }, [['extra', '>=1']])[0]).toContain('cannot confirm')
  })
  it('the review\'s order: extra 1.0.0 → --force-deps 2.0.0 → ordinary reinstall keeps the files and status drifts', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: OWN_PACKAGE, version: '0.8.1', dependencies: { extra: '1.0.0' } }))
    writeFileSync(join(profile, 'pnpm-lock.yaml'), lock('0.8.1', '0.8.1', 'sha512-OLD==', '0.8.1').replace(`  '${OWN_PACKAGE}@0.8.1': {}`, `  '${OWN_PACKAGE}@0.8.1':\n    dependencies:\n      extra: 1.0.0`))
    const ops = new NodeOps({ root, dir }, clock)
    expect(ops.status().declaration).toMatchObject({ drift: false })
    const forced = tarball('0.8.1', { extra: '2.0.0' })
    expect(ops.install(forced, sha(forced), 'owner', true)).toMatchObject({ ok: true, declaration: { updated: false } })
    const before = { manifest: read('package.json'), lock: read('pnpm-lock.yaml') }
    expect(ops.install(forced, sha(forced), 'owner')).toMatchObject({ ok: true, declaration: { updated: false, why: expect.stringContaining('locked 1.0.0 does not meet 2.0.0') } })
    expect({ manifest: read('package.json'), lock: read('pnpm-lock.yaml') }).toEqual(before)
    expect(ops.status().declaration).toMatchObject({ drift: true, why: expect.arrayContaining([expect.stringContaining('locked 1.0.0 does not meet 2.0.0')]) })
  })
  it('a lockfile that does describe the new dependency (within its range) lets the declaration move', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: OWN_PACKAGE, version: '0.8.1', dependencies: { extra: '^1.0.0' } }))
    writeFileSync(join(profile, 'pnpm-lock.yaml'), lock('0.8.1', '0.8.1', 'sha512-OLD==', '0.8.1').replace(`  '${OWN_PACKAGE}@0.8.1': {}`, `  '${OWN_PACKAGE}@0.8.1':\n    dependencies:\n      extra: 1.4.0`))
    const next = tarball('0.8.2', { extra: '^1.0.0' })
    expect(new NodeOps({ root, dir }, clock).install(next, sha(next), 'owner')).toMatchObject({ ok: true, declaration: { updated: true } })
    expect(new NodeOps({ root, dir }, clock).status().declaration).toMatchObject({ drift: false })
  })
})
