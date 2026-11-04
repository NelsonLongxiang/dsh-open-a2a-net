// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createPrivateKey } from 'node:crypto'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { join } from 'node:path'
import { bootNode, reservePort, runContext, type MeshNode } from './harness.ts'
const ID = 'session-0123456789abcdef'
const nodes: MeshNode[] = []
afterEach(async () => { for (const node of nodes.splice(0)) await node.dispose(); vi.unstubAllGlobals() })
const post = async (n: MeshNode, path: string, body: unknown, headers = {}) => await fetch(n.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const state = async (n: MeshNode): Promise<any> => await fetch(n.baseUrl + '/__dsh_a2a/state').then(r => r.json())
async function setup(extra = {}) {
  vi.stubGlobal('WebSocket', function () { throw Error('no socket') })
  const n = await bootNode({ name: 'host', session: 'seat-test', team: 'dsh', sessionNodes: true, ...extra })
  nodes.push(n); await post(n, '/__dsh_a2a/join', { id: ID }); return n
}
describe('#58 human-owned seat labels', () => {
  it('hot applies to state/whoami/directory while routing identity and title remain unchanged; clears back to fallback', async () => {
    const n = await setup()
    const before = (await state(n)).sessions.find((s: any) => s.id === ID)
    const write = await post(n, '/__dsh_a2a/owner-settings', { seatNames: { [ID]: '开发席' } })
    expect(await write.json()).toMatchObject({ ok: true, restartNeeded: false })
    const row = (await state(n)).sessions.find((s: any) => s.id === ID)
    expect(row).toMatchObject({ name: '开发席', seatName: '开发席', team: before.team, label: before.label })
    const who = await n.ctx.tools.get('a2a_whoami')!.execute({}, runContext(n.agents.agent)) as any
    expect(who.node).toMatchObject({ name: '开发席', seatName: '开发席', team: before.team })
    const teams = await n.ctx.tools.get('a2a_teams')!.execute({ query: '开发席' }, runContext()) as any
    expect(teams.teams.some((r: any) => r.team === before.team && r.name === '开发席')).toBe(true)
    const runtime = n.ctx.get('tools') as any
    const view = await runtime.execute({ name: 'a2a_teams', arguments: { query: '开发席' }, signal: new AbortController().signal, callId: 'seat-directory-schema' })
    expect(view.isError, JSON.stringify(view.error)).not.toBe(true)
    expect(readFileSync(join(n.home, 'cordis.patch.yml'), 'utf8')).toContain('开发席')
    expect((await post(n, '/__dsh_a2a/owner-settings', { seatNames: {} })).status).toBe(200)
    expect((await state(n)).sessions.find((s: any) => s.id === ID).name).toBe(before.name)
  })
  it('a linked peer fresh card sees the seat name, cold card retains it, and a restarted owner retains configured labels', async () => {
    const port = await reservePort()
    const n = await setup({ peers: ['http://127.0.0.1:' + port] })
    const peer = await bootNode({ name: 'peer', session: 'seat-peer', team: 'peer', port, peers: [n.baseUrl], announce: true })
    nodes.push(peer)
    const key = createPrivateKey(readFileSync(join(peer.home, 'a2a', 'node-key.pem'), 'utf8'))
    const url = n.baseUrl + '/.well-known/agent-card.json'
    const card = async () => await fetch(url, { headers: signOriginClaim({ url, method: 'GET' }, { caller: peer.team, callerUrl: peer.baseUrl, privateKey: key, unbound: false, now: Date.now() }) }).then(r => r.json()) as any
    await post(n, '/__dsh_a2a/owner-settings', { seatNames: { [ID]: '人工开发席' } })
    expect((await card()).sessionTeams.find((row: any) => row.team === 'dsh/01234567')).toMatchObject({ name: '人工开发席', seatName: '人工开发席' })
    n.ctx.emit('agent/disposed', { agent: n.agents.agent! })
    n.agents.agent = undefined
    expect((await card()).sessionTeams.find((row: any) => row.team === 'dsh/01234567').name).toBe('人工开发席')
    const patch = readFileSync(join(n.home, 'cordis.patch.yml'), 'utf8')
    const saved = JSON.parse(patch.split('seatNames: ')[1]!.split('\n')[0]!)
    const restarted = await setup({ home: n.home, seatNames: saved })
    expect((await state(restarted)).sessions.find((row: any) => row.id === ID).name).toBe('人工开发席')
  })

  it('invalid boot entries do not prevent the plugin mounting or discard valid siblings', async () => {
    const n = await setup({ seatNames: { [ID]: '开发席', 'session-1111222233334444': 'bad\u202ename', 'session-5555666677778888': 123 } })
    expect((await state(n)).sessions.find((s: any) => s.id === ID).name).toBe('开发席')
    expect((await fetch(n.baseUrl + '/__dsh_a2a/owner-settings').then(r => r.json()) as any).seatNames).toEqual({ [ID]: '开发席' })
  })

  it('seat-name-only owner writes preserve existing allowlist, scope, announce and unrelated patch settings', async () => {
    const n = await setup({ teamJoinAllowlist: ['dsh/review'], teamScopeInfo: false })
    await post(n, '/__dsh_a2a/owner-settings', { teamJoinAllowlist: ['dsh/review'], teamScopeInfo: false, announce: false })
    const before = await fetch(n.baseUrl + '/__dsh_a2a/owner-settings').then(r => r.json()) as any
    await post(n, '/__dsh_a2a/owner-settings', { seatNames: { [ID]: '开发席' } })
    const after = await fetch(n.baseUrl + '/__dsh_a2a/owner-settings').then(r => r.json()) as any
    expect(after).toEqual({ ...before, seatNames: { [ID]: '开发席' } })
    const yaml = readFileSync(join(n.home, 'cordis.patch.yml'), 'utf8')
    expect(yaml).toContain("teamJoinAllowlist: ['dsh/review']")
    expect(yaml).toContain('teamScopeInfo: false')
    expect(yaml).toContain('announce: false')
  })

  it('real tool runtime rejects naming fields, including otherwise valid tool arguments, without changing owner state', async () => {
    const n = await setup(), runtime = n.ctx.get('tools') as any
    for (const [name, args] of [['a2a_whoami', { seatName: '模型命名' }], ['a2a_team_join', { team: 'dsh/dev', seatNames: { [ID]: '模型命名' } }], ['a2a_route', { team: 'dsh/01234567', message: 'hello', seatName: '模型命名' }]] as const) {
      const result = await runtime.execute({ name, arguments: args, agent: n.agents.agent, signal: new AbortController().signal, callId: 'seat-denied-' + name })
      expect(result.isError, JSON.stringify(result)).toBe(true)
      expect(JSON.stringify(result.error)).toContain('human-owned')
    }
    expect((await fetch(n.baseUrl + '/__dsh_a2a/owner-settings').then(r => r.json()) as any).seatNames).toEqual({})
  })
  it('rejects invalid maps and unauthenticated owner writes, preserving existing labels', async () => {
    const n = await setup()
    for (const seatNames of [null, [], { [ID]: '' }, { [ID]: 'x'.repeat(65) }, { [ID]: 'a\nb' }, { 'peer/01234567': 'not local' }]) {
      expect((await post(n, '/__dsh_a2a/owner-settings', { seatNames })).status).toBe(400)
    }
    const keyed = await setup({ apiKey: 'test-owner-key' })
    expect((await post(keyed, '/__dsh_a2a/owner-settings', { seatNames: { [ID]: 'not authorized' } })).status).toBe(401)
  })
})
