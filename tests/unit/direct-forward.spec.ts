import { describe, expect, it, vi } from 'vitest'
import { createDirectForward, ForwardBirths, type DirectForwardDeps, type ForwardRequest } from '../../src/direct-forward.ts'
import { TaskLedger } from '../../src/task-ledger.ts'
import { checkGuardAtIngress, DEFAULT_HOP_BUDGET } from '../../src/recursion-guard.ts'
import type { A2aPeerCard, A2aRouteResult } from '../../src/types.ts'
const request: ForwardRequest = { team: 'beta/01234567', caller: 'ops-cli/a1b2c3d4e5f60718', taskId: 'direct-fwd', message: 'hello', contextId: 'ctx', noWait: true, localCliProof: true, guarded: false }
const ok: A2aRouteResult = { ok: true, team: request.team, reply: '', task_id: request.taskId, context_id: 'ctx', task_status: 'TASK_STATE_DELIVERED' }
function fixture(results: A2aRouteResult[] = [ok]) {
  const ledger = new TaskLedger('')
  const sent: Array<{ url: string; request: ForwardRequest; guard: string }> = []
  const deps: DirectForwardDeps = { births: new ForwardBirths(), enabled: () => true, isolated: () => false, deposited: () => true, memberLinked: () => true, scope: async () => ({ ok: true }),
    candidates: async () => ({ urls: results.map((_, i) => 'https://peer' + i + '.test'), card: async () => ({ publicKey: 'key', session: 'host' } as A2aPeerCard) }),
    dispatch: async (url, r, guard) => { sent.push({ url, request: r, guard }); return results[sent.length - 1]! }, ledger, activity: () => {},
  }
  return { deps, ledger, sent }
}
describe('one-hop CLI forwarding', () => {
  it('#275 exactly 64 eligible dispatches wait for birth; 65th carries task_id, gates retain precedence and released slots recover', async () => {
    const x = fixture(), pending: Array<() => void> = []
    let dispatched=0
    x.deps.dispatch=async (_url,r) => { dispatched++; if(r.taskId==='receipt-at-cap') return ok; await new Promise<void>(resolve=>pending.push(resolve)); return {...ok,task_id:r.taskId} }
    const forward=createDirectForward(x.deps)
    const flights=Array.from({length:64},(_,i)=>forward({...request,taskId:'cap-'+i}))
    await vi.waitFor(()=>expect(dispatched).toBe(64))
    let released=false
    const waiting=x.deps.births.wait('cap-0')!.then(()=>{released=true})
    expect(released).toBe(false)
    expect(await forward({...request,taskId:'cap-65'})).toMatchObject({ok:false,task_id:'cap-65',error:expect.stringContaining('capacity')})
    x.deps.enabled=()=>false
    expect(await forward({...request,taskId:'disabled-at-cap'})).toMatchObject({task_id:'disabled-at-cap',error:expect.stringContaining('forwardDirect is off')})
    x.deps.enabled=()=>true
    expect(await forward({...request,guarded:true,taskId:'guard-at-cap'})).toMatchObject({task_id:'guard-at-cap',error:expect.stringContaining('already forwarded')})
    x.deps.scope=async()=>({ok:false,error:'scope gate'})
    expect(await forward({...request,taskId:'scope-at-cap'})).toMatchObject({task_id:'scope-at-cap',error:expect.stringContaining('scope gate')})
    x.deps.scope=async()=>({ok:true})
    x.deps.candidates=async()=>({urls:['https://peer'],card:async()=>({publicKey:'key',canvasOrg:[{team:'beta/canvas/ops',name:'ops',members:['beta/aaaaaaaa']}]} as A2aPeerCard)})
    x.deps.memberLinked=()=>false
    expect(await forward({...request,team:'beta/canvas/ops',taskId:'link-at-cap'})).toMatchObject({task_id:'link-at-cap',error:expect.stringContaining('direct operator link')})
    expect(await forward({...request,taskId:'receipt-at-cap',message:'[A2A receipt] task earlier done'})).toMatchObject({ok:true,receipt:'none'})
    pending.shift()!(); await waiting; expect(released).toBe(true)
    expect(x.ledger.find('cap-0')).toBeDefined()
    const recovered=forward({...request,taskId:'recovered'})
    await vi.waitFor(()=>expect(dispatched).toBe(66))
    pending.splice(0).forEach(release=>release());await Promise.all([...flights,recovered])
    expect(x.deps.births.wait('cap-0')).toBeUndefined()
  })
  it('#275 dispatch exceptions release the birth waiter without manufacturing a row', async () => {
    const x=fixture();x.deps.dispatch=async()=>{throw Error('dispatch failed')}
    await expect(createDirectForward(x.deps)(request)).rejects.toThrow('dispatch failed')
    expect(x.deps.births.wait(request.taskId)).toBeUndefined();expect(x.ledger.list()).toEqual([])
  })

  it('fails over refusals but sends the original identity with one decremented guard and one row', async () => {
    const x = fixture([{ ok: false, code: -32000, error: 'stale target' }, ok])
    expect((await createDirectForward(x.deps)(request)).ok).toBe(true)
    expect(x.sent).toHaveLength(2)
    expect(x.sent.every(x => x.request === request)).toBe(true)
    const guard = checkGuardAtIngress(x.sent[0]!.guard)
    expect(guard.kind).toBe('ok')
    if (guard.kind === 'ok') { expect(guard.guard.hopBudget).toBe(DEFAULT_HOP_BUDGET - 1); expect(guard.guard.visitToken).not.toBe('') }
    expect(x.sent[1]!.guard).toBe(x.sent[0]!.guard)
    expect(x.ledger.list()).toHaveLength(1)
    expect(x.ledger.list()[0]).toMatchObject({ direction: 'outbound', forwarded: true, sender: { kind: 'cli', id: request.caller }, peer: 'https://peer1.test' })
  })
  it('forwarded receipts and native bridge deliveries never create receipt debt', async () => {
    const receipt = fixture()
    expect(await createDirectForward(receipt.deps)({ ...request, message: '[A2A receipt] task prior-task done' })).toMatchObject({ ok: true, receipt: 'none' })
    expect(receipt.ledger.list()).toHaveLength(0)
    const uncertain = fixture([{ ok: false, code: -32005, error: 'wait expired' }])
    expect(await createDirectForward(uncertain.deps)({ ...request, message: '[A2A receipt] task prior-task done', noWait: false })).toMatchObject({ ok: false, code: -32005, receipt: 'none' })
    expect(uncertain.ledger.list()).toHaveLength(0)
    const bridge = fixture([{ ...ok, bridge: 'native-teams', receipt: 'none' }])
    expect(await createDirectForward(bridge.deps)(request)).toMatchObject({ ok: true, bridge: 'native-teams', receipt: 'none' })
    expect(bridge.ledger.list()).toHaveLength(0)
    const none = fixture([{ ...ok, receipt: 'none' }])
    await createDirectForward(none.deps)(request)
    expect(none.ledger.list()[0]?.receiptExpected).toBe(false)
  })
  it('does not fail over an uncertain sync timeout or an idempotency verdict', async () => {
    for (const code of [-32005, -32002, -32003]) {
      const x = fixture([{ ok: false, code, error: 'terminal or uncertain' }, ok])
      expect((await createDirectForward(x.deps)({ ...request, noWait: false }))).toMatchObject({ ok: false, code })
      expect(x.sent).toHaveLength(1)
      expect(x.ledger.list()).toHaveLength(code === -32005 ? 1 : 0)
    }
  })
  it('an async transport budget with unknown delivery does not try another candidate', async () => {
    const x = fixture([{ ok: false, code: -32000, error: 'transport timeout', ownBudgetExhausted: true }, ok])
    expect(await createDirectForward(x.deps)(request)).toMatchObject({ ok: false, code: -32005 })
    expect(x.sent).toHaveLength(1)
    expect(x.ledger.list()).toHaveLength(1)
  })
  it('a canvas candidate requires direct return links to every advertised receiving member', async () => {
    const x = fixture()
    const team = 'beta/canvas/ops'
    x.deps.candidates = async () => ({ urls: ['https://peer.test'], card: async () => ({ canvasOrg: [{ team, name: 'ops', members: [request.caller, 'beta/aaaaaaaa', 'beta/bbbbbbbb'] }], sessionTeams: [{ team: 'beta/aaaaaaaa' }] } as A2aPeerCard) })
    x.deps.memberLinked = member => member === 'beta/aaaaaaaa'
    expect((await createDirectForward(x.deps)({ ...request, team })).ok).toBe(false)
    expect(x.sent).toHaveLength(0)
    x.deps.memberLinked = () => true
    expect((await createDirectForward(x.deps)({ ...request, team })).ok).toBe(true)
  })
  it('#272 a peer without delivered_to uses frozen canvas membership, never the canvas handle as a receiver', async () => {
    const x = fixture(), team = 'beta/canvas/ops'
    x.deps.candidates = async () => ({ urls: ['https://peer.test'], card: async () => ({ publicKey: 'peer-key', session: 'peer-host', canvasOrg: [{ team, name: 'ops', members: [request.caller, 'beta/aaaaaaaa'] }] } as A2aPeerCard) })
    await createDirectForward(x.deps)({ ...request, team })
    expect(x.ledger.list()[0]).toMatchObject({ receiverMembers: ['beta/aaaaaaaa'], peerKey: 'peer-key', forwarded: true })
    expect(x.ledger.list()[0]!.deliveredTo).toBeUndefined()
  })

  it('a deposit expiring during directory lookup is not dispatched', async () => {
    const x = fixture()
    let online = true
    x.deps.deposited = () => online
    const candidates = x.deps.candidates
    x.deps.candidates = async (...args) => { const result = await candidates(...args); online = false; return result }
    expect((await createDirectForward(x.deps)(request)).ok).toBe(false)
    expect(x.sent).toHaveLength(0)
  })
  it('every forwarding prerequisite refuses before any peer dispatch', async () => {
    for (const over of [{ enabled: () => false }, { isolated: () => true }, { deposited: () => false }, { scope: async () => ({ ok: false as const, error: 'no team' }) }]) {
      const x = fixture(); expect((await createDirectForward({ ...x.deps, ...over })(request)).ok).toBe(false); expect(x.sent).toHaveLength(0)
    }
    for (const over of [{ guarded: true }, { localCliProof: false }]) { const x = fixture(); expect((await createDirectForward(x.deps)({ ...request, ...over })).ok).toBe(false); expect(x.sent).toHaveLength(0) }
  })
})
