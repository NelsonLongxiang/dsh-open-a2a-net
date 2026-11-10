/** The team page's 搜索 and the settings saves: what the pane shows and where a result takes the person. */
import { describe, expect, it, vi } from 'vitest'
import { createSuperagentPane, type SaState, type SuperagentPaneDeps } from '../src/wb-superagent.ts'

type Calls = { acts: JsonLike[]; searches: string[] }
type JsonLike = Record<string, unknown>

const state = (over: Partial<SaState> = {}): SaState => ({
  settings: { canvas: 'team', router: 'session-r', members: ['session-a'], acceptMode: 'observe', paused: false, sources: { workbench: true, a2a: false }, remoteMembers: [] },
  policyVersion: 'v1',
  canvases: ['team'],
  a2a: { enabled: false, address: null, health: {} },
  executor: { bindings: [] },
  threads: [], tickets: [],
  ...over,
} as SaState)

function pane(over: Partial<SaState> = {}): { p: ReturnType<typeof createSuperagentPane>; calls: Calls } {
  const calls: Calls = { acts: [], searches: [] }
  const deps: SuperagentPaneDeps = {
    async act(body) { calls.acts.push(body); return { ok: true } },
    refresh: () => {},
    async search(query) { calls.searches.push(query); return query === '部署' ? { ok: true, results: [{ kind: 'ticket', id: 't1', title: '部署文档', at: '2026-11-10T08:00:00.000Z' }, { kind: 'request', id: 'wb-1', title: '帮我部署', at: '2026-11-10T08:01:00.000Z' }] } satisfies JsonLike : { ok: true, results: [] } },
  }
  const p = createSuperagentPane(deps)
  p.update(state(over), [], Date.parse('2026-11-10T08:02:00.000Z'))
  return { p, calls }
}

describe('the team page search', () => {
  it('searches on typing, lists the hits, and a hit opens where it lives', async () => {
    const { p, calls } = pane({ tickets: [{ id: 't1', title: '部署文档', createdAt: '2026-11-10T07:00:00.000Z', updatedAt: '2026-11-10T08:00:00.000Z', mandate: { strength: 'explicit', scope: 's', basis: { via: 'listed' }, actor: { source: 'workbench', id: 'owner' } }, channels: [], assignments: [], inputs: [], stage: { stage: 'working' } } as never] })
    const box = p.root.querySelector<HTMLInputElement>('.wb-sa-search')!
    expect(box).toBeTruthy()
    box.value = '部署'
    box.dispatchEvent(new Event('input'))
    await new Promise(r => setTimeout(r, 400))
    expect(calls.searches).toEqual(['部署'])
    const hits = [...p.root.querySelectorAll<HTMLButtonElement>('.wb-sa-hit')]
    expect(hits.length).toBe(2)
    expect(hits[0]!.textContent).toContain('工单')
    hits[0]!.click()
    await new Promise(r => setTimeout(r, 250))
    const located = p.root.querySelector('[data-ticket="t1"]')
    expect(located).toBeTruthy()
    expect(p.root.querySelector<HTMLElement>('.wb-sa-drop')!.hidden).toBe(true)
  })
  it('a short query searches nothing', async () => {
    const { p, calls } = pane()
    const box = p.root.querySelector<HTMLInputElement>('.wb-sa-search')!
    box.value = '部'
    box.dispatchEvent(new Event('input'))
    await new Promise(r => setTimeout(r, 400))
    expect(calls.searches).toEqual([])
  })
})

describe('the settings saves', () => {
  it('the settings view lists who saved what, when', async () => {
    const { p } = pane({ settingsHistory: [{ id: 'h1', at: '2026-11-10T07:30:00.000Z', by: 'owner', changes: [{ field: 'acceptMode', from: 'observe', to: 'auto' }] }] } as never)
    const settings = [...p.root.querySelectorAll<HTMLButtonElement>('.wb-filter')].find(b => b.textContent === '设置')!
    settings.click()
    expect(p.root.textContent).toContain('acceptMode')
    expect(p.root.textContent).toContain('observe → auto')
    expect(p.root.textContent).toContain('属主')
  })
  it('a team with no saves yet shows no block', () => {
    const { p } = pane()
    const settings = [...p.root.querySelectorAll<HTMLButtonElement>('.wb-filter')].find(b => b.textContent === '设置')!
    settings.click()
    expect(p.root.textContent).not.toContain('设置保存记录')
  })
})
