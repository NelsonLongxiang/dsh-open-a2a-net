// @vitest-environment node
/**
 * #71 cross-host wiring (direct-f0523f9d) — criteria written RED first.
 *
 * Field evidence (2026-10-26): the owner wired 工作台市场--功能测试组 on
 * node .157's workbench with members from BOTH hosts; .157's inbound
 * delivered fine, but the REPLY leg (.157 → .156) was refused by the
 * receiving host's shared-team admission — the org lives only on the
 * peer's records, and admission never consulted the warm card cache
 * (which DID hold the peer's full card, canvasOrg included).
 *
 * Fix contract (总工 dispatch, two halves):
 *  ① an envelope full-face pull that succeeds persists its full fields
 *     back into the warm card cache (the probe path fetches but drops);
 *  ② admission's remote-ref channel reads the warm cached peer canvasOrg:
 *     an org entry naming BOTH the caller's handle and one of THIS host's
 *     own handles is a shared team (双向识别 — the operator gesture
 *     happened on the OTHER host's workbench; both ends are named).
 *
 * Guards: an org entry WITHOUT a local handle keeps refusing (a caller
 * adding itself to its own org changes nothing here); admission stays
 * read-only over the warm cache.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, reservePort, type MeshNode } from './harness.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

const post = async (url: string, body?: unknown): Promise<Record<string, any>> =>
  await globalThis.fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async r => await r.json() as Record<string, any>)

/**
 * Swap the harness's fixed-id fake agent for one with a DISTINCT session id
 * (the gh26-f5 pattern adapted to bootNode): the steer/reply shape mirrors
 * harness.ts so the final-reply flush reads the answer. Emitted AFTER boot
 * so the session-node face registers the new live root; the fixed-id agent
 * stays live-but-unjoined (invisible by design).
 */
function swapAgent(node: MeshNode, id: string, name: string): void {
  const agent = {
    id: SessionId(id),
    session: { events: [] as unknown[], title: name },
    steer(payload: unknown): void {
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
      const events = (agent as unknown as { session: { events: unknown[] } }).session.events
      events.push({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: `ok from ${name}: ${text}` }] } } })
      node.ctx.emit('agent/status', { agent: agent as unknown as Agent, status: 'idle' })
    },
  } as unknown as Agent & { session: { events: unknown[] } }
  node.agents.agent = agent
  node.ctx.emit('agent/created', { agent: agent as unknown as Agent })
}

describe('gh#71 peer-org admission (fix ②)', () => {
  it('a warm cached peer org naming caller + a local handle admits the delivery; an org without a local handle still refuses', { timeout: 30_000 }, async () => {
    const portA = await reservePort()
    const portB = await reservePort()
    // cardCacheTtlMs override: mesh default is 60ms — admission reads the
    // warm cache READ-ONLY, so the org must still be warm when the route
    // lands (the product default TTL is 60s).
    // teamScopeRouting: true EXPLICIT — the review FAIL's false-green trap:
    // the mesh harness bootNode builds Config literally, so an omitted key
    // is undefined (falsy) and the whole a2aCallerRefusal gate no-ops —
    // the admission under test never ran (both symptoms: positive green
    // pre-fix, guard bare.error undefined). The product schema default is
    // true; the spec must say so out loud.
    const a = await bootNode({ name: 'A', session: 'mesh-gh71-a', team: 'dsh', sessionNodes: true, port: portA, peers: [`http://127.0.0.1:${String(portB)}`], cardCacheTtlMs: 10_000, teamScopeInfo: false, teamScopeRouting: true })
    const b = await bootNode({ name: 'B', session: 'mesh-gh71-b', team: 'dsh', sessionNodes: true, port: portB, peers: [`http://127.0.0.1:${String(portA)}`], cardCacheTtlMs: 10_000, teamScopeInfo: false, teamScopeRouting: true })
    try {
      swapAgent(a, 'session-aaaa1111zzzz0000', 'A-开发席')
      swapAgent(b, 'session-bbbb2222zzzz0000', 'B-测试席')
      const joinA = await post(`${a.baseUrl}/__dsh_a2a/join`, { id: 'session-aaaa1111zzzz0000' })
      expect(joinA.team).toBe('dsh/aaaa1111')
      const joinB = await post(`${b.baseUrl}/__dsh_a2a/join`, { id: 'session-bbbb2222zzzz0000' })
      expect(joinB.team).toBe('dsh/bbbb2222')

      // A's workbench composition — the FIELD shape: handle-form members.
      // 跨机组 names BOTH ends (the link); 孤组 names a nobody handle
      // only (the guard — no local handle on B, no admission).
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '跨机组' })).ok).toBe(true)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '跨机组', id: 'dsh/aaaa1111' })).ok).toBe(true)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '跨机组', id: 'dsh/bbbb2222' })).ok).toBe(true)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '孤组' })).ok).toBe(true)
      expect((await post(`${a.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '孤组', id: 'dsh/cccc3333' })).ok).toBe(true)

      // Warm BOTH caches the way the live product does: a2a_teams sweeps
      // (envelope-stamped client fetches → full faces). B must hold A's
      // canvasOrg; A must hold B's sessionTeams to resolve the target.
      const teamsToolA = a.ctx.tools.get('a2a_teams')
      const teamsToolB = b.ctx.tools.get('a2a_teams')
      const agentA = (a as unknown as { agents: { agent: unknown } }).agents.agent
      const agentB = (b as unknown as { agents: { agent: unknown } }).agents.agent
      let bSawOrg = false
      for (let i = 0; i < 20 && !bSawOrg; i += 1) {
        await teamsToolA?.execute({}, { signal: new AbortController().signal, agent: agentA } as never)
        await teamsToolB?.execute({}, { signal: new AbortController().signal, agent: agentB } as never)
        const bState = await post(`${b.baseUrl}/__dsh_a2a/state`)
        const rows = (bState.peerOrg ?? []) as Array<{ url: string; org: Array<{ name: string; members: string[] }> }>
        const row = rows.find((r: { url: string }) => r.url === `http://127.0.0.1:${String(portA)}`)
        bSawOrg = row?.org.some(t => t.name === '跨机组' && t.members.includes('dsh/bbbb2222')) === true
        if (!bSawOrg) await new Promise(resolve => setTimeout(resolve, 300))
      }
      expect(bSawOrg).toBe(true) // precondition: the warm cache holds the org

      // ── Positive (RED until fix ②): A routes to B's session team through
      // the real client path — envelope stamped, caller_session = A's handle.
      const routeTool = a.ctx.tools.get('a2a_route')
      const res = await routeTool?.execute({ team: 'dsh/bbbb2222', message: 'org-link ping' }, { signal: new AbortController().signal, agent: agentA } as never) as Record<string, any>
      expect(res?.ok).toBe(true)
      expect(String(res?.reply)).toContain('ok from B-测试席')

      // ── Guard (green before AND after): 孤组 has no local handle — the
      // caller it names must keep refusing (双向识别 is required, and the
      // 跨机组 link must not spill over to a different caller).
      const bare = await post(`${b.baseUrl}/a2a/direct`, { team: 'dsh/bbbb2222', message: 'loner ping', caller_session: 'dsh/cccc3333' })
      expect(bare.error).toBeDefined()
      expect(String(bare.error)).toMatch(/shared-team|no team membership|no operator-established link/)
    } finally {
      await a.dispose()
      await b.dispose()
    }
  })
})

describe('gh#71 probe full-face persist (fix ①)', () => {
  it('a probe sweep persists the peer full card (canvasOrg readable from state) without any prior directory sweep', { timeout: 30_000 }, async () => {
    const portP = await reservePort()
    const portQ = await reservePort()
    const p = await bootNode({ name: 'P', session: 'mesh-gh71-p', team: 'dsh', sessionNodes: true, port: portP, peers: [`http://127.0.0.1:${String(portQ)}`], teamScopeInfo: false, cardCacheTtlMs: 10_000 })
    const q = await bootNode({ name: 'Q', session: 'mesh-gh71-q', team: 'dsh', sessionNodes: true, port: portQ, peers: [`http://127.0.0.1:${String(portP)}`] })
    try {
      swapAgent(p, 'session-eeee5555zzzz0000', 'P-探针席')
      swapAgent(q, 'session-dddd4444zzzz0000', 'Q-目标席')
      expect((await post(`${p.baseUrl}/__dsh_a2a/join`, { id: 'session-eeee5555zzzz0000' })).team).toBe('dsh/eeee5555')
      expect((await post(`${q.baseUrl}/__dsh_a2a/join`, { id: 'session-dddd4444zzzz0000' })).team).toBe('dsh/dddd4444')
      expect((await post(`${q.baseUrl}/__dsh_a2a/canvas`, { action: 'create', name: '探针组' })).ok).toBe(true)
      expect((await post(`${q.baseUrl}/__dsh_a2a/canvas`, { action: 'add-member', name: '探针组', id: 'dsh/dddd4444' })).ok).toBe(true)

      // The probe sweep is P's FIRST card contact with Q (no a2a_teams
      // call before it) — the fetch must persist for the state face to
      // surface the org.
      const probeTool = p.ctx.tools.get('a2a_probe')
      const agentP = (p as unknown as { agents: { agent: unknown } }).agents.agent
      const probe = await probeTool?.execute({}, { signal: new AbortController().signal, agent: agentP } as never) as Record<string, any>
      expect(probe?.ok).toBe(true)

      let sawOrg = false
      for (let i = 0; i < 10 && !sawOrg; i += 1) {
        const pState = await post(`${p.baseUrl}/__dsh_a2a/state`)
        const rows = (pState.peerOrg ?? []) as Array<{ url: string; org: Array<{ name: string }> }>
        const row = rows.find((r: { url: string }) => r.url === `http://127.0.0.1:${String(portQ)}`)
        sawOrg = row?.org.some(t => t.name === '探针组') === true
        if (!sawOrg) await new Promise(resolve => setTimeout(resolve, 300))
      }
      expect(sawOrg).toBe(true)
    } finally {
      await p.dispose()
      await q.dispose()
    }
  })
})
