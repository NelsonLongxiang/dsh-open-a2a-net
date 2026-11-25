// @vitest-environment node
/** #936: node install and rollback keep the profile's declaration of this plugin (package.json, pnpm-lock.yaml) in step. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NodeOps, OWN_PACKAGE } from '../../src/superagent/host/node-ops.ts'
import { declarationStatus, integrityOf, profileDirOf, rewriteLock, rewriteManifest } from '../../src/superagent/host/node-declaration.ts'

const OTHER = `      '@nelsonlongxiang/dsh-prompt-templates':
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
    ...(file ? [`    version: ${version}`] : []), peers, '', `  '@nelsonlongxiang/dsh-prompt-templates@0.24.0':`, '    resolution: {integrity: sha512-OTHER==}', '',
    'snapshots:', '', `  '${OWN_PACKAGE}@${ref}': {}`, '', `  '@nelsonlongxiang/dsh-prompt-templates@0.24.0': {}`, ''].join('\n')
}
const manifest = (spec: string) => JSON.stringify({ name: 'dsh-profile-web', private: true, dependencies: { [OWN_PACKAGE]: spec, '@nelsonlongxiang/dsh-prompt-templates': '0.24.0' } }, null, 2) + '\n'

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
    expect((JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies['@nelsonlongxiang/dsh-prompt-templates']).toBe('0.24.0')
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
