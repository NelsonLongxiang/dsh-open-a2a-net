// @vitest-environment node
/** #808 P2: the team builder's blueprint sets this host's network settings, key by key, after the owner agrees. */
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StaffingExecutor, applyNetworkOp, type NetworkSettings, type StaffingChange, type StaffingDeps } from '../../src/superagent/host/staffing.ts'
import { networkDeps } from '../../src/superagent/host/staffing-wiring.ts'
import { writeHomeA2a } from '../../src/owner-settings.ts'
import { Config } from '../../src/config.ts'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { blueprintDiff } from '../../src/superagent/host/builder-tools.ts'

const PEER = 'http://peer.example:13080', CLAIM = 'http://self.tailnet:3081'
function world(start: Partial<NetworkSettings> = {}, failWrite?: (c: Partial<NetworkSettings>) => boolean) {
  let net: NetworkSettings = { peers: [], announce: false, teamScope: true, originClaimUrl: '', originClaimAudiences: [], originClaimByPeer: {}, ...start }
  const writes: Array<Partial<NetworkSettings>> = []
  const deps: StaffingDeps = {
    path: join(mkdtempSync(join(tmpdir(), 'staffing-net-')), 'staffing.json'), now: () => new Date().toISOString(), logger: { info: () => {}, warn: () => {} },
    team: () => undefined, teamOfCanvas: () => undefined, canvasExists: () => false, canvasCreate: () => ({ ok: true }), canvasRemove: () => true,
    canvasAddLocal: async () => ({ ok: true }), canvasRemoveLocal: () => true, teamAdd: () => ({ ok: false, error: 'x' }), teamUnbind: () => true,
    networkRead: () => net,
    networkWrite: changes => { if (failWrite?.(changes)) return { ok: false, error: 'write refused' }; writes.push(changes); net = { ...net, ...changes }; return { ok: true } },
  }
  return { x: new StaffingExecutor(deps), writes, net: () => net }
}
const sub = (w: ReturnType<typeof world>, id: string, ops: StaffingChange['ops'], source: StaffingChange['source'] = 'owner-local') => w.x.submit({ id, source, by: {}, ops })

describe('#808 P2 network ops', () => {
  it('waits for the owner, then adds a peer and its per-peer claim in one blueprint, writing only those keys', async () => {
    const w = world()
    expect(await sub(w, 'n1', [{ op: 'network.peer.add', params: { url: PEER } }, { op: 'network.originClaimByPeer.set', params: { peer: PEER, url: CLAIM } }])).toMatchObject({ ok: true, entry: { state: 'awaiting' } })
    expect(w.writes).toEqual([])
    await w.x.agree('n1', 'test')
    expect(w.x.get('n1')!.state).toBe('done')
    expect(w.writes).toEqual([{ peers: [PEER] }, { originClaimByPeer: { [PEER]: CLAIM } }])
  })

  it('refuses an originClaimByPeer key not written exactly as in peers (boot would ignore it silently)', async () => {
    const w = world({ peers: [PEER] })
    expect(await sub(w, 'n2', [{ op: 'network.originClaimByPeer.set', params: { peer: PEER + '/', url: CLAIM } }])).toMatchObject({ ok: false, code: 'invalid' })
    expect(w.x.list()).toHaveLength(0)
  })

  it('is off for the market, refuses credentials and malformed values', async () => {
    const w = world()
    expect(await sub(w, 'm', [{ op: 'network.peer.add', params: { url: PEER } }], 'market:market/0123456789abcdef')).toMatchObject({ ok: false, code: 'off' })
    expect(await sub(w, 'k', [{ op: 'network.set', params: { apiKey: 'x' } }])).toMatchObject({ ok: false, code: 'not-allowed' })
    expect(await sub(w, 'b', [{ op: 'network.set', params: { originClaimAudiences: ['not a url'] } }])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'e', [{ op: 'network.set', params: {} }])).toMatchObject({ ok: false, code: 'invalid' })
    expect(await sub(w, 'r', [{ op: 'network.peer.remove', params: { url: PEER } }])).toMatchObject({ ok: false, code: 'invalid' })
    expect(w.writes).toEqual([])
  })

  it('a later failing step writes every touched key back to its previous value', async () => {
    const w = world({ originClaimUrl: 'http://old.example:3080' }, c => 'originClaimByPeer' in c && Object.keys(c.originClaimByPeer ?? {}).length > 0)
    await sub(w, 'n3', [{ op: 'network.set', params: { originClaimUrl: CLAIM, teamScope: false } }, { op: 'network.peer.add', params: { url: PEER } }, { op: 'network.originClaimByPeer.set', params: { peer: PEER, url: CLAIM } }])
    await w.x.agree('n3', 'test')
    expect(w.x.get('n3')!.steps.map(s => s.state)).toEqual(['undone', 'undone', 'failed'])
    expect(w.net()).toMatchObject({ originClaimUrl: 'http://old.example:3080', teamScope: true, peers: [] })
  })

  it('the owner reads the change only, and that it takes effect on restart', () => {
    const lines = blueprintDiff([{ op: 'network.peer.add', params: { url: PEER } }, { op: 'network.set', params: { teamScope: false } }], () => undefined)
    expect(lines[0]).toBe('1. 本机对等方加 ' + PEER + '（重启后生效）')
    expect(lines[1]).toContain('teamScope = false')
    expect(lines[1]).toContain('重启后生效')
  })
})

describe('#817 review findings', () => {
  const cfg = (x: Record<string, unknown> = {}) => Config(x as never) as unknown as Record<string, unknown>
  const fs = { exists: existsSync, read: (p: string) => readFileSync(p, 'utf8'), write: (p: string, s: string) => writeFileSync(p, s, 'utf8'), mkdir: (p: string) => { mkdirSync(p, { recursive: true }) } }
  const home = () => mkdtempSync(join(tmpdir(), 'net-home-'))

  it('R1: an unset teamScope reads as on (as the host reads it), so an undo never writes teamScope: false', () => {
    expect(networkDeps(home(), cfg()).networkRead().teamScope).toBe(true)
    expect(networkDeps(home(), cfg({ teamScopeRouting: false })).networkRead().teamScope).toBe(false)
    expect(networkDeps(home(), cfg({ teamScope: false })).networkRead().teamScope).toBe(false)
  })

  it('R2: a workbench write before a restart is the base a blueprint reads (and so what its undo restores)', () => {
    const h = home()
    expect(writeHomeA2a(h, { teamScope: false, announce: true }, cfg(), cfg(), fs)).toMatchObject({ ok: true })
    const read = networkDeps(h, cfg()).networkRead()
    expect(read.teamScope).toBe(false)
    expect(read.announce).toBe(true)
  })

  it('R3: a per-peer claim that would name the same peer twice with different URLs is refused', () => {
    const s: NetworkSettings = { peers: [PEER, PEER + '/'], announce: false, teamScope: true, originClaimUrl: '', originClaimAudiences: [], originClaimByPeer: { [PEER]: CLAIM } }
    expect(applyNetworkOp('network.originClaimByPeer.set', { peer: PEER + '/', url: 'http://other.tailnet:3081' }, s)).toMatchObject({ ok: false })
    expect(applyNetworkOp('network.originClaimByPeer.set', { peer: PEER, url: 'http://other.tailnet:3081' }, s)).toMatchObject({ ok: true })
  })
})
