// @vitest-environment jsdom
/** #933: the team tab's terminal-pairing banner: shown only while a pairing waits; text stays text; allow and deny go to the host. */
import { describe, expect, it, vi } from 'vitest'
import { createPairingsBanner, pairingOf } from '../src/wb-pairings.ts'

const XSS = '<img src=x onerror="window.__pwned=1">'
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const button = (root: Element, text: string): HTMLButtonElement => Array.from(root.querySelectorAll('button')).find(b => (b.textContent ?? '') === text)!
const row = (over: Record<string, unknown> = {}) => ({ id: 'pair-1', code: 'ABCD-EFGH', name: `laptop${XSS}`, days: 7, at: '2026-11-26T00:00:00Z', expiresAt: '2026-11-26T00:10:00Z', state: 'waiting', ...over })

function mount(rows: () => unknown[], act = vi.fn(async (_b: Record<string, unknown>) => ({ status: 200, body: { ok: true } as Record<string, unknown> }))) {
  const list = vi.fn(async () => ({ delegates: [], pairings: rows() }))
  const banner = createPairingsBanner({ list, act })
  document.body.replaceChildren(banner.root)
  return { banner, list, act }
}

describe('#933 pairing banner', () => {
  it('is hidden while nothing waits, and shows a waiting pairing with its code; names stay text', async () => {
    let rows: unknown[] = []
    const { banner } = mount(() => rows)
    await banner.refresh(); await flush()
    expect(banner.root.hidden).toBe(true)
    rows = [row()]
    await banner.refresh(); await flush()
    expect(banner.root.hidden).toBe(false)
    expect(banner.root.textContent).toContain('ABCD-EFGH')
    expect(banner.root.querySelector('img')).toBeNull()
    expect(banner.root.textContent).toContain(XSS)
    expect(banner.waiting()).toBe(1)
  })
  it('allow and deny send the pairing id to the host and say what happened', async () => {
    let rows: unknown[] = [row()]
    const { banner, act } = mount(() => rows)
    await banner.refresh(); await flush()
    button(banner.root, '允许').click(); rows = []
    await flush(); await flush()
    expect(act).toHaveBeenCalledWith({ action: 'pair-approve', id: 'pair-1' })
    expect(banner.root.textContent).toContain('已允许')
    rows = [row({ id: 'pair-2' })]
    await banner.refresh(); await flush()
    button(banner.root, '拒绝').click(); rows = []
    await flush(); await flush()
    expect(act).toHaveBeenLastCalledWith({ action: 'pair-deny', id: 'pair-2' })
  })
  it('a refusal by the host (no owner login) is said, not hidden', async () => {
    const act = vi.fn(async () => ({ status: 401, body: { ok: false, error: 'owner proof' } as Record<string, unknown> }))
    const { banner } = mount(() => [row()], act)
    await banner.refresh(); await flush()
    button(banner.root, '允许').click()
    await flush(); await flush()
    expect(banner.root.textContent).toContain('需要你在这台节点的浏览器里登录')
  })
  it('odd rows from the host are not shown: a bad code, a missing id', () => {
    expect(pairingOf(row({ code: '<b>XX</b>' }))).toBeUndefined()
    expect(pairingOf(row({ id: '' }))).toBeUndefined()
    expect(pairingOf(row())).toMatchObject({ id: 'pair-1', code: 'ABCD-EFGH' })
  })
})
