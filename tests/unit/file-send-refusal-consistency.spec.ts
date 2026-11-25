/**
 * Refusal consistency (ticket 9c22cfa8): what happens to the grants a2a_file_send staged when the
 * route is refused. Three tiers, by what the refusal proves:
 * - a host-local refusal (routeTrunk's local-route shape) proves nothing left this host → this call's
 *   NEW grants are rolled back; a pre-existing grant of the same (sha256, to, by) is kept (only its
 *   expiry was extended); another audience's grant on a shared blob is untouched.
 * - a refusal from beyond this host (or an unknown outcome) proves nothing → grants stay live and the
 *   result says so with the exact revoke entry (a delivered reference must keep working).
 * - the join gate throws BEFORE staging → nothing is staged at all.
 * All materials synthetic and non-sensitive.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BlobStore } from '../../src/blob-store.ts'
import { createFileTools, type FileToolsDeps } from '../../src/tools/files.ts'
import { localRoute } from '../../src/node-self.ts'

type Def = { name: string; execute: (args: unknown, exec: unknown) => Promise<Record<string, unknown>> }
const sha = (b: string): string => createHash('sha256').update(b).digest('hex')
const OWN = 'http://127.0.0.1:3999'

function harness(over: Partial<FileToolsDeps> = {}) {
  const defs = new Map<string, Def>()
  const routed: Array<{ team: string; message: string; async?: boolean }> = []
  const store = new BlobStore(mkdtempSync(join(tmpdir(), 'rc-store-')))
  const deps: FileToolsDeps = {
    ctx: { tools: { register: (d: Def) => { defs.set(d.name, d); return () => {} } } } as never,
    config: { apiKey: '', team: 'dsh' },
    blobStore: store,
    canvasMembersOf: () => [],
    ownCardUrl: () => OWN,
    sessionTeamOf: () => 'dsh/aaaa1111',
    a2aJoinGateRefusal: () => {},
    routeTrunk: async (args) => { routed.push(args); return localRoute({ ok: true, team: args.team, task_id: 'direct-t1' }) as never },
    peerFetch: async () => { throw new Error('no network in this test') },
    originClaimHeaders: () => ({}),
    ...over,
  }
  const tools = createFileTools(deps)
  tools.registerFileSend()
  const ws = mkdtempSync(join(tmpdir(), 'rc-ws-'))
  const agent = { id: 'session-aaaa1111', session: { header: { cwd: ws } } }
  const exec = { agent, signal: new AbortController().signal }
  return { defs, routed, store, ws, run: (args: unknown) => defs.get('a2a_file_send')!.execute(args, exec) }
}

describe('a2a_file_send refusal consistency', () => {
  it('a host-local refusal rolls this call\'s new grants back, keeps a pre-existing grant and other audiences', async () => {
    const h = harness({ routeTrunk: async () => localRoute({ ok: false, error: '[superagent-team-address] the team\'s internal mailbox', code: -32000 }) as never })
    writeFileSync(join(h.ws, 'new.txt'), '新的合成件')
    writeFileSync(join(h.ws, 'again.txt'), '重发件')
    // A prior legitimate grant by THIS session for one of the files (same sha, same to): stage() extends it; rollback must keep it.
    h.store.stage(Buffer.from('重发件'), { name: 'again.txt', to: 'peer/bbbb2222', by: 'session-aaaa1111' })
    // Another audience\'s grant on a different file: untouched by construction.
    h.store.stage(Buffer.from('别人的受众'), { name: 'x', to: 'peer/other', by: 'session-aaaa1111' })
    const out = await h.run({ paths: ['new.txt', 'again.txt'], team: 'peer/bbbb2222' })
    expect(out).toEqual(expect.objectContaining({ ok: false, grants: 'rolled-back', rolled_back: 1, kept_pre_existing: 1, peer_content: false }))
    expect(h.store.grantFor(sha('新的合成件'), ['peer/bbbb2222'])).toBeUndefined()
    expect(h.store.grantFor(sha('重发件'), ['peer/bbbb2222'])).toBeDefined()
    expect(h.store.grantFor(sha('别人的受众'), ['peer/other'])).toBeDefined()
    expect(h.store.usage().files).toBe(2)
  })

  it('a refusal from beyond this host keeps the grants live and the result says how to revoke them', async () => {
    const h = harness({ routeTrunk: async () => ({ ok: false, error: '[superagent-member-inbound] a team member takes work only as assignments', code: -32000 }) as never })
    writeFileSync(join(h.ws, '补件.txt'), '合成非敏感内容')
    const out = await h.run({ paths: ['补件.txt'], team: 'dsh/446ce672' })
    expect(out).toEqual(expect.objectContaining({ ok: false, grants: 'live', peer_content: true }))
    expect(out.revoke).toEqual([{ sha256: sha('合成非敏感内容'), to: 'dsh/446ce672' }])
    expect(h.store.grantFor(sha('合成非敏感内容'), ['dsh/446ce672'])).toBeDefined()
    expect(h.store.usage().files).toBe(1)
  })

  it('the join gate throws before anything is staged', async () => {
    const h = harness({ a2aJoinGateRefusal: () => { throw new Error('未加入网络') } })
    writeFileSync(join(h.ws, 'a.txt'), 'x')
    await expect(h.run({ paths: ['a.txt'], team: 'peer/bbbb2222' })).rejects.toThrow('未加入网络')
    expect(h.store.usage()).toMatchObject({ files: 0 })
  })

  it('a staging failure mid-send rolls back the files already staged (pre-existing kept, nothing routed)', async () => {
    const h = harness()
    writeFileSync(join(h.ws, '件一.txt'), '首件内容')
    // A prior legitimate grant of the SAME bytes and target by THIS session: must survive the rollback.
    h.store.stage(Buffer.from('首件内容'), { name: '件一.txt', to: 'peer/bbbb2222', by: 'session-aaaa1111' })
    writeFileSync(join(h.ws, '件二.txt'), '次件内容')
    const out = await h.run({ paths: ['件一.txt', '件二.txt', 'missing.txt'], team: 'peer/bbbb2222' })
    expect(out).toEqual(expect.objectContaining({ ok: false, grants: 'rolled-back', rolled_back: 1, kept_pre_existing: 1 }))
    expect(h.routed).toHaveLength(0)
    // 件一's grant was pre-existing → kept (extended); 件二's fresh grant → rolled back.
    expect(h.store.grantFor(sha('首件内容'), ['peer/bbbb2222'])).toBeDefined()
    expect(h.store.grantFor(sha('次件内容'), ['peer/bbbb2222'])).toBeUndefined()
    expect(h.store.usage().files).toBe(1)
  })

  it('a successful send keeps its exact shape: grants live, no consistency fields added', async () => {
    const h = harness()
    writeFileSync(join(h.ws, 'ok.txt'), '好件')
    const out = await h.run({ paths: ['ok.txt'], team: 'peer/bbbb2222' })
    expect(out).toEqual(expect.objectContaining({ ok: true, team: 'peer/bbbb2222', task_id: 'direct-t1', peer_content: false }))
    expect(out.grants).toBeUndefined()
    expect(out.revoke).toBeUndefined()
    expect(h.store.grantFor(sha('好件'), ['peer/bbbb2222'])).toBeDefined()
    expect(h.routed).toHaveLength(1)
  })

  it('an UNKNOWN acceptance marked local revokes nothing: the grants stay live (#854 review B1)', async () => {
    const h = harness({ routeTrunk: async () => localRoute({ ok: false, acceptance: 'unknown', error: 'the local delivery outcome is unknown', code: -32000 }) as never })
    writeFileSync(join(h.ws, 'maybe.txt'), '结果未知的合成件')
    const out = await h.run({ paths: ['maybe.txt'], team: 'peer/bbbb2222' })
    expect(out.ok).toBe(false)
    expect(out.grants).toBe('live')
    expect(h.store.grantsBy('session-aaaa1111').some(g => g.sha256 === sha('结果未知的合成件') && g.to === 'peer/bbbb2222')).toBe(true)
  })

  it('a local refusal does not revoke a grant a concurrent send re-staged and delivered (#854 review B2)', async () => {
    let releaseA: () => void = () => {}
    const aHeld = new Promise<void>(r => { releaseA = r })
    let aEntered: () => void = () => {}
    const aInTrunk = new Promise<void>(r => { aEntered = r })
    let calls = 0
    const h = harness({
      routeTrunk: async () => {
        calls += 1
        if (calls === 1) { aEntered(); await aHeld; return localRoute({ ok: false, error: 'refused on this host', code: -32000 }) as never }
        return localRoute({ ok: true, team: 'peer/bbbb2222', task_id: 'direct-b' }) as never
      },
    })
    writeFileSync(join(h.ws, 'shared.txt'), '并发同一文件')
    const a = h.run({ paths: ['shared.txt'], team: 'peer/bbbb2222' })
    await aInTrunk
    const b = await h.run({ paths: ['shared.txt'], team: 'peer/bbbb2222' })
    expect(b.ok).toBe(true)
    releaseA()
    const outA = await a
    expect(outA.grants).toBe('rolled-back')
    expect(outA.rolled_back).toBe(0)
    expect(outA.kept_concurrent).toBe(1)
    expect(h.store.grantsBy('session-aaaa1111').some(g => g.sha256 === sha('并发同一文件') && g.to === 'peer/bbbb2222')).toBe(true)
  })
})
