// @vitest-environment node
/** Node operations: replace this plugin's own directory from a tarball, keep backups, roll back, restart through the owner. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KEEP_BACKUPS, NodeOps, OWN_PACKAGE, ownPackageRoot } from '../../src/superagent/host/node-ops.ts'
import { registerNodeOpsFace } from '../../src/faces/node-ops.ts'
import { OWNER_DELEGATE_HEADER, OwnerDelegates, issueOwnerDelegate } from '../../src/superagent/host/owner-delegate.ts'
import { configureOwnerDelegates } from '../../src/superagent/host/owner-proof.ts'

let base = ''
let root = ''
let dir = ''
const at = new Date('2026-11-25T00:00:00Z')
let tick = 0
const clock = () => new Date(at.getTime() + (tick++) * 1000)

const pkg = (version: string, dependencies?: Record<string, string>) => JSON.stringify({ name: OWN_PACKAGE, version, ...(dependencies ? { dependencies } : {}) })
/** An `npm pack`-shaped tarball: one package/ directory. */
const tarball = (json: string, extra: Record<string, string> = {}): Buffer => {
  const work = mkdtempSync(join(base, 'pack-'))
  mkdirSync(join(work, 'package', 'lib'), { recursive: true })
  writeFileSync(join(work, 'package', 'package.json'), json)
  writeFileSync(join(work, 'package', 'lib', 'index.js'), `// ${json}\n`)
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(work, name), text)
  execFileSync('tar', ['-czf', 'out.tgz', 'package', ...Object.keys(extra)], { cwd: work })
  return readFileSync(join(work, 'out.tgz'))
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const version = () => (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }).version

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'node-ops-'))
  root = join(base, 'profile', 'node_modules', '@nelsonlongxiang', 'dsh-open-a2a-net')
  mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(join(root, 'package.json'), pkg('1.0.0'))
  writeFileSync(join(root, 'node_modules', 'dep', 'index.js'), 'dep\n')
  dir = join(base, 'dsh', 'a2a', 'node-ops')
  tick = 0
})
afterEach(() => { configureOwnerDelegates(undefined); rmSync(base, { recursive: true, force: true }) })

describe('node operations', () => {
  it('finds the package root of a file inside it', () => {
    mkdirSync(join(root, 'lib'), { recursive: true })
    expect(ownPackageRoot(join(root, 'lib', 'index.js'))).toBe(root)
    expect(ownPackageRoot(join(base, 'elsewhere.js'))).toBeUndefined()
  })

  it('install swaps the package, carries its node_modules across, keeps a backup and logs', () => {
    const ops = new NodeOps({ root, dir }, clock)
    const tgz = tarball(pkg('1.1.0'))
    const out = ops.install(tgz, sha(tgz), 'delegate')
    expect(out).toMatchObject({ ok: true, from: '1.0.0', to: '1.1.0' })
    expect(version()).toBe('1.1.0')
    expect(readFileSync(join(root, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('dep\n')
    expect(ops.listBackups().map(b => b.version)).toEqual(['1.0.0'])
    expect(readdirSync(dir).filter(n => n.startsWith('stage-'))).toEqual([])
    const log = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
    expect(log.at(-1)).toMatchObject({ op: 'install', who: 'delegate', ok: true, from: '1.0.0', to: '1.1.0' })
  })

  it('a sha256 mismatch changes nothing', () => {
    const ops = new NodeOps({ root, dir }, clock)
    const tgz = tarball(pkg('1.1.0'))
    expect(ops.install(tgz, 'a'.repeat(64), 'owner')).toMatchObject({ ok: false, code: 'sha256' })
    expect(version()).toBe('1.0.0')
    expect(ops.listBackups()).toEqual([])
  })

  it('changed dependencies refuse unless forceDeps', () => {
    const ops = new NodeOps({ root, dir }, clock)
    const tgz = tarball(pkg('1.1.0', { leftpad: '1.0.0' }))
    expect(ops.install(tgz, sha(tgz), 'owner')).toMatchObject({ ok: false, code: 'deps-changed' })
    expect(version()).toBe('1.0.0')
    expect(ops.install(tgz, sha(tgz), 'owner', true)).toMatchObject({ ok: true, to: '1.1.0' })
  })

  it('a tarball of another package, or with more than package/, changes nothing', () => {
    const ops = new NodeOps({ root, dir }, clock)
    const other = tarball(JSON.stringify({ name: 'other', version: '9.9.9' }))
    expect(ops.install(other, sha(other), 'owner')).toMatchObject({ ok: false, code: 'failed' })
    const extra = tarball(pkg('1.1.0'), { 'stray.txt': 'x' })
    expect(ops.install(extra, sha(extra), 'owner')).toMatchObject({ ok: false, code: 'tarball' })
    expect(version()).toBe('1.0.0')
    expect(existsSync(join(root, 'node_modules', 'dep'))).toBe(true)
  })

  it('a source checkout is never replaced', () => {
    const src = join(base, 'checkout')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'package.json'), pkg('0.0.1'))
    const ops = new NodeOps({ root: src, dir }, clock)
    const tgz = tarball(pkg('1.1.0'))
    expect(ops.install(tgz, sha(tgz), 'owner')).toMatchObject({ ok: false, code: 'not-installed' })
    expect(ops.status()).toMatchObject({ installed: false, version: '0.0.1' })
  })

  it('rollback puts the previous version back with its node_modules, and can be undone the same way', () => {
    const ops = new NodeOps({ root, dir }, clock)
    const tgz = tarball(pkg('1.1.0'))
    ops.install(tgz, sha(tgz), 'owner')
    expect(ops.rollback('owner')).toMatchObject({ ok: true, from: '1.1.0', to: '1.0.0' })
    expect(version()).toBe('1.0.0')
    expect(readFileSync(join(root, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('dep\n')
    expect(ops.listBackups().map(b => b.version)).toEqual(['1.1.0'])
    expect(ops.rollback('owner')).toMatchObject({ ok: true, to: '1.1.0' })
    expect(version()).toBe('1.1.0')
    expect(new NodeOps({ root, dir }, clock).rollback('owner', 'no-such')).toMatchObject({ ok: false, code: 'no-backup' })
  })

  it(`keeps only the newest ${String(KEEP_BACKUPS)} backups`, () => {
    const ops = new NodeOps({ root, dir }, clock)
    for (const v of ['1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0']) { const tgz = tarball(pkg(v)); expect(ops.install(tgz, sha(tgz), 'owner').ok).toBe(true) }
    expect(ops.listBackups().map(b => b.version)).toEqual(['1.4.0', '1.3.0', '1.2.0'])
  })
})

describe('node operations face', () => {
  type Handler = (req: unknown, res: unknown) => void
  const mount = (restart = vi.fn(async () => ({ ok: true, status: 202, mode: 'helper' }))) => {
    let handler: Handler = () => {}
    const ops = new NodeOps({ root, dir }, clock)
    registerNodeOpsFace({ register: (row: { handler: Handler }) => { handler = row.handler; return () => {} } } as never, {
      ctx: { effect: (fn: () => unknown) => fn(), get: () => ({ browserPeer: { id: 'owner' }, admit: () => ({ rejection: 401 }) }) } as never,
      controlRoute: fn => fn,
      readJsonBody: (req, _res, use) => { use((req as { body: Record<string, unknown> }).body) },
      ops,
      restart,
    })
    const call = (method: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) => new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
      let status = 0
      handler({ method, url: '/__dsh_a2a/node-ops', headers, body, socket: { localPort: 3080 } }, {
        writeHead: (s: number) => { status = s },
        end: (text: string) => { resolve({ status, body: JSON.parse(text) as Record<string, unknown> }) },
      })
    })
    return { call, restart }
  }
  const delegate = () => {
    const store = join(base, 'owner-delegates.json')
    configureOwnerDelegates(new OwnerDelegates(store, join(base, 'audit.jsonl'), () => at))
    return issueOwnerDelegate(store, 'coordinator', 30, {
      read: p => { try { return readFileSync(p, 'utf8') } catch { return undefined } },
      write: (p, t) => { writeFileSync(p, t) },
      random: () => ({ token: `dshod_${'y'.repeat(40)}`, id: 'd1' }),
      now: () => at,
    }).token
  }

  it('GET answers the status with the control key alone', async () => {
    const { call } = mount()
    expect(await call('GET')).toMatchObject({ status: 200, body: { ok: true, version: '1.0.0', installed: true } })
  })

  it('a POST without the browser owner or a delegate is refused and changes nothing', async () => {
    const { call, restart } = mount()
    const tgz = tarball(pkg('1.1.0'))
    const out = await call('POST', { action: 'install', tgz: tgz.toString('base64'), sha256: sha(tgz), restart: true })
    expect(out.status).toBe(401)
    expect(version()).toBe('1.0.0')
    expect(restart).not.toHaveBeenCalled()
  })

  it('a delegate installs and restarts in one call; the restart is logged', async () => {
    const { call, restart } = mount()
    const token = delegate()
    const tgz = tarball(pkg('1.1.0'))
    const out = await call('POST', { action: 'install', tgz: tgz.toString('base64'), sha256: sha(tgz), restart: true }, { [OWNER_DELEGATE_HEADER]: token })
    expect(out).toMatchObject({ status: 200, body: { ok: true, to: '1.1.0', restart: { ok: true, status: 202 } } })
    expect(restart).toHaveBeenCalledWith(3080)
    const log = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
    expect(log.map(l => l.op)).toEqual(['install', 'restart'])
  })

  it('a failed install never restarts', async () => {
    const { call, restart } = mount()
    const token = delegate()
    const tgz = tarball(pkg('1.1.0'))
    const out = await call('POST', { action: 'install', tgz: tgz.toString('base64'), sha256: 'b'.repeat(64), restart: true }, { [OWNER_DELEGATE_HEADER]: token })
    expect(out.body).toMatchObject({ ok: false, code: 'sha256' })
    expect(restart).not.toHaveBeenCalled()
  })
})
