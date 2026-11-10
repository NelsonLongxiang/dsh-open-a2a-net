// @vitest-environment node
/** docs/design/superagent-github-issues.md: GitHub issues as a source of requests. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { issueAddressed, REPLY_PREFIX } from '../../src/superagent/host/github-issues.ts'
import { DEFAULT_SETTINGS, parseSettings } from '../../src/superagent/host/policy.ts'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'

const issue = (number: number, login: string, title: string, extra: Record<string, unknown> = {}) => ({ number, title, body: '', user: { login, type: 'User' }, created_at: '2026-11-10T00:00:00Z', labels: [], ...extra })

async function team(on = true, existing: unknown[] = []) {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { routeItem } = await import('../../src/superagent/host/tools.ts')
  const sent: Array<[string, string]> = []
  const gh = { issues: [...existing] as unknown[], comments: [] as unknown[], collaborators: [] as unknown[], posted: [] as string[][] }
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-a'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-gi-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: (id: string, text: string) => { sent.push([id, text]); return true }, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }),
    gh: async (args: string[]) => {
      if (args[0] === 'issue') { gh.posted.push(args); return '' }
      const path = args[1]!
      if (path.includes('/issues/comments')) return JSON.stringify(gh.comments)
      if (path.includes('/collaborators')) return JSON.stringify(gh.collaborators)
      if (path.includes('/issues?')) return JSON.stringify(gh.issues)
      return '[]'
    },
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r', allowed: { github: ['Owner'] }, sources: { github: on }, github: { repos: ['o/net'] } }, () => true)).toMatchObject({ ok: true })
  h.start()
  const poll = async (): Promise<void> => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_600_000)
    h.pass()
    now.mockRestore()
    await new Promise(resolve => setTimeout(resolve, 30))
    h.pass()
  }
  const candidates = () => sent.filter(([id, t]) => id === 'session-r' && t.startsWith('[superagent candidate]')).map(([, t]) => t)
  return { h, gh, poll, candidates, routeItem }
}

describe('which issues are addressed to the team (G2)', () => {
  it('the label or an @superagent mention, or every issue with intake all', () => {
    expect(issueAddressed({ title: 'x', body: '', labels: [{ name: 'SuperAgent' }] }, 'mention')).toBe(true)
    expect(issueAddressed({ title: '请 @superagent 看看', body: '' }, 'mention')).toBe(true)
    expect(issueAddressed({ title: 'x', body: 'cc @superagent-bot' }, 'mention')).toBe(false)
    expect(issueAddressed({ title: 'x', body: 'mail a@superagent' }, 'mention')).toBe(false)
    expect(issueAddressed({ title: 'x', body: '' }, 'mention')).toBe(false)
    expect(issueAddressed({ title: 'x', body: '' }, 'all')).toBe(true)
  })
})

describe('settings (G1, G7)', () => {
  it('validates the repositories and the intake; off by default', () => {
    expect(DEFAULT_SETTINGS.sources.github).toBe(false)
    expect(parseSettings({ github: { repos: ['o/net'] } }, DEFAULT_SETTINGS)).toMatchObject({ ok: true, settings: { github: { repos: ['o/net'], intake: 'mention' } } })
    expect(parseSettings({ github: { repos: ['not a repo'] } }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ github: { repos: Array.from({ length: 11 }, (_, i) => `o/r${String(i)}`) } }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ github: { repos: [], intake: 'some' } }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
    expect(parseSettings({ sources: { github: 'yes' } }, DEFAULT_SETTINGS)).toMatchObject({ ok: false })
  })
  it('only the GitHub parts need the owner: the workbench and A2A lists keep today\'s route', () => {
    expect(touchesRules({ github: { repos: [] } })).toBe(true)
    expect(touchesRules({ allowed: { github: ['x'] } })).toBe(true)
    expect(touchesRules({ sources: { github: true } })).toBe(true)
    expect(touchesRules({ allowed: { a2a: ['x'] } })).toBe(false)
    expect(touchesRules({ sources: { workbench: true } })).toBe(false)
  })
})

describe('issues reach the router (G2–G5)', () => {
  it('what was there before is not news; an allowed person\'s addressed issue is a candidate, and the reply goes back as a comment', async () => {
    const m = await team(true, [issue(1, 'Owner', 'old @superagent')])
    await m.poll()
    expect(m.candidates()).toHaveLength(0)
    m.gh.issues = [issue(1, 'Owner', 'old @superagent'), issue(2, 'owner', '请 @superagent 加个开关'), issue(3, 'stranger', 'x', { labels: [{ name: 'superagent' }] }), issue(4, 'Owner', '没点名'), issue(5, 'Owner', 'pr @superagent', { pull_request: {} })]
    await m.poll()
    await vi.waitFor(() => { expect(m.candidates()).toHaveLength(1) })
    expect(m.candidates()[0]).toContain('[GitHub issue o/net#2 by Owner]')
    const trigger = m.h.store.triggers.get('gh-issue-o/net-2')!
    expect(trigger).toMatchObject({ actor: { source: 'github', id: 'Owner' }, human: true, addressed: 'mention' })
    expect(m.h.store.triggers.get('gh-issue-o/net-3')).toMatchObject({ human: true })
    m.routeItem(m.h, { trigger_id: trigger.id, kind: 'accept', title: '开关', scope: 's', reason: 'r', acknowledgement: '收到，在做' } as never)
    m.h.pass()
    await vi.waitFor(() => { expect(m.gh.posted.some(args => args.includes('--repo') && args.includes('o/net') && args[2] === '2')).toBe(true) })
    const body = m.gh.posted.find(args => args[2] === '2')!.at(-1)!
    expect(body.startsWith(REPLY_PREFIX)).toBe(true)
    await m.h.stop()
  })
  it('a comment on an issue the team took is a follow-up; comments on older issues and the bot\'s own replies are not', async () => {
    const m = await team(true, [issue(1, 'Owner', 'old')])
    await m.poll()
    m.gh.issues = [issue(1, 'Owner', 'old'), issue(2, 'Owner', '@superagent 做个事')]
    await m.poll()
    m.gh.comments = [
      { id: 10, body: '补充一下', user: { login: 'Owner', type: 'User' }, issue_url: 'https://api.github.com/repos/o/net/issues/2' },
      { id: 11, body: '旧帖', user: { login: 'Owner', type: 'User' }, issue_url: 'https://api.github.com/repos/o/net/issues/1' },
      { id: 12, body: `${REPLY_PREFIX}收到`, user: { login: 'Owner', type: 'User' }, issue_url: 'https://api.github.com/repos/o/net/issues/2' },
    ]
    await m.poll()
    expect(m.h.store.triggers.get('gh-issue-comment-10')).toMatchObject({ threads: [{ source: 'github', id: 'o/net#2' }] })
    expect(m.h.store.triggers.get('gh-issue-comment-11')).toBeUndefined()
    expect(m.h.store.triggers.get('gh-issue-comment-12')).toBeUndefined()
    await m.h.stop()
  })
  it('with the source off nothing is read', async () => {
    const m = await team(false)
    m.gh.issues = [issue(2, 'Owner', '@superagent x')]
    await m.poll(); await m.poll()
    expect(m.candidates()).toHaveLength(0)
    await m.h.stop()
  })
})

describe('allowed logins from collaborators (G6)', () => {
  it('lists the push collaborators, leaving bots out', async () => {
    const m = await team()
    m.gh.collaborators = [{ login: 'alice', type: 'User' }, { login: 'ci', type: 'Bot' }, { login: 'Owner', type: 'User' }]
    expect(await m.h.githubCollaborators()).toEqual({ ok: true, logins: ['Owner', 'alice'] })
    await m.h.stop()
  })
})
