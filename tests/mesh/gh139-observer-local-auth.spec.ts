// @vitest-environment node
/**
 * Review of PR #142: an outbound LOCAL row now carries an in-process auth
 * record (local-exempt). The S6 observer re-judges every auth-bearing row
 * with callerAdmission (the WIRE rule), so the first allowlist change after
 * an agent-less async local route reports the caller's own row as affected.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { bootNode, postJson, runContext, tmpHome } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const ID = 'session-0123456789abcdef'
const state = async (url: string): Promise<Record<string, any>> => await globalThis.fetch(`${url}/__dsh_a2a/state`).then(async r => await r.json())

describe('r142 S6 observer vs outbound local auth', () => {
  for (const scope of [true, false]) {
    it(`scope=${String(scope)}: an unrelated allowlist change does not report this host's own outbound local row`, async () => {
      const A = await bootNode({ name: 'A', session: 'mesh-r142', team: 'dsh', sessionNodes: true, teamScopeRouting: scope, settlementAuth: 'observe', home: tmpHome(), reply: () => '' } as never)
      try {
        expect((await postJson(A.baseUrl, '/__dsh_a2a/join', { id: ID })).status).toBe(200)
        ;(A.agents.agent as any).steer = (p: unknown) => { A.steered.push(p) }
        // Agent-less (host/workbench) async route to the joined session: a local outbound row.
        const t = await A.ctx.tools.get('a2a_route')!.execute({ team: 'dsh/01234567', message: 'work', async: true }, runContext()) as Record<string, any>
        expect(t.ok, JSON.stringify(t)).toBe(true)
        const row = (await state(A.baseUrl)).tasks.find((r: any) => r.taskId === t.task_id)
        expect(row?.auth?.admission_rule, JSON.stringify(row)).toBe('local-exempt')
        // An unrelated operator act moves the allowlist version.
        await postJson(A.baseUrl, '/__dsh_a2a/canvas', { action: 'create', name: 'unrelated' })
        const s = await state(A.baseUrl)
        const affected = (s.authorization?.affected ?? []).flatMap((e: any) => e.tasks ?? [])
        expect(affected.filter((x: any) => x.taskId === t.task_id), JSON.stringify(affected)).toEqual([])
      } finally { await A.dispose() }
    }, 60_000)
  }
})
