// @vitest-environment node
/** #953 P1 on a real booted host: a label in the canvas file shows in the state projection and survives, and set-label needs the owner. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bootNode, tmpHome } from './harness.ts'

describe('canvas team labels on a booted host', () => {
  it('the state lists each team by its unchanged name and id, with the label only where one is set; a label in the file that breaks the rules is not shown', async () => {
    const home = tmpHome(); mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a/canvas.json'), JSON.stringify({ formatVersion: 2, revision: 1, suspendedMembers: [], teams: [{ name: 'alpha', members: [] }, { name: 'beta', members: [] }, { name: 'gamma', members: [] }], labels: { alpha: '采集队', gamma: 'dsh/66abc2cf' } }))
    const node = await bootNode({ name: 'label953', session: 'label953', team: 'dsh', sessionNodes: true, home })
    try {
      const state = await fetch(node.baseUrl + '/__dsh_a2a/state').then(r => r.json()) as { canvas: { teams: Array<{ name: string; id: string; label?: string }> } }
      const rows = Object.fromEntries(state.canvas.teams.map(t => [t.name, t]))
      expect(Object.keys(rows).sort()).toEqual(['alpha', 'beta', 'gamma'])
      expect(rows.alpha).toMatchObject({ name: 'alpha', label: '采集队' }); expect(rows.alpha!.id).toMatch(/^dsh\/canvas\/alpha@[0-9a-f]{8}$/)
      expect(rows.beta).not.toHaveProperty('label'); expect(rows.gamma).not.toHaveProperty('label')
    } finally { await node.stop?.() }
  })
  it('set-label on the real route is refused without the owner, and the file keeps its label', async () => {
    const home = tmpHome(); mkdirSync(join(home, 'a2a'), { recursive: true })
    writeFileSync(join(home, 'a2a/canvas.json'), JSON.stringify({ formatVersion: 2, revision: 1, suspendedMembers: [], teams: [{ name: 'alpha', members: [] }], labels: { alpha: '旧' } }))
    const node = await bootNode({ name: 'label953b', session: 'label953b', team: 'dsh', sessionNodes: true, home })
    try {
      const res = await fetch(node.baseUrl + '/__dsh_a2a/canvas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'set-label', name: 'alpha', label: '新' }) })
      // No browser login and no delegate on this fixture: refused (the harness has no GUI connection, so the proof answers 503, not 200).
      expect(res.status).not.toBe(200); expect((await res.json() as { ok?: boolean }).ok).toBe(false)
      expect(JSON.parse(readFileSync(join(home, 'a2a/canvas.json'), 'utf8')).labels).toEqual({ alpha: '旧' })
    } finally { await node.stop?.() }
  })
})
