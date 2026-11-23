/**
 * grant-only file grants: `a2a_file_send { grant_only: true }` stages the grants for a designated
 * audience and routes NO message — the "[A2A file] v1 …" reference lines come back in the result for
 * the sender to hand over through an admitted channel (a member seat takes no direct delivery:
 * [superagent-member-inbound] refuses a routed send whose target is a member session). The audience
 * boundary is the pull admission's own (grantAdmits, unchanged); old calls keep their exact behavior.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BlobStore, parseFileRef } from '../../src/blob-store.ts'
import { createFileTools, type FileToolsDeps } from '../../src/tools/files.ts'
import { localRoute } from '../../src/node-self.ts'

type Def = { name: string; execute: (args: unknown, exec: unknown) => Promise<Record<string, unknown>> }
const sha = (b: string): string => createHash('sha256').update(b).digest('hex')
const OWN = 'http://127.0.0.1:3999'

function harness(over: Partial<FileToolsDeps> = {}) {
  const defs = new Map<string, Def>()
  const routed: Array<{ team: string; message: string; async?: boolean }> = []
  const store = new BlobStore(mkdtempSync(join(tmpdir(), 'fg-store-')))
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
  tools.registerFileFetch()
  const ws = mkdtempSync(join(tmpdir(), 'fg-ws-'))
  const agent = { id: 'session-aaaa1111', session: { header: { cwd: ws } } }
  const exec = { agent, signal: new AbortController().signal }
  return { defs, routed, store, ws, exec, run: (name: string, args: unknown) => defs.get(name)!.execute(args, exec) }
}

describe('a2a_file_send grant_only', () => {
  it('stages the grants, routes NO message, and returns the reference lines for the sender to hand over', async () => {
    const h = harness()
    writeFileSync(join(h.ws, '甲.txt'), '甲件')
    const out = await h.run('a2a_file_send', { paths: ['甲.txt'], team: 'dsh/446ce672', grant_only: true, task_id: 'ticket-290adbb9' })
    expect(out).toEqual(expect.objectContaining({ ok: true, team: 'dsh/446ce672', grant_only: true, notified: false, task_id: 'ticket-290adbb9', peer_content: false }))
    expect(h.routed).toHaveLength(0)
    expect((out.refs as string[]).map(l => parseFileRef(l))).toEqual([{ sha256: sha('甲件'), size: Buffer.byteLength('甲件'), name: '甲.txt', from: OWN }])
    expect(h.store.grantFor(sha('甲件'), ['dsh/446ce672'])).toMatchObject({ taskId: 'ticket-290adbb9' })
    // Old calls in the same place keep their exact behavior: one routed message, the trunk's task id.
    const old = await h.run('a2a_file_send', { paths: ['甲.txt'], team: 'peer/bbbb2222' })
    expect(old).toEqual(expect.objectContaining({ ok: true, team: 'peer/bbbb2222', task_id: 'direct-t1' }))
    expect(old.refs).toBeUndefined()
    expect(h.routed).toHaveLength(1)
  })

  it('the designated member pulls; any other session stays not-granted', async () => {
    const store = new BlobStore(mkdtempSync(join(tmpdir(), 'fg-share-')))
    const sender = harness({ blobStore: store })
    writeFileSync(join(sender.ws, '补件.txt'), 'synthetic non-sensitive payload')
    const out = await sender.run('a2a_file_send', { paths: ['补件.txt'], team: 'dsh/446ce672', grant_only: true })
    expect(out.ok).toBe(true)
    const ref = (out.refs as string[])[0]!
    const member = harness({ blobStore: store, sessionTeamOf: () => 'dsh/446ce672' })
    const outsider = harness({ blobStore: store, sessionTeamOf: () => 'dsh/bbbb9999' })
    expect(await member.run('a2a_file_fetch', { ref })).toEqual(expect.objectContaining({ ok: true, sha256: sha('synthetic non-sensitive payload') }))
    expect(await outsider.run('a2a_file_fetch', { ref })).toEqual(expect.objectContaining({ ok: false, code: 'not-granted' }))
  })

  it('refuses note with grant_only, and stages nothing', async () => {
    const h = harness()
    writeFileSync(join(h.ws, 'a.txt'), 'x')
    expect(await h.run('a2a_file_send', { paths: ['a.txt'], team: 'dsh/446ce672', grant_only: true, note: '请查收' })).toEqual(expect.objectContaining({ ok: false }))
    expect(h.routed).toHaveLength(0)
    expect(h.store.usage()).toMatchObject({ files: 0 })
  })

  it('keeps the shared refusals: no card URL, a bad task_id; an unjoined session is gated before staging', async () => {
    const noCard = harness({ ownCardUrl: () => '' })
    writeFileSync(join(noCard.ws, 'a.txt'), 'x')
    expect(await noCard.run('a2a_file_send', { paths: ['a.txt'], team: 't', grant_only: true })).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining('publishes no card URL') as unknown }))
    const h = harness()
    writeFileSync(join(h.ws, 'a.txt'), 'x')
    expect(await h.run('a2a_file_send', { paths: ['a.txt'], team: 't', grant_only: true, task_id: 'no spaces' })).toEqual(expect.objectContaining({ ok: false }))
    expect(h.store.usage()).toMatchObject({ files: 0 })
    const gated = harness({ a2aJoinGateRefusal: () => { throw new Error('未加入网络') } })
    writeFileSync(join(gated.ws, 'a.txt'), 'x')
    await expect(gated.run('a2a_file_send', { paths: ['a.txt'], team: 't', grant_only: true })).rejects.toThrow('未加入网络')
    expect(gated.store.usage()).toMatchObject({ files: 0 })
  })
})
