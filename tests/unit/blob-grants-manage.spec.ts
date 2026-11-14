/**
 * File-channel grant management (market request 2026-11-14): a sender lists its own live grants with
 * the store's occupancy, revokes one of its own (bytes freed when nothing else names the file), and a
 * grant records its task and whether it was fetched. Another sender's grant is never touched.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BLOB_COUNT_MAX, BLOB_TOTAL_MAX, BlobStore, formatFileRef } from '../../src/blob-store.ts'
import { createFileTools, type FileToolsDeps } from '../../src/tools/files.ts'
import { localRoute } from '../../src/node-self.ts'

const sha = (b: string): string => createHash('sha256').update(b).digest('hex')
type Def = { name: string; execute: (args: unknown, exec: unknown) => Promise<Record<string, unknown>> }

describe('BlobStore grant management', () => {
  it('lists only the caller\'s live grants, with the occupancy and ceilings', () => {
    const store = new BlobStore(mkdtempSync(join(tmpdir(), 'bg-')))
    store.stage(Buffer.from('a'), { name: 'a.txt', to: 'peer/x', by: 'session-a', taskId: 'direct-1' })
    store.stage(Buffer.from('bb'), { name: 'b.txt', to: 'peer/y', by: 'session-b' })
    expect(store.grantsBy('session-a').map(g => [g.name, g.to, g.taskId])).toEqual([['a.txt', 'peer/x', 'direct-1']])
    expect(store.grantsBy('session-b').map(g => g.name)).toEqual(['b.txt'])
    expect(store.grantsBy('')).toEqual([])
    expect(store.usage()).toMatchObject({ files: 2, bytes: 3, maxFiles: BLOB_COUNT_MAX, maxBytes: BLOB_TOTAL_MAX })
  })

  it('revoking your own grant removes it and frees the bytes; the store takes new files again', () => {
    const root = mkdtempSync(join(tmpdir(), 'bg-'))
    const store = new BlobStore(root)
    store.stage(Buffer.from('chunk-1'), { name: 'c1', to: 'peer/x', by: 'session-a' })
    expect(existsSync(join(root, 'blobs', sha('chunk-1')))).toBe(true)
    expect(store.revoke(sha('chunk-1'), 'peer/x', 'session-a')).toEqual({ ok: true, sha256: sha('chunk-1'), to: 'peer/x', reclaimed: true, bytes: 7 })
    expect(existsSync(join(root, 'blobs', sha('chunk-1')))).toBe(false)
    expect(store.grantFor(sha('chunk-1'), ['peer/x'])).toBeUndefined()
    expect(store.usage()).toMatchObject({ files: 0, bytes: 0 })
    // Persisted: a restart does not bring it back.
    expect(new BlobStore(root).grantsBy('session-a')).toEqual([])
  })

  it('a file another grant still names keeps its bytes when one grant is revoked', () => {
    const root = mkdtempSync(join(tmpdir(), 'bg-'))
    const store = new BlobStore(root)
    store.stage(Buffer.from('shared'), { name: 's', to: 'peer/x', by: 'session-a' })
    store.stage(Buffer.from('shared'), { name: 's', to: 'peer/y', by: 'session-a' })
    expect(store.revoke(sha('shared'), 'peer/x', 'session-a')).toMatchObject({ ok: true, reclaimed: false, bytes: 0 })
    const other = store.grantFor(sha('shared'), ['peer/y'])
    expect(other).toBeDefined()
    expect(store.read(other!)).toBeDefined()
  })

  it('adversarial: another sender cannot revoke your grant, and its refusal is the one a missing grant gets', () => {
    const root = mkdtempSync(join(tmpdir(), 'bg-'))
    const store = new BlobStore(root)
    store.stage(Buffer.from('mine'), { name: 'm', to: 'peer/x', by: 'session-a' })
    const theirs = store.revoke(sha('mine'), 'peer/x', 'session-b')
    const missing = store.revoke(sha('nothing'), 'peer/x', 'session-b')
    expect(theirs).toEqual({ ok: false, code: 'not-found', error: 'you have no grant of that file to that target' })
    expect(missing).toEqual(theirs)
    // Untouched: still listed, still served, bytes still there.
    expect(store.grantsBy('session-a')).toHaveLength(1)
    const grant = store.grantFor(sha('mine'), ['peer/x'])
    expect(store.read(grant!)).toEqual(Buffer.from('mine'))
    // Same sha, wrong target: not found either.
    expect(store.revoke(sha('mine'), 'peer/y', 'session-a')).toMatchObject({ ok: false, code: 'not-found' })
    expect(store.revoke('not-a-sha', 'peer/x', 'session-a')).toMatchObject({ ok: false, code: 'bad-request' })
  })

  it('records the task (only on the sender\'s grant, never overwriting one) and fetches, and keeps both across a restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'bg-'))
    let now = 1_000
    const store = new BlobStore(root, () => now)
    store.stage(Buffer.from('t'), { name: 't', to: 'peer/x', by: 'session-a' })
    store.tagTask(sha('t'), 'peer/x', 'session-b', 'direct-other')
    expect(store.grantsBy('session-a')[0]!.taskId).toBeUndefined()
    store.tagTask(sha('t'), 'peer/x', 'session-a', 'direct-mine')
    store.tagTask(sha('t'), 'peer/x', 'session-a', 'direct-later')
    expect(store.grantsBy('session-a')[0]!.taskId).toBe('direct-mine')
    expect(store.stage(Buffer.from('u'), { name: 'u', to: 'peer/x', by: 'session-a', taskId: 'bad id!' })).toMatchObject({ ok: false, code: 'bad-request' })
    const grant = store.grantFor(sha('t'), ['peer/x'])!
    now = 2_000; store.noteFetch(grant)
    now = 3_000; store.noteFetch(grant)
    const again = new BlobStore(root, () => now).grantsBy('session-a')[0]!
    expect(again).toMatchObject({ taskId: 'direct-mine', fetches: 2, firstFetchedAt: 2_000 })
  })

  it('a grants file from before these fields loads as before (no task, never fetched)', () => {
    const root = mkdtempSync(join(tmpdir(), 'bg-'))
    new BlobStore(root).stage(Buffer.from('old'), { name: 'o', to: 'peer/x', by: 'session-a' })
    const file = join(root, 'blob-grants.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { grants: Array<Record<string, unknown>> }
    for (const g of raw.grants) { delete g.taskId; delete g.fetches; delete g.firstFetchedAt }
    writeFileSync(file, JSON.stringify(raw))
    expect(new BlobStore(root).grantsBy('session-a')).toHaveLength(1)
  })
})

describe('#692 review: ownership, durability and provenance', () => {
  it('F1: B staging the same bytes for the same target gets a grant of its own; B\'s revoke leaves A\'s grant, its bytes and a restart intact', () => {
    const root = mkdtempSync(join(tmpdir(), 'bg-f1-'))
    const store = new BlobStore(root)
    store.stage(Buffer.from('public chunk'), { name: 'c', to: 'peer/t', by: 'session-a' })
    expect(store.revoke(sha('public chunk'), 'peer/t', 'session-b')).toMatchObject({ ok: false, code: 'not-found' })
    store.stage(Buffer.from('public chunk'), { name: 'c', to: 'peer/t', by: 'session-b' })
    expect(store.grantsBy('session-a')).toHaveLength(1)
    expect(store.grantsBy('session-b')).toHaveLength(1)
    expect(store.revoke(sha('public chunk'), 'peer/t', 'session-b')).toMatchObject({ ok: true, reclaimed: false, bytes: 0 })
    for (const s of [store, new BlobStore(root)]) {
      expect(s.grantsBy('session-a')).toHaveLength(1)
      expect(s.grantsBy('session-b')).toEqual([])
      const grant = s.grantFor(sha('public chunk'), ['peer/t'])!
      expect(grant.by).toBe('session-a')
      expect(s.read(grant)).toEqual(Buffer.from('public chunk'))
    }
  })

  it('F3: a revoke whose write fails changes nothing — the retry revokes it, and a restart never brings a revoked grant back', () => {
    const root = mkdtempSync(join(tmpdir(), 'bg-f3-'))
    const store = new BlobStore(root)
    store.stage(Buffer.from('shared'), { name: 's', to: 'peer/x', by: 'session-a' })
    store.stage(Buffer.from('shared'), { name: 's', to: 'peer/y', by: 'session-b' })
    // The write cannot happen (a directory where its tmp file goes): not a policy denial, a failing write.
    const blocker = join(root, `blob-grants.json.tmp-${String(process.pid)}`)
    mkdirSync(blocker)
    expect(() => store.revoke(sha('shared'), 'peer/x', 'session-a')).toThrow()
    expect(store.grantsBy('session-a')).toHaveLength(1)
    expect(new BlobStore(root).grantsBy('session-a')).toHaveLength(1)
    rmSync(blocker, { recursive: true })
    expect(store.revoke(sha('shared'), 'peer/x', 'session-a')).toMatchObject({ ok: true, reclaimed: false })
    const after = new BlobStore(root)
    expect(after.grantsBy('session-a')).toEqual([])
    expect(after.grantFor(sha('shared'), ['peer/x'])).toBeUndefined()
    expect(after.grantFor(sha('shared'), ['peer/y'])).toBeDefined()
  })

  it('F3: bytes left behind by a stop between the written revoke and the delete are deleted at the next start', () => {
    const root = mkdtempSync(join(tmpdir(), 'bg-f3b-'))
    new BlobStore(root).stage(Buffer.from('orphan'), { name: 'o', to: 'peer/x', by: 'session-a' })
    // The revoke's write happened; the process stopped before the delete.
    writeFileSync(join(root, 'blob-grants.json'), JSON.stringify({ grants: [] }))
    expect(existsSync(join(root, 'blobs', sha('orphan')))).toBe(true)
    new BlobStore(root)
    expect(existsSync(join(root, 'blobs', sha('orphan')))).toBe(false)
  })

  it('provenance: the same sender re-sending extends the expiry and keeps its first task and fetch record, across a restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'bg-prov-'))
    let now = 1_000
    const store = new BlobStore(root, () => now)
    store.stage(Buffer.from('p'), { name: 'p', to: 'peer/x', by: 'session-a', taskId: 'direct-first' })
    store.noteFetch(store.grantFor(sha('p'), ['peer/x'])!)
    const first = store.grantsBy('session-a')[0]!
    now = 5_000
    store.stage(Buffer.from('p'), { name: 'p', to: 'peer/x', by: 'session-a' })
    store.stage(Buffer.from('p'), { name: 'p', to: 'peer/x', by: 'session-a', taskId: 'direct-second' })
    for (const g of [store.grantsBy('session-a')[0]!, new BlobStore(root, () => now).grantsBy('session-a')[0]!]) {
      expect(g).toMatchObject({ taskId: 'direct-first', fetches: 1, firstFetchedAt: 1_000, grantedAt: first.grantedAt })
      expect(g.expiresAt).toBeGreaterThan(first.expiresAt)
    }
  })
})

describe('a2a_file_grants / a2a_file_revoke and the task on a send', () => {
  function harness() {
    const defs = new Map<string, Def>()
    const store = new BlobStore(mkdtempSync(join(tmpdir(), 'bg-tools-')))
    const deps: FileToolsDeps = {
      ctx: { tools: { register: (d: Def) => { defs.set(d.name, d); return () => {} } } } as never,
      config: { apiKey: '', team: 'dsh' }, blobStore: store, canvasMembersOf: () => [], ownCardUrl: () => 'http://127.0.0.1:3999',
      sessionTeamOf: agent => `dsh/${String(agent.id).slice(8, 16)}`, a2aJoinGateRefusal: () => {},
      routeTrunk: async args => localRoute({ ok: true, team: args.team, task_id: 'direct-route1', reply: 'delivered' }) as never,
      peerFetch: async () => { throw new Error('no network') }, originClaimHeaders: () => ({}),
    }
    const tools = createFileTools(deps)
    tools.registerFileSend(); tools.registerFileFetch(); tools.registerFileGrants(); tools.registerFileRevoke()
    const ws = mkdtempSync(join(tmpdir(), 'bg-ws-'))
    const as = (id: string) => (name: string, args: unknown) => defs.get(name)!.execute(args, { agent: { id, session: { header: { cwd: ws } } }, signal: new AbortController().signal })
    return { store, ws, a: as('session-aaaa1111'), b: as('session-bbbb2222') }
  }

  it('a send records the route\'s task on its grants, or the task_id the caller gave', async () => {
    const h = harness()
    writeFileSync(join(h.ws, 'x.txt'), 'x')
    writeFileSync(join(h.ws, 'y.txt'), 'y')
    expect(await h.a('a2a_file_send', { paths: ['x.txt'], team: 'peer/x' })).toMatchObject({ ok: true })
    expect(await h.a('a2a_file_send', { paths: ['y.txt'], team: 'peer/x', task_id: 'direct-parent' })).toMatchObject({ ok: true })
    const listed = await h.a('a2a_file_grants', {}) as { grants: Array<{ name: string; taskId?: string; fetched: boolean }> }
    expect(listed.grants.map(g => [g.name, g.taskId, g.fetched]).sort()).toEqual([['x.txt', 'direct-route1', false], ['y.txt', 'direct-parent', false]])
    expect(await h.a('a2a_file_send', { paths: ['x.txt'], team: 'peer/x', task_id: 'no spaces' })).toMatchObject({ ok: false })
  })

  it('a session lists only its own grants and revokes only its own; another session\'s revoke changes nothing', async () => {
    const h = harness()
    writeFileSync(join(h.ws, 'mine.bin'), 'mine')
    await h.a('a2a_file_send', { paths: ['mine.bin'], team: 'peer/x' })
    expect(((await h.b('a2a_file_grants', {})) as { grants: unknown[] }).grants).toEqual([])
    expect(await h.b('a2a_file_revoke', { sha256: sha('mine'), to: 'peer/x' })).toMatchObject({ ok: false, code: 'not-found' })
    expect(((await h.a('a2a_file_grants', {})) as { grants: unknown[]; usage: { files: number } })).toMatchObject({ grants: [expect.objectContaining({ sha256: sha('mine') })], usage: { files: 1 } })
    expect(await h.a('a2a_file_revoke', { sha256: sha('mine'), to: 'peer/x' })).toMatchObject({ ok: true, reclaimed: true, bytes: 4 })
    expect(((await h.a('a2a_file_grants', {})) as { usage: { files: number; bytes: number } }).usage).toMatchObject({ files: 0, bytes: 0 })
  })

  it('a fetch from this host\'s own store marks the grant fetched', async () => {
    const h = harness()
    // Granted by A to B's own session team; B pulls it locally.
    h.store.stage(Buffer.from('to-b'), { name: 'b.txt', to: 'dsh/bbbb2222', by: 'session-aaaa1111' })
    const ref = formatFileRef({ sha256: sha('to-b'), size: 4, name: 'b.txt', from: 'http://127.0.0.1:3999' })
    expect(await h.b('a2a_file_fetch', { ref })).toMatchObject({ ok: true })
    expect(((await h.a('a2a_file_grants', {})) as { grants: Array<Record<string, unknown>> }).grants[0]).toMatchObject({ fetched: true, fetches: 1, firstFetchedAt: expect.any(String) })
  })
})
