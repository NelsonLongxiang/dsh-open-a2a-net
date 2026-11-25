// @vitest-environment jsdom
/** #888 D5: the team page's automatic approval section; owner 2026-11-24 defaults; only what changed is sent. */
import { describe, expect, it } from 'vitest'
import { buildTeamFields } from '../src/wb-superagent-settings.ts'

const base = { members: [], remoteMembers: [], allowed: {}, sources: { workbench: true, a2a: false } }
const mount = (s: Record<string, unknown>) => {
  const fields = buildTeamFields(s as never, id => id, () => {})
  const root = document.createElement('div'); root.append(...fields.nodes); document.body.replaceChildren(root)
  return { fields, q: <T extends HTMLInputElement>(label: string) => root.querySelector(`[aria-label="${label}"]`) as T }
}

describe('the automatic approval section', () => {
  it('starts off with P3, 30 minutes and no sources, and sends nothing untouched', () => {
    const { fields, q } = mount(base)
    expect(q('打开决策卡自动采纳').checked).toBe(false)
    expect(q('包括 P3').checked).toBe(true)
    expect(q('包括 P2').checked).toBe(false)
    expect(q('总工提的卡').checked).toBe(false)
    expect(q('观察者提的卡').checked).toBe(false)
    expect(q('等多少分钟没人处理再自动采纳（15–1440）').value).toBe('30')
    expect(fields.patch()).toEqual({ patch: {} })
  })
  it('turning it on sends the whole rule (never an armedAt)', () => {
    const { fields, q } = mount(base)
    q('打开决策卡自动采纳').checked = true
    q('总工提的卡').checked = true
    expect(fields.patch()).toEqual({ patch: { autoApprove: { enabled: true, levels: ['P3'], sources: ['router'], afterMinutes: 30, perHour: 10 } } })
  })
  it('an existing rule with a stamp is untouched until changed; out-of-range numbers are refused', () => {
    const { fields, q } = mount({ ...base, autoApprove: { enabled: true, levels: ['P3'], sources: ['observer'], afterMinutes: 60, perHour: 5, armedAt: '2026-11-24T09:00:00.000Z' } })
    expect(fields.patch()).toEqual({ patch: {} })
    q('等多少分钟没人处理再自动采纳（15–1440）').value = '10'
    expect(fields.patch()).toMatchObject({ error: expect.stringContaining('15–1440') })
    q('等多少分钟没人处理再自动采纳（15–1440）').value = '60'
    q('每小时最多自动采纳几张（1–60）').value = '0'
    expect(fields.patch()).toMatchObject({ error: expect.stringContaining('1–60') })
  })
})
