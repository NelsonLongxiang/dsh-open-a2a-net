/** The team page's model pickers: filled by hand when the catalog is unreadable, saved as settings.models. */
import { describe, expect, it } from 'vitest'
import { createSuperagentPane, type SaState, type SuperagentPaneDeps } from '../src/wb-superagent.ts'

type Json = Record<string, unknown>
type Act = { acts: Json[] }

const state = (): SaState => ({
  settings: { canvas: 'team', router: 'session-r', members: ['session-a'], acceptMode: 'observe', paused: false, sources: { workbench: true, a2a: false }, remoteMembers: [] },
  policyVersion: 'v1', canvases: ['team'],
  a2a: { enabled: false, address: null, health: {} },
  executor: { bindings: [] },
  threads: [], tickets: [],
} as unknown as SaState)

function pane(modelsJson?: Json): { p: ReturnType<typeof createSuperagentPane>; calls: Act } {
  const calls: Act = { acts: [] }
  const deps: SuperagentPaneDeps = {
    async act(body) { calls.acts.push(body); return { ok: true } },
    refresh: () => {},
    ...(modelsJson !== undefined ? { async models() { return modelsJson } } : { async models() { throw new Error('no') } }),
  }
  const p = createSuperagentPane(deps)
  p.update(state(), [], Date.parse('2026-11-10T10:00:00.000Z'))
  const settings = [...p.root.querySelectorAll<HTMLButtonElement>('.wb-filter')].find(b => b.textContent === '设置')!
  settings.click()
  return { p, calls }
}

const save = (p: ReturnType<typeof createSuperagentPane>): void => {
  const button = [...p.root.querySelectorAll<HTMLButtonElement>('.wb-btn')].find(b => b.textContent === '保存')!
  button.click()
}

describe('the model pickers', () => {
  it('a catalog fills the datalists; hand text saves as settings.models', async () => {
    const { p, calls } = pane({ providers: [{ id: 'deepseek', models: [{ id: 'chat' }] }] })
    await new Promise(r => setTimeout(r, 50))
    const lists = p.root.querySelectorAll('datalist')
    expect(lists.length).toBeGreaterThanOrEqual(2)
    const options = [...lists[0]!.querySelectorAll('option')].map(o => o.value)
    expect(options).toContain('deepseek/chat')
    const inputs = [...p.root.querySelectorAll<HTMLInputElement>('input.wb-sa-model')]
    expect(inputs.length).toBe(2)
    inputs[0]!.value = 'deepseek/chat'
    inputs[1]!.value = 'openai/gpt-5'
    save(p)
    await new Promise(r => setTimeout(r, 30))
    expect(calls.acts[0]).toMatchObject({ action: 'settings', settings: { models: { router: { provider: 'deepseek', model: 'chat' }, member: { provider: 'openai', model: 'gpt-5' } } } })
    // Untouched pickers send no models at all (review of #566 fifth round): an ordinary save must not clear what is set.
    const untouched = pane(state())
    save(untouched.p)
    await new Promise(r => setTimeout(r, 30))
    expect('models' in (untouched.calls.acts[0] as { settings: Record<string, unknown> }).settings).toBe(false)
  })
  it('empty pickers save models null; a bad shape is refused with a note', async () => {
    const { p, calls } = pane()
    save(p)
    await new Promise(r => setTimeout(r, 30))
    expect(calls.acts[0]).toMatchObject({ action: 'settings', settings: { models: null } })
    const input = p.root.querySelector<HTMLInputElement>('input.wb-sa-model')!
    input.value = 'noslash'
    save(p)
    await new Promise(r => setTimeout(r, 30))
    expect(calls.acts.length).toBe(1)
    expect(p.root.textContent).toContain('provider/model')
  })
  it('a saved choice shows as provider/model on the next render', () => {
    const m = { p: undefined as unknown as ReturnType<typeof createSuperagentPane>, calls: { acts: [] } }
    void m
    const deps: SuperagentPaneDeps = {
      async act() { return { ok: true } }, refresh: () => {},
      async models() { return { providers: [] } },
    }
    const withModels = { ...state(), settings: { ...state().settings, models: { router: { provider: 'deepseek', model: 'chat' } } } } as unknown as SaState
    const p = createSuperagentPane(deps)
    p.update(withModels, [], Date.parse('2026-11-10T10:00:00.000Z'))
    const settings = [...p.root.querySelectorAll<HTMLButtonElement>('.wb-filter')].find(b => b.textContent === '设置')!
    settings.click()
    const input = p.root.querySelector<HTMLInputElement>('input.wb-sa-model')!
    expect(input.value).toBe('deepseek/chat')
  })
})
