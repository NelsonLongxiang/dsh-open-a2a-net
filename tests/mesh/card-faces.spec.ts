// @vitest-environment node
/**
 * gh#7 G1 (review-seat R2 ruling): the card serves two faces — anonymous
 * fetchers get the MINIMAL discovery card (no sessionTeams /
 * teamMemberships / lanIp); a NAMED caller (?caller_session= or
 * X-A2A-Caller in zone or zone/id8 shape) gets the FULL card. The signed
 * core is identical either way. The wake-on-route regression: a cold
 * session stays reachable for NAMED callers while anonymous fetchers
 * cannot even see it listed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { apply, type Config } from '../../src/index.ts'
import { envelopeFor } from '../wire/envelope.ts'
import { bootNode } from './harness.ts'

async function getCard(port: number, headers: Record<string, string> = {}, query = ''): Promise<Record<string, unknown>> {
  return JSON.parse(await (await globalThis.fetch(`http://127.0.0.1:${String(port)}/.well-known/agent-card.json${query}`, { headers })).text()) as Record<string, unknown>
}

const baseConfig: Partial<Config> = {
  apiKey: '', session: 'sess-g1', team: 'g1-zone', routeTimeoutMs: 60_000, flushTimeoutMs: 300_000,
  announce: true, agentName: 'g1 node', peers: [], delegates: [], sessionNodes: true,
  wakeJoinedOnBoot: false, wakePrewarmDelayMs: 0, wakePrewarmQuietMs: 0, wakeBootStaggerMs: 3_000,
  stateColdRowsTtlMs: 5_000, cardCacheTtlMs: 60_000, cardCacheNegativeTtlMs: 30_000,
  remoteRowsTtlMs: 15_000, cardTtlMs: 172_800_000, teamJoinAllowlist: ['g1-zone/ops'],
}

describe('G1 card faces: minimal for anonymous, full for named', () => {
  let ctx: Context
  let port: number
  let home: string
  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), 'a2a-g1-card-'))
    mkdirSync(join(home, 'a2a'), { recursive: true })
    // Seed one joined session + a roster declaration so the FULL face has
    // sessionTeams and teamMemberships to carry.
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(home, 'a2a', 'joined.json'), JSON.stringify({ sessions: ['agent-1'] }))
    writeFileSync(join(home, 'a2a', 'teams.json'), JSON.stringify({ memberships: [{ session: 'agent-1', teams: ['g1-zone/ops'] }] }))
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(TimerService)
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    apply(ctx, { ...baseConfig, dshHome: home } as Config)
    port = (ctx as unknown as { webServer: { port: number } }).webServer.port
  })
  afterEach(async () => {
    await ctx.fiber.dispose()
  })

  it('anonymous fetch omits sessionTeams/teamMemberships/lanIp, keeps discovery base and signature', async () => {
    const card = await getCard(port)
    expect(card.sessionTeams).toBeUndefined()
    expect(card.teamMemberships).toBeUndefined()
    expect(card.lanIp).toBeUndefined()
    // Discovery base intact.
    expect(card.peers).toEqual([])
    expect(card.team).toBe('g1-zone')
    expect(card.name).toBe('g1 node')
    expect(typeof card.signature).toBe('string')
    expect(typeof card.publicKey).toBe('string')
    expect(String(card.description)).toContain('minimal card')
  })

  it('gh#9/10 flip: only a VERIFIED envelope gets the full card — shape-only naming and queries stay minimal', async () => {
    // The v1 named face (bare X-A2A-Caller / ?caller_session=, no
    // signature) closed with the envelope flip: shape never substitutes
    // for signature.
    const viaQuery = await getCard(port, {}, '?caller_session=other-zone')
    expect(viaQuery.sessionTeams).toBeUndefined()
    const viaHeader = await getCard(port, { 'X-A2A-Caller': 'other-zone/deadbeef' })
    expect(viaHeader.sessionTeams).toBeUndefined()
    const bogus = await getCard(port, { 'X-A2A-Caller': 'not a valid/// shape!' })
    expect(bogus.sessionTeams).toBeUndefined()
    // The node's own signed envelope gets the full card (self-named zone:
    // derivable from card.team).
    const enveloped = await getCard(port, envelopeFor(home, port, 'g1-zone'))
    expect(Array.isArray(enveloped.sessionTeams)).toBe(true)
    expect(enveloped.teamMemberships).toBeDefined()
    // A well-formed envelope with a BAD signature fails closed to minimal.
    const forged: Record<string, string> = { ...envelopeFor(home, port, 'g1-zone') }
    forged['X-A2A-Caller-Sig'] = Buffer.from('forged').toString('base64')
    const badSig = await getCard(port, forged)
    expect(badSig.sessionTeams).toBeUndefined()
    // A stale ts (outside ±5min) fails closed too.
    const stale: Record<string, string> = { ...envelopeFor(home, port, 'g1-zone'), 'X-A2A-Caller-Ts': String(Date.now() - 6 * 60_000) }
    const badTs = await getCard(port, stale)
    expect(badTs.sessionTeams).toBeUndefined()
  })

  it('REVIEW M2 third-round: zone/id8 envelopes are bad-caller-shape — the impersonation vector stays closed', async () => {
    // Narrowed ruling: the envelope names a BARE ZONE only. A session-
    // shaped claim — even validly signed by a same-zone host's own key
    // (the reviewer's impersonation chain: sign the TARGET's session
    // handle, prefix-match in) — rejects at the shape gate. Session-level
    // identity rides the body's caller_session, judged by N3/S3 against
    // the published roster.
    const ts = Date.now()
    const { sign: edSign, createPrivateKey } = await import('node:crypto')
    const key = createPrivateKey(readFileSync(join(home, 'a2a', 'node-key.pem'), 'utf8'))
    const callerUrl = `http://127.0.0.1:${String(port)}`
    const claim = 'g1-zone/01234567'
    const sig = edSign(undefined, Buffer.from(JSON.stringify([claim, callerUrl, ts]), 'utf8'), key).toString('base64')
    const sessionShaped = await getCard(port, { 'X-A2A-Caller': claim, 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': sig })
    expect(sessionShaped.sessionTeams).toBeUndefined()
    // Foreign zone fails closed identically.
    const ts2 = Date.now()
    const sig2 = edSign(undefined, Buffer.from(JSON.stringify(['evil-zone/01234567', callerUrl, ts2]), 'utf8'), key).toString('base64')
    const foreign = await getCard(port, { 'X-A2A-Caller': 'evil-zone/01234567', 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts2), 'X-A2A-Caller-Sig': sig2 })
    expect(foreign.sessionTeams).toBeUndefined()
    // A bare-zone envelope with a MISMATCHED zone also stays closed even
    // with a valid signature over it.
    const ts3 = Date.now()
    const sig3 = edSign(undefined, Buffer.from(JSON.stringify(['evil-zone', callerUrl, ts3]), 'utf8'), key).toString('base64')
    const mismatched = await getCard(port, { 'X-A2A-Caller': 'evil-zone', 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts3), 'X-A2A-Caller-Sig': sig3 })
    expect(mismatched.sessionTeams).toBeUndefined()
  })

  it('the signed core is identical across faces (same key, same signature mechanism)', async () => {
    const anon = await getCard(port)
    const named = await getCard(port, envelopeFor(home, port, 'g1-zone'))
    for (const field of ['name', 'team', 'session', 'capabilities', 'expiresAt', 'publicKey', 'signature']) {
      expect(anon[field]).toEqual(named[field])
    }
  })
})

describe('G1 wake-on-route regression: cold rows stay reachable for named callers', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('the caller node (named via X-A2A-Caller) resolves and delivers to a cold session; an anonymous curl cannot even see the listing', async () => {
    const target = await bootNode({ name: 'target', session: 'mesh-target', team: 'target-zone', sessionNodes: true })
    // Loopback-bound harness nodes: the plugin derives 127.0.0.1 from the
    // actual bind (production pocket tunnels override via originClaimUrl).
    const caller = await bootNode({ name: 'caller', session: 'mesh-caller', team: 'caller-zone', peers: [target.baseUrl] })
    try {
      // The target's operator joins a session that then goes cold.
      const joinRes = await globalThis.fetch(`http://127.0.0.1:${String(target.port)}/__dsh_a2a/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'session-0123456789abcdef' }),
      })
      expect(joinRes.status).toBe(200)
      // Anonymous curl of the target card: the cold row is NOT listed.
      const anonCard = await getCard(target.port)
      expect(anonCard.sessionTeams).toBeUndefined()
      // The caller node's directory walk (our client stamps X-A2A-Caller)
      // still sees the cold session team and routes to it — wake-on-route.
      const listed = await caller.ctx.tools.get('a2a_teams')?.execute({}, { signal: new AbortController().signal } as never) as { teams: Array<{ team: string }> }
      expect(listed.teams.some(row => row.team === 'target-zone/01234567')).toBe(true)
    } finally {
      await caller.dispose()
      await target.dispose()
    }
  })
})
