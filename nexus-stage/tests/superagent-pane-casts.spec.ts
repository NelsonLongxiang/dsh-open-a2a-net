/** #902 S4: the 团队 view's 待投卡 group — switches, per-member casting off, waiting casts and armed releases with 撤回. */
import { describe, expect, it } from 'vitest'
import { createSuperagentPane, releaseWhenText, type SaState, type SuperagentPaneDeps } from '../src/wb-superagent.ts'

type Json = Record<string, unknown>

const state = (casts?: Json): SaState => ({
  settings: { canvas: 'team', router: 'session-r', members: ['session-a', 'session-o'], observers: ['session-o'], acceptMode: 'observe', paused: false, sources: { workbench: true, a2a: false }, remoteMembers: [] },
  policyVersion: 'v1', canvases: ['team'],
  a2a: { enabled: false, address: null, health: {} },
  executor: { bindings: [] },
  threads: [], tickets: [{ id: 'aaaabbbbccccdddd', title: '验收单', createdAt: '2026-11-25T00:00:00Z', updatedAt: '2026-11-25T00:00:00Z', assignments: [], inputs: [], stage: null, channels: [], mandate: {} }],
  ...(casts !== undefined ? { casts } : {}),
} as unknown as SaState)

function pane(s: SaState): { p: ReturnType<typeof createSuperagentPane>; acts: Json[] } {
  const acts: Json[] = []
  const deps: SuperagentPaneDeps = { async act(body) { acts.push(body); return { ok: true } }, refresh: () => {} }
  const p = createSuperagentPane(deps)
  p.update(s, [], Date.parse('2026-11-25T01:00:00.000Z'))
  ;[...p.root.querySelectorAll<HTMLButtonElement>('.wb-filter')].find(b => b.textContent === '团队')!.click()
  return { p, acts }
}
const button = (p: ReturnType<typeof createSuperagentPane>, text: string): HTMLButtonElement[] => [...p.root.querySelectorAll<HTMLButtonElement>('.wb-btn')].filter(b => b.textContent === text)
const tick = async (): Promise<void> => { await new Promise(r => setTimeout(r, 20)) }

describe('待投卡', () => {
  it('is absent on a host that does not report casts', () => {
    const { p } = pane(state())
    expect(p.root.textContent).not.toContain('待投卡')
  })
  it('shows waiting casts and armed releases, each withdrawn by its id; no card text is shown', async () => {
    const { p, acts } = pane(state({
      on: true, draft: false, triggerRouter: false, off: [], available: true,
      waiting: [{ id: 'q1', session_id: 'session-a', name: '验收流程', reason: '卡在验收', basis: 'ticket:aaaabbbbccccdddd', mode: 'queue', at: '2026-11-25T00:30:00Z' }],
      releases: [{ id: 'r-1', session_id: 'session-a', template_id: 't9', reason: '等审', basis: 'none: x', when: 'ticket:aaaabbbbccccdddd person:review', then: 'trigger', expiresAt: '2026-11-26T00:00:00Z' }],
    }))
    const text = p.root.textContent ?? ''
    expect(text).toContain('待投卡')
    expect(text).toContain('排队（下一轮开头）')
    expect(text).toContain('工单「验收单」进入 person:review')
    expect(text).toContain('触发（空闲时立即开一轮）')
    const withdraws = button(p, '撤回')
    expect(withdraws.length).toBe(2)
    withdraws[0]!.click(); withdraws[1]!.click()
    await tick()
    expect(acts).toEqual([{ action: 'cast-withdraw', session_id: 'session-a', id: 'q1' }, { action: 'cast-withdraw', session_id: 'session-a', id: 'r-1' }])
  })
  it('turns casting off and back on per member (not the observer), and saves the switches as settings', async () => {
    const { p, acts } = pane(state({ on: false, draft: false, triggerRouter: false, off: ['session-r'], available: true, waiting: [], releases: [] }))
    expect(p.root.textContent).toContain('没有排着或挂着的卡')
    expect(button(p, '恢复投卡').length).toBe(1)
    expect(button(p, '停用投卡').length).toBe(1) // session-a only: the observer is not a target
    button(p, '停用投卡')[0]!.click()
    button(p, '恢复投卡')[0]!.click()
    const on = [...p.root.querySelectorAll<HTMLInputElement>('.wb-sa-casts input[type=checkbox]')]
    expect(on.length).toBe(3)
    on[0]!.checked = true; on[0]!.dispatchEvent(new Event('change'))
    on[2]!.checked = true; on[2]!.dispatchEvent(new Event('change'))
    await tick()
    expect(acts).toEqual([
      { action: 'settings', settings: { castOff: ['session-r', 'session-a'] } },
      { action: 'settings', settings: { castOff: [] } },
      { action: 'settings', settings: { observerCast: true } },
      { action: 'settings', settings: { observerTriggerRouter: true } },
    ])
  })
  it('says so when the plugin has no cast queue', () => {
    const { p } = pane(state({ on: true, draft: false, triggerRouter: false, off: [], available: false }))
    expect(p.root.textContent).toContain('还不支持投卡队列')
  })
  it('releaseWhenText reads each condition', () => {
    expect(releaseWhenText('idle:15')).toBe('空闲满 15 分钟')
    expect(releaseWhenText('ticket:aaaabbbbccccdddd ended')).toBe('工单「aaaabbbb」进入 ended')
    expect(releaseWhenText('at:2026-11-25T01:00:00.000Z').startsWith('到 ')).toBe(true)
  })
})

describe('待投卡: turning a member off says what was not withdrawn (#913 review 2)', () => {
  it('a mixed answer names the cards left and is shown as a problem', async () => {
    const acts: Json[] = []
    const deps: SuperagentPaneDeps = {
      async act(body) { acts.push(body); return { ok: true, castOff: { withdrawn: 1, notWithdrawn: ['q7'], releasesWithdrawn: 2, releasesSaved: false } } },
      refresh: () => {},
    }
    const p = createSuperagentPane(deps)
    p.update(state({ on: true, draft: false, triggerRouter: false, off: [], available: true, waiting: [], releases: [] }), [], Date.parse('2026-11-25T01:00:00.000Z'))
    ;[...p.root.querySelectorAll<HTMLButtonElement>('.wb-filter')].find(b => b.textContent === '团队')!.click()
    ;[...p.root.querySelectorAll<HTMLButtonElement>('.wb-btn')].find(b => b.textContent === '停用投卡')!.click()
    await new Promise(r => setTimeout(r, 20))
    expect(acts).toEqual([{ action: 'settings', settings: { castOff: ['session-r'] } }])
    const text = p.root.textContent ?? ''
    expect(text).toContain('撤回排着的卡 1 张、挂着的释放 2 张')
    expect(text).toContain('没撤回 1 张')
    expect(text).toContain('q7')
    expect(text).toContain('没写进磁盘')
    expect(p.root.querySelector('.is-danger')).not.toBeNull()
  })
  it('castOffText without failures reads plainly', async () => {
    const { castOffText, castOffFailed } = await import('../src/wb-superagent.ts')
    expect(castOffText('甲', { withdrawn: 2, notWithdrawn: [], releasesWithdrawn: 0, releasesSaved: true })).toBe('甲：已停用投卡；撤回排着的卡 2 张、挂着的释放 0 张')
    expect(castOffFailed({ withdrawn: 2, notWithdrawn: [], releasesWithdrawn: 0, releasesSaved: true })).toBe(false)
    expect(castOffText('甲', undefined)).toBe('甲：已停用投卡')
  })
})
