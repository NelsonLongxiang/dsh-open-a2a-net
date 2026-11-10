// @vitest-environment jsdom
/** docs/design/superagent-github-issues.md G1, G7: the team page's GitHub section sends only what changed. */
import { describe, expect, it, vi } from 'vitest'
import { buildTeamFields } from '../src/wb-superagent-settings.ts'

const base = { members: [], remoteMembers: [], allowed: { github: ['Owner'] }, sources: { workbench: true, a2a: false, github: false } }
const mount = (s: Record<string, unknown>, sync?: () => void) => {
  const fields = buildTeamFields(s as never, id => id, () => {}, sync)
  const root = document.createElement('div'); root.append(...fields.nodes); document.body.replaceChildren(root)
  return { fields, root, q: <T extends Element>(label: string) => root.querySelector(`[aria-label="${label}"]`) as T }
}

describe('the GitHub section', () => {
  it('sends nothing of GitHub when it is untouched, so a save needs no owner login', () => {
    const { fields } = mount(base)
    const out = fields.patch()
    expect(out).toEqual({ patch: {} })
  })
  it('turning issues on sends the switch, the repositories and the intake', () => {
    const { fields, q } = mount(base)
    q<HTMLInputElement>('接收 GitHub Issue 作为需求').checked = true
    q<HTMLTextAreaElement>('接收 Issue 的仓库').value = 'o/net\no/web'
    q<HTMLSelectElement>('哪些 Issue 算需求').value = 'all'
    expect(fields.patch()).toEqual({ patch: { sources: { github: true }, github: { repos: ['o/net', 'o/web'], intake: 'all' } } })
  })
  it('refuses a repository that is not owner/name', () => {
    const { fields, q } = mount(base)
    q<HTMLTextAreaElement>('接收 Issue 的仓库').value = 'not-a-repo'
    expect(fields.patch()).toMatchObject({ error: expect.stringContaining('owner/name') })
  })
  it('offers the collaborator sync only when the page can send it', () => {
    const sync = vi.fn()
    const { root } = mount(base, sync)
    const button = [...root.querySelectorAll('button')].find(b => b.textContent === '从仓库协作者同步账号')!
    button.click()
    expect(sync).toHaveBeenCalledOnce()
    expect([...mount(base).root.querySelectorAll('button')].some(b => b.textContent === '从仓库协作者同步账号')).toBe(false)
  })
})

describe('granted tools (design tool-requests T5)', () => {
  const granted = { ...base, extraTools: { router: ['webcam'], member: ['gitbash'] } }
  it('an untouched list sends nothing, so an ordinary save needs no owner login', () => {
    expect(mount(granted).fields.patch()).toEqual({ patch: {} })
  })
  it('taking a tool back sends only that role\'s list', () => {
    const { fields, q } = mount(granted)
    q<HTMLTextAreaElement>('成员和观察者额外放行的工具').value = ''
    expect(fields.patch()).toEqual({ patch: { extraTools: { member: [] } } })
  })
})
