// @vitest-environment node
/** Real apply/fiber activation on synthetic persisted state; never reads a user's session or profile. */
import { describe, expect, it, vi } from 'vitest'
// This test owns plugin activation, not the external ygl CLI lifecycle.
vi.mock('../../src/superagent/host/ygl-home.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/superagent/host/ygl-home.ts')>(),
  ensureTeamYglHome: async () => 'present', ensureTeamYglProject: async () => 'present',
  startWhenYglKnown: () => () => {},
}))
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, cleanupBeforeTempDirs } from '../temp-dirs.ts'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TimerService from '@deepseek-ai/cordis-plugin-timer'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Config, apply, inject } from '../../src/index.ts'
import { CanvasStore } from '../../src/canvas-store.ts'
import { encodePublicKey } from '../../src/card.ts'
import { qualifiedSessionMember } from '../../src/canvas-member.ts'
import { SuperagentHost } from '../../src/superagent/host/index.ts'
import { routeItem } from '../../src/superagent/host/tools.ts'
import { existsSync, readFileSync } from 'node:fs'

const ROUTER = 'session-a0000000aaaa1111', MEMBER = 'session-b1111111bbbb2222'
class Agents extends Service {
  entries: Agent[] = []
  constructor(ctx: Context) { super(ctx, 'agents') }
  roots(): Agent[] { return this.entries }
  get(id: unknown): Agent | undefined { return this.entries.find(a => a.id === id) }
}

async function persistedHome(remote: boolean, waiting = false) {
  const home = mkdtempSync(join(tmpdir(), 'sa-persisted-activation-'))
  const canvas = new CanvasStore(join(home, 'a2a', 'canvas.json'))
  expect(canvas.create('team')).toBe('team')
  canvas.addMember('team', ROUTER); canvas.addMember('team', MEMBER)
  if (remote) {
    const key = encodePublicKey(generateKeyPairSync('ed25519').publicKey)
    const ref = qualifiedSessionMember('market/1234abcd', key)!
    expect(canvas.addMember('team', ref, undefined, { ownerKey: key })).toBe(true)
  }
  // Use the normal settings writer; no production state dump or hand-edited ticket log.
  const host = new SuperagentHost({ home: join(home, 'a2a'), canvasTeam: () => ({ local: [ROUTER, MEMBER], remote: [] }), logger: { info() {}, warn() {} }, deliverToSession: () => true, interval: () => () => {} })
  expect(host.saveSettings({ canvas: 'team', router: ROUTER, sources: { a2a: false, workbench: true } }, () => true)).toMatchObject({ ok: true })
  if (waiting) {
    host.start()
    const request = host.request('synthetic waiting task') as { triggerId: string }
    const accepted = routeItem(host, { trigger_id: request.triggerId, kind: 'accept', title: 'synthetic waiting task', scope: 'fixture', reason: 'owner asked' }) as { ticket_id: string }
    await vi.waitFor(() => expect(host.executor.bindingOf(MEMBER)?.ticketId).toBe(accepted.ticket_id))
    expect(host.report(MEMBER, { state: 'waiting', summary: 'needs input', question: 'which format?' }, accepted.ticket_id)).toMatchObject({ ok: true })
    // Preserve the active binding, matching the incident; don't synthesize an idle event or finish the task.
  }
  await host.stop()
  return home
}

async function activateTwice(home: string, seeds: string[]) {
  const ctx = new Context()
  cleanupBeforeTempDirs(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(TimerService); await ctx.plugin(Agents)
  const agents = ctx.get('agents') as unknown as Agents
  // These roots are already loaded when the bundle is hot-enabled, as in the report.
  agents.entries = [ROUTER, MEMBER].map(id => ({ id: SessionId(id), session: { events: [] }, ctx: { tools: { get() { return undefined }, restrict() { return () => {} } } } }) as unknown as Agent)
  const config = Config({ dshHome: home, superagent: true, announce: false, sessionNodes: true, wakeReconcile: false, peers: seeds, referralLearning: false } as never)
  const statePath = join(home, 'a2a', 'superagent', 'state.json')
  const readState = () => existsSync(statePath) ? readFileSync(statePath, 'utf8') : undefined
  const before = readState()
  const mount = () => ctx.plugin({ name: 'a2a-persisted-activation-fixture', inject, apply: (scope: Context) => apply(scope, config) })
  const first = mount()
  await first.await()
  expect(first.state).toBe(2) // Cordis FiberState.ACTIVE is a declaration-only const enum.
  await first.dispose()
  const second = mount()
  await second.await()
  expect(second.state).toBe(2) // Cordis FiberState.ACTIVE is a declaration-only const enum.
  await second.dispose()
  expect(readState()).toBe(before)
}

describe('persisted superagent activation with already-loaded roots', () => {
  it('local-only canvas and no peer seeds can activate and re-enable', async () => {
    await activateTwice(await persistedHome(false), [])
  })
  it('a configured seed does not read cardCache before initialization during role synchronization', async () => {
    await activateTwice(await persistedHome(false), ['http://127.0.0.1:1'])
  })
  it('a confirmed remote recipient does not read cardCache before initialization during role synchronization', async () => {
    await activateTwice(await persistedHome(true), [])
  })
  it('an open waiting assignment survives activation and re-enable without clearing its state', async () => {
    await activateTwice(await persistedHome(true, true), ['http://127.0.0.1:1'])
  })
})
