// @vitest-environment node
/** docs/design/superagent-owner-reporting.md: what reaches the owner, by default for every team session. */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DecisionBook } from '../../src/superagent/host/decisions.ts'

async function team() {
  const { SuperagentHost } = await import('../../src/superagent/host/index.ts')
  const { registerSuperagentTools } = await import('../../src/superagent/host/tools.ts')
  const h = new SuperagentHost({
    canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined, home: mkdtempSync(join(tmpdir(), 'sa-reporting-')), logger: { info: () => {}, warn: () => {} },
    deliverToSession: () => true, interval: () => () => {}, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
  } as never)
  expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
  h.start()
  const registered = new Map<string, { execute(a: unknown, e: unknown): Promise<Record<string, any>> }>()
  registerSuperagentTools({ tools: { register: (tool: { name: string }) => { registered.set(tool.name, tool as never) } } } as never, id => (h.roleOf(id) !== undefined ? h : undefined))
  const call = async (name: string, as: string, args: Record<string, unknown>) => await registered.get(name)!.execute(args, { agent: { id: as }, signal: new AbortController().signal })
  return { h, call }
}

describe('a decision card the owner gets (R3, R5)', () => {
  it('needs a reason; once decided, the same question gets the decision back instead of a new card', async () => {
    const { h, call } = await team()
    const card = { question: '先发 preview 还是等回归？', options: ['先发', '等回归'], recommended: '先发', level: 'P1' }
    // The schema requires it, so a call without one never reaches the tool; a blank one is refused by the tool.
    await expect(call('superagent_decision_propose', 'session-r', card)).rejects.toThrow(/reason/)
    expect(await call('superagent_decision_propose', 'session-r', { ...card, reason: '   ' })).toMatchObject({ ok: false, code: 'reason' })
    const raised = await call('superagent_decision_propose', 'session-r', { ...card, reason: '修复已验收，回归另跑' })
    expect(raised).toMatchObject({ ok: true })
    expect(h.decide(String(raised.id), 'choose', '等回归')).toMatchObject({ ok: true })
    const again = await call('superagent_decision_propose', 'session-r', { ...card, reason: '再问一次' })
    expect(again).toMatchObject({ ok: false, code: 'decided' })
    expect(String(again.error)).toContain('等回归')
    // A different question is a new card.
    expect(await call('superagent_decision_propose', 'session-r', { ...card, question: '回归跑完后发哪个版本号？', reason: 'r' })).toMatchObject({ ok: true })
    await h.stop()
  })

  it('a health reminder whose problem comes back may be raised again: R5 covers only the router\'s and observers\' recommendations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sa-reporting-book-'))
    const b = new DecisionBook(join(dir, 'decisions.json'), () => true, () => Date.parse('2026-11-11T00:00:00Z'))
    const spec = { level: 'P2' as const, options: ['知道了', '查一下'], recommended: '知道了' }
    const first = b.propose({ source: 'health', by: 'health:x', question: '队列积压', spec, at: '2026-11-11T00:00:00Z' })
    expect(first.ok).toBe(true)
    b.decide((first as { id: string }).id, { at: '2026-11-11T00:01:00Z', text: '决定：知道了' }, b.get((first as { id: string }).id)!)
    expect(b.propose({ source: 'health', by: 'health:x', question: '队列积压', spec, at: '2026-11-11T01:00:00Z' })).toMatchObject({ ok: true })
  })
})

describe('the norms are in every team persona (R1, R2, R4, R6, R7)', () => {
  it('the router, members and observers carry them, so no session needs a rule of its own for them', () => {
    const layer = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const preset = (id: string) => layer.slice(layer.indexOf(`- id: ${id}-preset`)).split(/\n    - id: superagent-/)[0]!
    for (const id of ['superagent-router', 'superagent-member', 'superagent-observer']) {
      const text = preset(id)
      expect(text, id).toContain('only an executable proposal or a decision card, never an open question')
      expect(text, id).toContain('says whether it is proposed, authorized or done')
      expect(text, id).toContain('not by hash ids')
      expect(text, id).toMatch(/A decision the owner made is final/)
      expect(text, id).toContain('Report progress only when it changes an action or a decision')
    }
    expect(preset('superagent-router')).toContain('relay it with superagent_reply')
    for (const id of ['superagent-member', 'superagent-observer']) expect(preset(id)).toContain('prose in a report does not become a question')
  })
})
