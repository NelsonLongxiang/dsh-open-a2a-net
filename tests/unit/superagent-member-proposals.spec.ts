// @vitest-environment node
/** #717, docs/design/superagent-router-owner-asks.md D18: a plain member may propose new work; the router alone decides. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DEFAULT_SETTINGS, OBSERVER_OPEN_MAX, memberActor, observerActor, policyEffects, proposerKind, teamPolicy } from '../../src/superagent/host/policy.ts'
import { MEMBER_LINE, OBSERVER_LINE } from '../../src/superagent/host/cards.ts'

const REMOTE = { ref: 'far/abcd1234@0badf00d', key: 'remote-key', url: '' }
const PI = { ref: 'far/pi000001@0badf00d', key: 'pi-key', url: '', platform: 'pi' as const }

async function team() {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const sent: Array<[string, string]> = []
  const pool = { ids: ['session-r', 'session-a', 'session-b', 'session-o'], remote: [REMOTE, PI] as Array<typeof REMOTE | typeof PI> }
  const presets: Record<string, string> = { 'session-r': 'superagent-router', 'session-a': 'superagent-member', 'session-b': 'superagent-member', 'session-o': 'superagent-observer' }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: pool.ids, remote: pool.remote } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-member-proposal-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {},
    memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id, presetOf: (id: string) => presets[id],
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true, id => presets[id])).toMatchObject({ ok: true })
  h.start()
  const propose = (text: string, who = 'session-a') => h.requestForMember(who, text) as Record<string, any>
  const route = (item: Record<string, unknown>) => routeItem(h, item as never) as Record<string, any>
  const cards = () => sent.filter(([id, t]) => id === 'session-r' && t.startsWith('[superagent candidate]')).map(([, t]) => t)
  return { h, sent, pool, presets, propose, route, cards }
}

/** #719: invoke the registered production tool, not only the forwarding method. */
async function proposalTool(h: Awaited<ReturnType<typeof team>>['h']) {
  const { registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const registered = new Map<string, { execute(args: unknown, exec: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never,
    id => h.roleOf(id) !== undefined ? h : undefined)
  const tool = registered.get('a2a_ticket_request')
  expect(tool).toBeDefined()
  return (as: string | undefined, text: string) => tool!.execute({ text }, {
    ...(as === undefined ? {} : { agent: { id: as } }), signal: new AbortController().signal,
  })
}

describe('a member proposes', () => {
  it('without a ticket: the router gets an explicit candidate marked as a member\'s, and nothing runs until it accepts', async () => {
    const m = await team()
    expect(m.h.executor.list().filter(b => b.member === 'session-a')).toEqual([])
    const filed = m.propose('  依赖锁文件过期，需要刷新  ')
    expect(filed).toMatchObject({ ok: true })
    m.h.pass()
    await vi.waitFor(() => { expect(m.cards()).toHaveLength(1) })
    expect(m.cards()[0]).toContain('strength explicit')
    expect(m.cards()[0]).toContain(MEMBER_LINE)
    expect(m.cards()[0]).not.toContain(OBSERVER_LINE)
    const trigger = m.h.store.triggers.get(filed.trigger_id)!
    expect(trigger).toMatchObject({ human: false, text: '依赖锁文件过期，需要刷新', actor: { source: 'workbench', id: memberActor('session-a') } })
    expect(proposerKind(trigger.actor)).toBe('member')
    // Undecided: no ticket, no assignment to anyone.
    expect(m.h.store.tickets.list()).toEqual([])
    expect(m.sent.some(([, t]) => t.startsWith('[superagent assignment]'))).toBe(false)
    const accepted = m.route({ trigger_id: filed.trigger_id, kind: 'accept', title: '刷新锁文件', scope: 's', reason: 'r' })
    expect(accepted).toMatchObject({ ok: true, decision: 'accept' })
    const ticket = m.h.store.tickets.get(accepted.ticket_id)!
    expect(ticket.mandate).toMatchObject({ strength: 'explicit', actor: { source: 'workbench', id: memberActor('session-a') }, basis: { via: 'listed', authority: 'member', sender: memberActor('session-a') } })
    await m.h.stop()
  })

  it('the router may ignore it, with its reason, and the member learns nothing was opened', async () => {
    const m = await team()
    const filed = m.propose('改个变量名')
    m.h.pass()
    expect(m.route({ trigger_id: filed.trigger_id, kind: 'ignore', reason: '不值得单开' })).toMatchObject({ ok: true })
    expect(m.h.store.tickets.list()).toEqual([])
    await m.h.stop()
  })

  it('does not end, stop, change or reassign the ticket its proposer holds', async () => {
    const m = await team()
    const owner = m.h.request('owner work') as { triggerId: string }
    m.h.pass()
    const held = m.route({ trigger_id: owner.triggerId, kind: 'accept', title: 't', scope: 'owner scope', reason: 'r' }).ticket_id as string
    await vi.waitFor(() => { expect(m.h.executor.list().some(b => b.ticketId === held)).toBe(true) })
    const worker = m.h.executor.list().find(b => b.ticketId === held)!.member
    const before = JSON.stringify(m.h.store.tickets.get(held))
    const filed = m.propose('另一件事：文档链接坏了', worker)
    expect(filed).toMatchObject({ ok: true })
    m.h.pass()
    // A stop on its proposal is refused, whatever ticket it names.
    expect(m.route({ trigger_id: filed.trigger_id, kind: 'stop', ticket_id: held, reason: 'r' })).toMatchObject({ ok: false, code: 'member-stop' })
    expect(m.h.store.tickets.get(held)?.ended).toBeUndefined()
    expect(m.h.store.tickets.get(held)?.mandate?.scope).toBe('owner scope')
    expect(m.h.executor.list().find(b => b.ticketId === held)?.member).toBe(worker)
    expect(JSON.stringify(m.h.store.tickets.get(held))).toBe(before)
    await m.h.stop()
  })

  it('returns the same request for a repeat, and holds at the cap until one ends; caps are per proposer', async () => {
    const m = await team()
    const first = m.propose('单 0')
    expect(m.propose('单 0')).toMatchObject({ ok: true, reused: true, trigger_id: first.trigger_id })
    for (let i = 1; i < OBSERVER_OPEN_MAX; i++) expect(m.propose(`单 ${String(i)}`)).toMatchObject({ ok: true })
    expect(m.propose('再来一张')).toMatchObject({ ok: false, code: 'too-many-open' })
    // Another member's own requests are not held by this one's.
    expect(m.propose('单 0', 'session-b')).toMatchObject({ ok: true })
    expect(m.propose('单 0', 'session-b').reused).toBe(true)
    m.h.pass()
    expect(m.route({ trigger_id: first.trigger_id, kind: 'ignore', reason: '不需要' })).toMatchObject({ ok: true })
    expect(m.propose('再来一张')).toMatchObject({ ok: true })
    await m.h.stop()
  })

  it('refuses empty or oversized text, the router, and sessions outside the team', async () => {
    const m = await team()
    expect(m.propose('   ')).toMatchObject({ ok: false, code: 'refused' })
    expect(m.propose('x'.repeat(20_001))).toMatchObject({ ok: false, code: 'refused' })
    expect(m.propose('甲', 'session-r')).toMatchObject({ ok: false, code: 'not-member' })
    expect(m.propose('甲', 'session-x')).toMatchObject({ ok: false, code: 'not-member' })
    // A remote ref is not a local session: only its pinned host may speak for it.
    expect(m.propose('甲', REMOTE.ref)).toMatchObject({ ok: false, code: 'not-member' })
    m.pool.ids = ['session-r', 'session-b', 'session-o']
    expect(m.propose('甲')).toMatchObject({ ok: false, code: 'not-member' })
    // Nothing was filed: no thread, so no candidate for the router.
    expect(m.h.store.threads.list()).toEqual([])
    await m.h.stop()
  })

  it('an observer still files as itself', async () => {
    const m = await team()
    const filed = m.propose('观察到的事', 'session-o')
    expect(filed).toMatchObject({ ok: true })
    expect(m.h.store.triggers.get(filed.trigger_id)?.actor).toEqual({ source: 'workbench', id: observerActor('session-o') })
    m.h.pass()
    await vi.waitFor(() => { expect(m.cards()).toHaveLength(1) })
    expect(m.cards()[0]).toContain(OBSERVER_LINE)
    expect(m.cards()[0]).not.toContain(MEMBER_LINE)
    expect(m.route({ trigger_id: filed.trigger_id, kind: 'stop', ticket_id: 'any', reason: 'r' })).toMatchObject({ ok: false, code: 'observer-stop' })
    await m.h.stop()
  })
})

describe('a remote member proposes through its pinned host', () => {
  it('files as member:<ref> under the pinned key, and nothing else speaks for it', async () => {
    const m = await team()
    const handle = REMOTE.ref.replace(/@[0-9a-f]{8}$/, '')
    expect(m.h.remoteEvent('ticket-request', handle, 'other-key', { text: '远端发现的问题' })).toMatchObject({ ok: false, code: 'not-member' })
    const filed = m.h.remoteEvent('ticket-request', handle, REMOTE.key, { text: '远端发现的问题' }) as Record<string, any>
    expect(filed).toMatchObject({ ok: true })
    expect(m.h.store.triggers.get(filed.trigger_id)).toMatchObject({ human: false, actor: { source: 'workbench', id: memberActor(REMOTE.ref) } })
    expect(m.h.remoteEvent('ticket-request', handle, REMOTE.key, { text: '远端发现的问题' })).toMatchObject({ ok: true, reused: true, trigger_id: filed.trigger_id })
    m.h.pass()
    await vi.waitFor(() => { expect(m.cards()).toHaveLength(1) })
    expect(m.cards()[0]).toContain(MEMBER_LINE)
    await m.h.stop()
  })

  it('a Pi seat cannot propose: it signs only for itself', async () => {
    const m = await team()
    const handle = PI.ref.replace(/@[0-9a-f]{8}$/, '')
    expect(m.h.remoteEvent('ticket-request', handle, PI.key, { text: 'x' }, true)).toMatchObject({ ok: false, code: 'op' })
    expect(m.h.requestForMember(PI.ref, 'x', true)).toMatchObject({ ok: false, code: 'not-member' })
    await m.h.stop()
  })
})

describe('a member host forwards its served member\'s proposal', () => {
  it('signed, to the team it serves, and only for a session it serves', async () => {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const posts: Array<[string, string, unknown]> = []
    const h = new SuperagentHost({
      home: mkdtempSync(join(tmpdir(), 'sa-member-host-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
      signedPost: async (url: string, path: string, body: unknown) => { posts.push([url, path, body]); return { ok: true, trigger_id: 'remote-trigger' } },
      handleOf: (id: string) => `near/${id}`,
    } as never)
    // Serving is set by the serve action, which pins the key; here it is put straight in place.
    const held = h as unknown as { settingsValue: Record<string, unknown> }
    held.settingsValue = { ...held.settingsValue, serves: { url: 'https://team.example', key: 'team-key', members: ['session-s'] } }
    expect(await h.forwardProposal('session-s', '远端发现的问题')).toMatchObject({ ok: true, trigger_id: 'remote-trigger' })
    expect(posts).toEqual([['https://team.example', '/a2a/superagent-team', { op: 'ticket-request', member: 'near/session-s', report: { text: '远端发现的问题' } }]])
    expect(await h.forwardProposal('session-x', 'x')).toMatchObject({ ok: false, code: 'not-member' })
    expect(posts).toHaveLength(1)
  })
})

describe('#719 registered proposal tool dispatch', () => {
  async function served(post: (url: string, path: string, body: unknown) => Promise<Record<string, unknown>>, member = REMOTE.ref) {
    const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
    const h = new SuperagentHost({
      home: mkdtempSync(join(tmpdir(), 'sa-proposal-tool-')), logger: { info: () => {}, warn: () => {} },
      deliverToSession: () => true, interval: () => () => {}, signedPost: post,
      handleOf: () => member.replace(/@[0-9a-f]{8}$/, ''),
    } as never)
    const held = h as unknown as { settingsValue: Record<string, unknown> }
    held.settingsValue = { ...held.settingsValue, serves: { url: 'https://team.example', key: 'team-key', members: ['session-s'] } }
    return { h, call: await proposalTool(h) }
  }

  it('routes a served session through signedPost to the pinned team host, preserving its result without local work', async () => {
    const receiver = await team()
    const posts: Array<[string, string, unknown]> = []
    const sender = await served(async (url, path, body) => {
      posts.push([url, path, body])
      const request = body as { op: string; member: string; report: { text: string } }
      return receiver.h.remoteEvent(request.op, request.member, REMOTE.key, request.report) as Record<string, unknown>
    })
    const local = vi.spyOn(sender.h, 'requestForMember')
    try {
      expect(sender.h.roleOf('session-s')).toBe('member')
      const text = '工具入口发现的新需求'
      const filed = await sender.call('session-s', text)
      expect(filed).toMatchObject({ ok: true, trigger_id: expect.any(String), thread: expect.any(String) })
      expect(posts).toEqual([['https://team.example', '/a2a/superagent-team', {
        op: 'ticket-request', member: REMOTE.ref.replace(/@[0-9a-f]{8}$/, ''), report: { text },
      }]])
      expect(local).not.toHaveBeenCalled()
      expect(receiver.h.store.triggers.get(filed.trigger_id)).toMatchObject({
        human: false, text, actor: { source: 'workbench', id: memberActor(REMOTE.ref) },
      })
      expect(await sender.call('session-s', text)).toMatchObject({ ok: true, reused: true, trigger_id: filed.trigger_id })
      expect(sender.h.store.threads.list()).toEqual([])
      expect(sender.h.store.tickets.list()).toEqual([])
      expect(receiver.h.store.tickets.list()).toEqual([])
      expect(receiver.sent.some(([, value]) => value.startsWith('[superagent assignment]'))).toBe(false)
    } finally { local.mockRestore(); await sender.h.stop(); await receiver.h.stop() }
  })

  it.each(['session-a', 'session-o'])('keeps local member or observer %s on its own host and never forwards', async member => {
    const m = await team(), call = await proposalTool(m.h)
    const forwarded = vi.spyOn(m.h, 'forwardProposal')
    try {
      const filed = await call(member, '只交本机总工判断')
      expect(filed).toMatchObject({ ok: true, trigger_id: expect.any(String) })
      expect(m.h.store.triggers.get(filed.trigger_id)).toMatchObject({ human: false, actor: {
        source: 'workbench', id: member === 'session-o' ? observerActor(member) : memberActor(member),
      } })
      expect(forwarded).not.toHaveBeenCalled()
      expect(m.h.store.tickets.list()).toEqual([])
      expect(m.sent.some(([, value]) => value.startsWith('[superagent assignment]'))).toBe(false)
    } finally { forwarded.mockRestore(); await m.h.stop() }
  })

  it('refuses missing or outside sessions at the registered entry without sending or filing', async () => {
    const post = vi.fn(async () => ({ ok: true, trigger_id: 'unexpected' }))
    const m = await served(post)
    try {
      expect(await m.call(undefined, 'x')).toMatchObject({ ok: false, code: 'not-member' })
      expect(await m.call('session-x', 'x')).toMatchObject({ ok: false, code: 'not-member' })
      expect(post).not.toHaveBeenCalled()
      expect(m.h.store.threads.list()).toEqual([])
      expect(m.h.store.tickets.list()).toEqual([])
    } finally { await m.h.stop() }
  })

  it.each(['wrong-key', 'pi', 'unreachable'] as const)('preserves %s failure through the served tool without creating work', async failure => {
    const receiver = await team(), posts: unknown[] = []
    const sender = await served(async (_url, _path, body) => {
      posts.push(body)
      if (failure === 'unreachable') throw new Error('synthetic team unavailable')
      const request = body as { op: string; member: string; report: { text: string } }
      return receiver.h.remoteEvent(request.op, request.member, failure === 'pi' ? PI.key : 'wrong-key', request.report, failure === 'pi') as Record<string, unknown>
    }, failure === 'pi' ? PI.ref : REMOTE.ref)
    try {
      expect(await sender.call('session-s', '拒收不变成授权')).toMatchObject({
        ok: false, code: failure === 'pi' ? 'op' : failure === 'wrong-key' ? 'not-member' : 'unreachable',
      })
      expect(posts).toHaveLength(1)
      expect(sender.h.store.threads.list()).toEqual([])
      expect(receiver.h.store.threads.list()).toEqual([])
      expect(receiver.h.store.tickets.list()).toEqual([])
      expect(receiver.sent.some(([, value]) => value.startsWith('[superagent assignment]'))).toBe(false)
    } finally { await sender.h.stop(); await receiver.h.stop() }
  })
})

describe('the gate', () => {
  const thread = { subscriptions: [] } as never
  const trigger = (id: string, source = 'workbench') => ({ id: 't', source, threads: [], actor: { source, id }, human: false, addressed: 'direct', at: '', text: 'x', meta: {} }) as never
  const withRemote = { ...DEFAULT_SETTINGS, members: ['m'], remoteMembers: [REMOTE, PI] }

  it('admits a member in the pool as explicit in any accept mode, and nobody else with its actor shape', () => {
    for (const acceptMode of ['off', 'observe', 'auto'] as const) {
      expect(teamPolicy({ ...withRemote, acceptMode }).gate(trigger(memberActor('m')), thread, [])).toMatchObject({ admissible: true, strength: 'explicit', basis: { authority: 'member' } })
      expect(teamPolicy({ ...withRemote, acceptMode }).gate(trigger(memberActor(REMOTE.ref)), thread, [])).toMatchObject({ admissible: true, basis: { authority: 'member' } })
    }
    expect(teamPolicy(DEFAULT_SETTINGS).gate(trigger(memberActor('m')), thread, [])).toMatchObject({ admissible: false })
    expect(teamPolicy(withRemote).gate(trigger(memberActor(PI.ref)), thread, [])).toMatchObject({ admissible: false })
    expect(teamPolicy(withRemote).gate(trigger(memberActor('m'), 'a2a'), thread, [])).toMatchObject({ admissible: false })
    // The shape does not make a member's id the owner's or a listed person's.
    expect(proposerKind({ source: 'workbench', id: 'owner' })).toBeUndefined()
    expect(proposerKind({ source: 'a2a', id: memberActor('m') })).toBeUndefined()
  })

  it('a member who left no longer revalidates, and its open tickets are told when settings change', () => {
    const actor = { source: 'workbench', id: memberActor('m') }
    const mandate = { strength: 'explicit', policyVersion: 'v', actor, scope: 's', basis: { via: 'listed', addressed: 'direct', sender: actor.id, authority: 'member' } } as never
    expect(teamPolicy({ ...DEFAULT_SETTINGS, members: ['m'] }).revalidate(mandate)).toBe(true)
    expect(teamPolicy(DEFAULT_SETTINGS).revalidate(mandate)).toBe(false)
    // An observer authority on a member's actor (or the other way round) does not revalidate on the wrong pool check.
    const forged = { ...(mandate as object), basis: { via: 'listed', addressed: 'direct', sender: actor.id, authority: 'observer' } } as never
    expect(teamPolicy({ ...DEFAULT_SETTINGS, members: ['m'] }).revalidate(forged)).toBe(false)
    const effects = policyEffects({ ...DEFAULT_SETTINGS, members: ['m'] }, DEFAULT_SETTINGS, [{ id: 'ticket', mandate } as never])
    expect(effects.get('ticket')).toMatchObject({ requesterAllowed: false })
  })
})
