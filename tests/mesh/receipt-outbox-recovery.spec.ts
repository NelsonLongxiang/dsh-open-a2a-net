/** #708 whole-PR review R1/R2: a retained receipt recovers on its original transport after a definite non-insertion. */
import { it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootNode, reservePort, runContext } from './harness.ts'
import { A2aClient } from '../../src/a2a-client.ts'
afterEach(() => { vi.restoreAllMocks() })
const nativeFetch = globalThis.fetch.bind(globalThis)
it('can recover the same authored receipt after an explicitly pre-connect-refused first send', async () => {
  const pa = await reservePort(), pb = await reservePort()
  const au = 'http://127.0.0.1:' + pa, bu = 'http://127.0.0.1:' + pb
  const a = await bootNode({ name: 'preconnectA', session: 'preconnectA', team: 'alpha', port: pa, peers: [bu], sessionNodes: true, teamScopeRouting: false, silent: true, asyncNudgeDelayMs: 86_400_000 })
  const b = await bootNode({ name: 'preconnectB', session: 'preconnectB', team: 'beta', port: pb, peers: [au], sessionNodes: true, teamScopeRouting: false, silent: true, asyncNudgeDelayMs: 86_400_000 })
  let unavailable = true, directAttempts = 0, nativeReturnPosts = 0, queries = 0
  const clientResults: Array<{ unknown: boolean; code: unknown }> = []
  const route = A2aClient.prototype.routeDirect
  let clock: ReturnType<typeof vi.spyOn> | undefined
  try {
    for (const n of [a, b]) await nativeFetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: String(n.agents.agent!.id) }) })
    const sent = await a.ctx.tools.get('a2a_route')!.execute({ team: 'beta/01234567', message: 'work already delivered once', async: true }, runContext(a.agents.agent)) as any
    expect(sent.ok).toBe(true)
    const task = sent.task_id, text = '[A2A receipt] task ' + task + ' original receipt result'
    vi.spyOn(A2aClient.prototype, 'routeDirect').mockImplementation(async function(this: A2aClient, ...args: Parameters<A2aClient['routeDirect']>) {
      const out = await route.apply(this, args)
      if (args[0] === au && args[2] === text) clientResults.push({ unknown: out.acceptance === 'unknown', code: out.ok ? undefined : out.code })
      return out
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url) === au + '/a2a/query') queries++
      if (String(url) === au + '/a2a/direct' && init?.method === 'POST' && String(init.body).includes(text)) {
        directAttempts++
        if (unavailable) throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })
        nativeReturnPosts++
      }
      return nativeFetch(url, init)
    })
    const first = await b.ctx.tools.get('a2a_route')!.execute({ team: 'alpha/01234567', message: text, async: true }, runContext(b.agents.agent)) as any
    expect(first.ok).toBe(false)
    expect(directAttempts).toBe(1)
    expect(nativeReturnPosts).toBe(0)
    expect(clientResults[0]?.unknown).toBe(false) // Product client recognizes the explicit pre-connect code.
    const kept = JSON.parse(readFileSync(join(b.home, 'a2a/tasks.json'), 'utf8')).receiptOutbox.find((r: any) => r.taskId === task)
    expect(kept.text).toBe(text)
    unavailable = false
    clock = vi.spyOn(Date, 'now').mockReturnValue(kept.nextAt + 1)
    const second = await b.ctx.tools.get('a2a_route')!.execute({ team: 'alpha/01234567', message: text, async: true }, runContext(b.agents.agent)) as any
    console.log('[review-receipt-preconnect] ' + JSON.stringify({ firstOk: first.ok, secondOk: second.ok, clientResults, phase: kept.phase, directAttempts, nativeReturnPosts, queries }))
    expect(second.ok, JSON.stringify({ requirement: 'definite pre-connect refusal recovers on the same original transport', firstOk: first.ok, secondOk: second.ok, clientResults, retainedPhase: kept.phase, directAttempts, nativeReturnPosts, queries })).toBe(true)
    expect(nativeReturnPosts).toBe(1)
    expect(second.task_id).toBe(first.task_id)
  } finally { clock?.mockRestore(); vi.restoreAllMocks(); await b.dispose(); await a.dispose() }
})

it('a connection reset after the request may have left stays query-only and never reposts', async () => {
  const pa = await reservePort(), pb = await reservePort()
  const au = 'http://127.0.0.1:' + pa, bu = 'http://127.0.0.1:' + pb
  const a = await bootNode({ name: 'preconnectA', session: 'preconnectA', team: 'alpha', port: pa, peers: [bu], sessionNodes: true, teamScopeRouting: false, silent: true, asyncNudgeDelayMs: 86_400_000 })
  const b = await bootNode({ name: 'preconnectB', session: 'preconnectB', team: 'beta', port: pb, peers: [au], sessionNodes: true, teamScopeRouting: false, silent: true, asyncNudgeDelayMs: 86_400_000 })
  let unavailable = true, directAttempts = 0, nativeReturnPosts = 0, queries = 0
  const clientResults: Array<{ unknown: boolean; code: unknown }> = []
  const route = A2aClient.prototype.routeDirect
  let clock: ReturnType<typeof vi.spyOn> | undefined
  try {
    for (const n of [a, b]) await nativeFetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: String(n.agents.agent!.id) }) })
    const sent = await a.ctx.tools.get('a2a_route')!.execute({ team: 'beta/01234567', message: 'work already delivered once', async: true }, runContext(a.agents.agent)) as any
    expect(sent.ok).toBe(true)
    const task = sent.task_id, text = '[A2A receipt] task ' + task + ' original receipt result'
    vi.spyOn(A2aClient.prototype, 'routeDirect').mockImplementation(async function(this: A2aClient, ...args: Parameters<A2aClient['routeDirect']>) {
      const out = await route.apply(this, args)
      if (args[0] === au && args[2] === text) clientResults.push({ unknown: out.acceptance === 'unknown', code: out.ok ? undefined : out.code })
      return out
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url) === au + '/a2a/query') queries++
      if (String(url) === au + '/a2a/direct' && init?.method === 'POST' && String(init.body).includes(text)) {
        directAttempts++
        if (unavailable) throw new TypeError('fetch failed', { cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) })
        nativeReturnPosts++
      }
      return nativeFetch(url, init)
    })
    const first = await b.ctx.tools.get('a2a_route')!.execute({ team: 'alpha/01234567', message: text, async: true }, runContext(b.agents.agent)) as any
    expect(first.ok).toBe(false)
    expect(directAttempts).toBe(1)
    expect(nativeReturnPosts).toBe(0)
    expect(clientResults[0]?.unknown).toBe(true) // A reset may follow insertion: acceptance is unknown.
    const kept = JSON.parse(readFileSync(join(b.home, 'a2a/tasks.json'), 'utf8')).receiptOutbox.find((r: any) => r.taskId === task)
    expect(kept.text).toBe(text)
    unavailable = false
    clock = vi.spyOn(Date, 'now').mockReturnValue(kept.nextAt + 1)
    const second = await b.ctx.tools.get('a2a_route')!.execute({ team: 'alpha/01234567', message: text, async: true }, runContext(b.agents.agent)) as any
    expect(second.ok).toBe(false)
    expect(nativeReturnPosts).toBe(0) // the frozen transport is only queried, never POSTed again
    expect(queries).toBeGreaterThan(0)
  } finally { clock?.mockRestore(); vi.restoreAllMocks(); await b.dispose(); await a.dispose() }
})

it('keeps the original caller debt if the receipt cannot enter the caller session at all', async () => {
  const pa = await reservePort(), pb = await reservePort()
  const au = 'http://127.0.0.1:' + pa, bu = 'http://127.0.0.1:' + pb
  const a = await bootNode({ name: 'sessionA', session: 'sessionA', team: 'alpha', port: pa, peers: [bu], sessionNodes: true, teamScopeRouting: false, silent: true, settlementAuth: 'enforce', asyncNudgeDelayMs: 86_400_000 })
  const b = await bootNode({ name: 'sessionB', session: 'sessionB', team: 'beta', port: pb, peers: [au], sessionNodes: true, teamScopeRouting: false, silent: true, settlementAuth: 'enforce', asyncNudgeDelayMs: 86_400_000 })
  const state = (base: string) => nativeFetch(base + '/__dsh_a2a/state').then(r => r.json()) as Promise<any>
  const before = a.agents.agent!.followup
  try {
    for (const n of [a, b]) await nativeFetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: String(n.agents.agent!.id) }) })
    const sent = await a.ctx.tools.get('a2a_route')!.execute({ team: 'beta/01234567', message: 'one original work', async: true }, runContext(a.agents.agent)) as any
    expect(sent.ok).toBe(true)
    await vi.waitFor(() => expect(b.steered).toHaveLength(1))
    ;(a.agents.agent as any).followup = undefined // Explicit unavailable queue capability, not an uncertain after-insertion exception.
    const text = '[A2A receipt] task ' + sent.task_id + ' full original result'
    const returned = await b.ctx.tools.get('a2a_route')!.execute({ team: 'alpha/01234567', message: text, async: true }, runContext(b.agents.agent)) as any
    expect(returned.ok).toBe(false)
    const caller = await state(au), receiver = await state(bu)
    expect(a.steered.filter(p => JSON.stringify(p).includes(text))).toHaveLength(0)
    const retained = JSON.parse(readFileSync(join(b.home, 'a2a/tasks.json'), 'utf8')).receiptOutbox.find((r: any) => r.taskId === sent.task_id)
    expect(caller.tasks.some((r: any) => r.taskId === sent.task_id)).toBe(true) // the caller's debt stays owed
    expect(caller.archived.some((r: any) => r.taskId === sent.task_id)).toBe(false)
    expect(retained.phase).not.toBe('blocked')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(retained.nextAt + 1)
    ;(a.agents.agent as any).followup = before // Restore the same session's original capability, without changing identity or authority.
    const recovered = await b.ctx.tools.get('a2a_route')!.execute({ team: 'alpha/01234567', message: text, async: true }, runContext(b.agents.agent)) as any
    const diagnostic = { returnedOk: returned.ok, recoveredOk: recovered.ok, retainedPhase: retained.phase, retainedCode: retained.code, callerPending: caller.tasks.some((r: any) => r.taskId === sent.task_id), callerArchived: caller.archived.some((r: any) => r.taskId === sent.task_id), receiverPending: receiver.tasks.some((r: any) => r.taskId === sent.task_id), deliveredReceiptMessages: a.steered.filter(p => JSON.stringify(p).includes(text)).length }
    expect(recovered.ok, JSON.stringify({ requirement: 'restoring original session capability must not leave a false-settled creditor and permanently unsendable retained receipt', ...diagnostic })).toBe(true)
    expect(diagnostic.deliveredReceiptMessages).toBe(1)
    clock.mockRestore()
  } finally { vi.restoreAllMocks(); (a.agents.agent as any).followup = before; await b.dispose(); await a.dispose() }
})
