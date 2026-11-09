// @vitest-environment node
/** superagent follows a ticket's pull request: the merge ends the ticket, comments come back, a failed read ends nothing. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parsePullRequest } from '../../src/superagent/host/pr-follow.ts'
import { ReviewRequests } from '../../src/superagent/host/review-requests.ts'
import { DEFAULT_SETTINGS, parseSettings } from '../../src/superagent/host/policy.ts'

const URL = 'https://github.com/o/net/pull/7'
const canvasOf = (ids: string[]) => (name: string) => name === 'team' ? { local: ids, remote: [] } : undefined

async function team() {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const sent: Array<[string, string]> = []
  const gh: { pull: Record<string, unknown>; comments: unknown[]; reviews: unknown[]; fail: boolean; calls: string[] } = { pull: { state: 'open' }, comments: [], reviews: [], fail: false, calls: [] }
  const h = new SuperagentHost({
    canvasTeam: canvasOf(['session-r', 'session-a']), home: mkdtempSync(join(tmpdir(), 'sa-pr-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id, text) => { sent.push([id, text]); return true }, interval: () => () => {},
    memberTurn: () => ({ quiet: true, text: '' }),
    gh: async args => {
      gh.calls.push(args[1]!)
      if (gh.fail) throw new Error('HTTP 502')
      const path = args[1]!
      if (path.endsWith('/issues/7/comments?per_page=100')) return JSON.stringify(gh.comments)
      if (path.endsWith('/reviews?per_page=100')) return JSON.stringify(gh.reviews)
      if (path.endsWith('/comments?per_page=100')) return '[]'
      return JSON.stringify(gh.pull)
    },
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', repos: { 'session-a': 'o/net' }, allowed: { github: ['Owner'] } }, () => true)).toMatchObject({ ok: true })
  h.start()
  const asked = h.request('改一下') as { triggerId: string }
  h.pass()
  const accepted = routeItem(h, { trigger_id: asked.triggerId, kind: 'accept', title: '一', scope: 's', reason: 'r', repo: 'o/net' }) as { ticket_id: string }
  await vi.waitFor(() => { expect(sent.some(([id, t]) => id === 'session-a' && t.startsWith('[superagent assignment]'))).toBe(true) })
  const poll = async (): Promise<void> => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_000)
    h.pass()
    now.mockRestore()
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const ticket = () => h.store.tickets.get(accepted.ticket_id)!
  return { h, sent, gh, ticket, poll, id: accepted.ticket_id }
}

describe('a ticket follows its pull request', () => {
  it('reads a pull request URL', () => {
    expect(parsePullRequest(URL)).toEqual({ repo: 'o/net', number: 7, id: 'o/net#7' })
    expect(parsePullRequest(`${URL}/files`)).toMatchObject({ number: 7 })
    expect(parsePullRequest('https://github.com/o/net/issues/7')).toBeUndefined()
    expect(parsePullRequest('https://evil.example/o/net/pull/7')).toBeUndefined()
  })

  it('without a pull request ready still ends the ticket; with one it waits for the merge, without a member', async () => {
    const m = await team()
    try {
      expect(m.h.report('session-a', { state: 'ready', summary: 'x' }, m.id, 'https://github.com/o/other/pull/7')).toMatchObject({ ok: false, code: 'pull-request' })
      expect(m.h.report('session-a', { state: 'ready', summary: 'PR 开好了' }, m.id, URL)).toMatchObject({ ok: true })
      expect(m.ticket().ended).toBeUndefined()
      m.h.memberIdle('session-a')
      await new Promise(resolve => setTimeout(resolve, 20))
      expect(m.h.executor.bindingOf('session-a')).toBeUndefined()
      await m.poll()
      expect(m.ticket().ended).toBeUndefined()
      m.gh.pull = { state: 'closed', merged: true, merged_at: '2026-11-09T01:00:00Z' }
      await m.poll()
      expect(m.ticket().ended).toMatchObject({ outcome: 'merged' })
    } finally { await m.h.stop() }
  })

  it('a pull request closed unmerged ends the ticket closed', async () => {
    const m = await team()
    try {
      m.h.report('session-a', { state: 'ready', summary: 'x' }, m.id, URL)
      m.gh.pull = { state: 'closed', merged: false, closed_at: '2026-11-09T01:00:00Z' }
      await m.poll()
      expect(m.ticket().ended).toMatchObject({ outcome: 'closed' })
    } finally { await m.h.stop() }
  })

  it('comments after the first read come back; the owner counts as a person, others and bots are context', async () => {
    const m = await team()
    try {
      m.gh.comments = [{ id: 1, user: { login: 'Owner', type: 'User' }, body: '早就写的评论', created_at: '2026-11-09T00:00:00Z' }]
      m.h.report('session-a', { state: 'ready', summary: 'x' }, m.id, URL)
      m.h.memberIdle('session-a')
      await m.poll()
      expect(m.sent.some(([, t]) => t.includes('早就写的评论'))).toBe(false)
      m.gh.comments = [...m.gh.comments,
        { id: 2, user: { login: 'owner', type: 'User' }, body: '这里要改', created_at: '2026-11-09T02:00:00Z' },
        { id: 3, user: { login: 'someone', type: 'User' }, body: '路过提一句', created_at: '2026-11-09T02:01:00Z' },
        { id: 4, user: { login: 'ci[bot]', type: 'Bot' }, body: '构建通过', created_at: '2026-11-09T02:02:00Z' }]
      await m.poll()
      const by = (word: string) => m.ticket().inputs.find(i => i.kind === 'trigger' && m.h.store.triggers.get(i.triggerId)?.text.includes(word))
      expect(by('这里要改')).toMatchObject({ human: true })
      expect((by('路过提一句') as { human?: boolean }).human).toBeUndefined()
      expect((by('构建通过') as { human?: boolean }).human).toBeUndefined()
      await vi.waitFor(() => { expect(m.sent.some(([id, t]) => id === 'session-a' && t.includes('这里要改'))).toBe(true) })
      m.gh.calls.length = 0
      await m.poll()
      expect(m.ticket().inputs.filter(i => i.kind === 'trigger' && m.h.store.triggers.get(i.triggerId)?.text.includes('这里要改'))).toHaveLength(1)
    } finally { await m.h.stop() }
  })

  it('a comment the member took up stays with the ticket; one it did not goes to the router when the ticket ends', async () => {
    const m = await team()
    try {
      m.h.report('session-a', { state: 'ready', summary: 'x' }, m.id, URL)
      m.h.memberIdle('session-a')
      await m.poll()
      m.gh.comments = [
        { id: 2, user: { login: 'owner', type: 'User' }, body: '已看过', created_at: '2026-11-09T02:00:00Z' },
        { id: 3, user: { login: 'owner', type: 'User' }, body: '没人接', created_at: '2026-11-09T02:01:00Z' },
        { id: 4, user: { login: 'someone', type: 'User' }, body: '路过', created_at: '2026-11-09T02:02:00Z' }]
      await m.poll()
      await vi.waitFor(() => { expect(m.sent.some(([id, t]) => id === 'session-a' && t.includes('已看过'))).toBe(true) })
      expect(m.h.takeUp('session-a', 'ack', 'gh-comment-2', '收到')).toMatchObject({ ok: true, acknowledgement: 'recorded', reused: false, ticketId: m.id })
      expect(m.h.takeUp('session-a', 'ack', 'gh-comment-2', '收到')).toMatchObject({ ok: true, reused: true })
      expect(m.h.takeUp('session-a', 'ack', 'gh-comment-4', '收到')).toMatchObject({ ok: false, code: 'ackNoChannel' })
      expect(m.h.store.messages.list().filter(row => row.message.channel.source === 'github')).toHaveLength(0)
      m.h.report('session-a', { state: 'ready', summary: '已回应' }, m.id, URL)
      await vi.waitFor(() => { m.h.memberIdle('session-a'); expect(m.h.executor.bindingOf('session-a')).toBeUndefined() })
      // One the member took up and answered in its report; one that came in after that report and nobody took up.
      const read = m.ticket()
      for (const input of read.inputs) if (input.kind === 'trigger') input.readAt = new Date(Date.now() + (input.triggerId === 'gh-comment-3' ? 3_600_000 : -3_600_000)).toISOString()
      m.h.store.tickets.save(read)
      m.gh.pull = { state: 'closed', merged: true, merged_at: '2026-11-09T03:00:00Z' }
      await m.poll()
      expect(m.ticket().ended).toMatchObject({ outcome: 'merged' })
      m.h.pass()
      const candidates = (): string[] => m.sent.filter(([id, t]) => id === 'session-r' && t.startsWith('[superagent candidate]')).map(([, t]) => t)
      await vi.waitFor(() => { expect(candidates().some(t => t.includes('没人接'))).toBe(true) })
      expect(candidates().some(t => t.includes('已看过'))).toBe(false)
    } finally { await m.h.stop() }
  })

  it('a failed read ends nothing, is shown, and clears when reads work again', async () => {
    const m = await team()
    try {
      m.h.report('session-a', { state: 'ready', summary: 'x' }, m.id, URL)
      m.gh.fail = true
      await m.poll()
      expect(m.ticket().ended).toBeUndefined()
      expect((m.h.state() as { pullRequestProblem?: string }).pullRequestProblem).toContain('o/net#7')
      m.gh.fail = false
      await m.poll()
      expect((m.h.state() as { pullRequestProblem?: string }).pullRequestProblem).toBeUndefined()
    } finally { await m.h.stop() }
  })
})

describe('asking for review', () => {
  const reviewer = 'dsh/f49961b0', head = 'abcdef1234567890', next = '1234567abcdefff0'
  function channel(ask: (address: string, text: string) => Promise<string | undefined> = async () => 'direct-1', who: string | null = reviewer) {
    const asked: Array<[string, string]> = [], notes: Array<[string, string]> = []
    const r = new ReviewRequests({ path: join(mkdtempSync(join(tmpdir(), 'sa-review-')), 'r.json'), reviewer: () => who ?? undefined, logger: { warn: () => {} }, note: (t, x) => { notes.push([t, x]) },
      ask: async (a, x) => { asked.push([a, x]); return await ask(a, x) } })
    return { r, asked, notes }
  }
  const receipt = (task: string, text: string, actor = reviewer, proof = 'origin-claim') => ({ actor: { source: 'a2a', id: actor }, text, at: '2026-11-09T00:00:00Z', meta: { receiptFor: task, proof } }) as never

  it('asks once per head, naming only the pull request and its commit', async () => {
    const m = channel()
    await m.r.opened('o/net#7', head, URL, 't1')
    await m.r.opened('o/net#7', head, URL, 't1')
    expect(m.asked).toHaveLength(1)
    expect(m.asked[0]![0]).toBe(reviewer)
    expect(m.asked[0]![1]).toContain(URL)
    expect(m.asked[0]![1]).toContain(head)
    await m.r.opened('o/net#7', next, URL, 't1')
    expect(m.asked).toHaveLength(2)
  })

  it('asks nobody without a reviewer, and records nothing when the reviewer is not linked', async () => {
    const none = channel(undefined, null)
    await none.r.opened('o/net#7', head, URL, 't1')
    expect(none.asked).toHaveLength(0)
    const unlinked = channel(async () => undefined)
    await unlinked.r.opened('o/net#7', head, URL, 't1')
    expect(unlinked.r.list()).toHaveLength(0)
  })

  it('a PASS naming the commit passes; anything else does not; only the reviewer on the latest request counts', async () => {
    const m = channel()
    await m.r.opened('o/net#7', head, URL, 't1')
    m.r.received(receipt('direct-1', 'PASS @ abcdef1', 'someone/else'))
    m.r.received(receipt('direct-1', 'PASS @ abcdef1', reviewer, 'unbound'))
    expect(m.notes).toHaveLength(0)
    m.r.received(receipt('direct-1', 'PASS @ abcdef1'))
    expect(m.notes[0]![1]).toContain('PASS')
    expect(m.r.list()[0]!.verdict).toMatchObject({ pass: true })
    const bare = channel()
    await bare.r.opened('o/net#7', head, URL, 't1')
    bare.r.received(receipt('direct-1', 'PASS'))
    expect(bare.r.list()[0]!.verdict).toMatchObject({ pass: false })
    const stale = channel(async (_a, x) => x.includes(head) ? 'direct-old' : 'direct-new')
    await stale.r.opened('o/net#7', head, URL, 't1')
    await stale.r.opened('o/net#7', next, URL, 't1')
    stale.r.received(receipt('direct-old', 'PASS @ abcdef1'))
    expect(stale.notes).toHaveLength(0)
  })

  it('settings take one reviewer address and clear it', () => {
    expect(parseSettings({ reviewer }, DEFAULT_SETTINGS)).toMatchObject({ ok: true, settings: { reviewer } })
    expect(parseSettings({ reviewer: 'not an address' }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    const set = parseSettings({ reviewer }, DEFAULT_SETTINGS) as { ok: true; settings: typeof DEFAULT_SETTINGS }
    expect((parseSettings({ reviewer: null }, set.settings) as { settings: { reviewer?: string } }).settings.reviewer).toBeUndefined()
  })
})
