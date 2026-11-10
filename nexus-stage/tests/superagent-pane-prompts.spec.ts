/** The settings' prompt boxes: empty is the default, text saves as settings.prompts, saved text pre-fills. */
import { describe, expect, it } from 'vitest'
import { createSuperagentPane, type SaState, type SuperagentPaneDeps } from '../src/wb-superagent.ts'

type Json = Record<string, unknown>

const state = (prompts?: Json): SaState => ({
  settings: { canvas: 'team', router: 'session-r', members: ['session-a'], acceptMode: 'observe', paused: false, sources: { workbench: true, a2a: false }, remoteMembers: [], ...(prompts !== undefined ? { prompts } : {}) },
  policyVersion: 'v1', canvases: ['team'],
  a2a: { enabled: false, address: null, health: {} },
  executor: { bindings: [] },
  threads: [], tickets: [],
} as unknown as SaState)

function pane(s: SaState): { p: ReturnType<typeof createSuperagentPane>; acts: Json[] } {
  const acts: Json[] = []
  const deps: SuperagentPaneDeps = {
    async act(body) { acts.push(body); return { ok: true } },
    refresh: () => {},
    async search() { return { ok: true, results: [] } },
  }
  const p = createSuperagentPane(deps)
  p.update(s, [], Date.parse('2026-11-10T10:00:00.000Z'))
  const settings = [...p.root.querySelectorAll<HTMLButtonElement>('.wb-filter')].find(b => b.textContent === '设置')!
  settings.click()
  return { p, acts }
}

const save = (p: ReturnType<typeof createSuperagentPane>): void => {
  [...p.root.querySelectorAll<HTMLButtonElement>('.wb-btn')].find(b => b.textContent === '保存')!.click()
}

describe('the prompt boxes', () => {
  it('untouched boxes send no prompts at all; text saves as settings.prompts', async () => {
    const { p, acts } = pane(state())
    save(p)
    await new Promise(r => setTimeout(r, 30))
    expect('prompts' in (acts[0] as { settings: Record<string, unknown> }).settings).toBe(false)
    const boxes = [...p.root.querySelectorAll<HTMLTextAreaElement>('textarea.wb-sa-prompt')]
    expect(boxes.length).toBe(2)
    boxes[0]!.value = '讲中文'
    boxes[1]!.value = '交付即 PR 链接'
    save(p)
    await new Promise(r => setTimeout(r, 30))
    expect(acts[1]).toMatchObject({ action: 'settings', settings: { prompts: { communication: '讲中文', delivery: '交付即 PR 链接' } } })
  })
  it('clearing a saved prompt sends prompts null (the change is real)', async () => {
    const { p, acts } = pane(state({ communication: '讲中文' }))
    p.root.querySelector<HTMLTextAreaElement>('textarea.wb-sa-prompt')!.value = ''
    save(p)
    await new Promise(r => setTimeout(r, 30))
    expect(acts[0]).toMatchObject({ action: 'settings', settings: { prompts: null } })
  })
  it('a saved prompt pre-fills the box for the next read', () => {
    const { p } = pane(state({ communication: '讲中文' }))
    const box = p.root.querySelector<HTMLTextAreaElement>('textarea.wb-sa-prompt')!
    expect(box.value).toBe('讲中文')
    expect(p.root.textContent).toContain('预设')
  })
})
