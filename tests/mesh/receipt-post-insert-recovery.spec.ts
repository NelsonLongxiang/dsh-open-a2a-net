/** PR708 reviewer R2: recover a receipt already in the session after the settlement commit fails. */
import { it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootNode, reservePort, runContext } from './harness.ts'
const fault = vi.hoisted(() => ({ file: '', task: '', fail: false, hits: 0 }))
vi.mock('../../src/task-ledger-persistence.ts', async original => {
  const actual = await original<typeof import('../../src/task-ledger-persistence.ts')>()
  return { ...actual, writeTaskLedger: (file: string, bytes: string) => {
    if (fault.fail && file === fault.file && JSON.parse(bytes).archived?.some((row: any) => row.taskId === fault.task && row.endedBy === 'receipt')) { fault.hits++; throw Object.assign(Error('transient post-insertion settlement disk failure'), { code: 'EACCES' }) }
    return actual.writeTaskLedger(file, bytes)
  } }
})
afterEach(() => { fault.fail = false; fault.file = ''; fault.task = ''; fault.hits = 0; vi.restoreAllMocks() })
const nativeFetch = globalThis.fetch.bind(globalThis)
it('finishes the same original receipt after insertion succeeded but settlement persistence failed, without a second insertion', async () => {
  const pa = await reservePort(), pb = await reservePort(), au = 'http://127.0.0.1:' + pa, bu = 'http://127.0.0.1:' + pb
  const a = await bootNode({ name: 'post-insert-A', session: 'post-insert-A', team: 'alpha', port: pa, peers: [bu], sessionNodes: true, teamScopeRouting: false, silent: true, settlementAuth: 'enforce', asyncNudgeDelayMs: 86_400_000 })
  const b = await bootNode({ name: 'post-insert-B', session: 'post-insert-B', team: 'beta', port: pb, peers: [au], sessionNodes: true, teamScopeRouting: false, silent: true, settlementAuth: 'enforce', asyncNudgeDelayMs: 86_400_000 })
  const state = (url: string) => nativeFetch(url + '/__dsh_a2a/state').then(r => r.json()) as Promise<any>
  let clock: ReturnType<typeof vi.spyOn> | undefined
  let directPosts = 0, queries = 0
  const receiptReplies: any[] = []
  try {
    for (const n of [a, b]) await nativeFetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: String(n.agents.agent!.id) }) })
    const sent = await a.ctx.tools.get('a2a_route')!.execute({ team: 'beta/01234567', message: 'one original job', async: true }, runContext(a.agents.agent)) as any
    expect(sent.ok).toBe(true)
    const task = sent.task_id, text = '[A2A receipt] task ' + task + ' full post-insertion result'
    fault.file = join(a.home, 'a2a/tasks.json'); fault.task = task; fault.fail = true
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url) === au + '/a2a/query') queries++
      const response = await nativeFetch(url, init)
      if (String(url) === au + '/a2a/direct' && init?.method === 'POST' && String(init.body).includes(text)) { directPosts++; receiptReplies.push(await response.clone().json()) }
      return response
    })
    const first = await b.ctx.tools.get('a2a_route')!.execute({ team: 'alpha/01234567', message: text, async: true }, runContext(b.agents.agent)) as any
    expect(first.ok).toBe(false)
    expect(fault.hits).toBeGreaterThan(0)
    expect(receiptReplies[0]).toMatchObject({ code: -32011, acceptance: 'unknown' })
    expect(a.steered.filter(m => JSON.stringify(m).includes(text))).toHaveLength(1)
    const durable = JSON.parse(readFileSync(fault.file, 'utf8'))
    expect(['enqueued', 'claimed']).toContain(durable.taskDeliveries.find((row: any) => row.taskId === first.task_id)?.state) // A fixture may immediately consume the durably inserted occurrence.
    expect(durable.tasks.some((row: any) => row.taskId === task)).toBe(true)
    fault.fail = false // Exactly the transient fault has recovered; lane/session/key and authored text are unchanged.
    const kept = JSON.parse(readFileSync(join(b.home, 'a2a/tasks.json'), 'utf8')).receiptOutbox.find((row: any) => row.taskId === task)
    clock = vi.spyOn(Date, 'now').mockReturnValue(kept.nextAt + 1)
    const second = await b.ctx.tools.get('a2a_route')!.execute({ team: 'alpha/01234567', message: text, async: true }, runContext(b.agents.agent)) as any
    const caller = await state(au), receiver = await state(bu)
    const diagnostic = { firstOk: first.ok, secondOk: second.ok, faultHits: fault.hits, originalCallerPending: caller.tasks.some((row: any) => row.taskId === task), originalCallerArchived: caller.archived.some((row: any) => row.taskId === task), receiverPending: receiver.tasks.some((row: any) => row.taskId === task), receiptMessages: a.steered.filter(m => JSON.stringify(m).includes(text)).length, directPosts, queries, retainedPhase: kept.phase }
    expect(second.ok, JSON.stringify({ requirement: 'recover durable already-inserted receipt and settle original debt without repost', ...diagnostic })).toBe(true)
    expect(diagnostic.receiptMessages).toBe(1)
    expect(diagnostic.originalCallerArchived).toBe(true)
    expect(diagnostic.receiverPending).toBe(false)
  } finally { fault.fail = false; clock?.mockRestore(); vi.restoreAllMocks(); await b.dispose(); await a.dispose() }
})

/** Boot A/B, route one original A→B, and return B's receipt while A's settlement write fails after insertion. */
async function postInsertFailure(keepFault = false) {
  const pa = await reservePort(), pb = await reservePort(), au = 'http://127.0.0.1:' + pa, bu = 'http://127.0.0.1:' + pb
  const opts = (name: string, team: string, port: number, peers: string[]) => ({ name, session: name, team, port, peers, sessionNodes: true, teamScopeRouting: false, silent: true, settlementAuth: 'enforce' as const, asyncNudgeDelayMs: 86_400_000 })
  const a = await bootNode(opts('post-insert-A', 'alpha', pa, [bu]))
  const b = await bootNode(opts('post-insert-B', 'beta', pb, [au]))
  for (const n of [a, b]) await nativeFetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: String(n.agents.agent!.id) }) })
  const sent = await a.ctx.tools.get('a2a_route')!.execute({ team: 'beta/01234567', message: 'one original job', async: true }, runContext(a.agents.agent)) as any
  const task = sent.task_id, text = '[A2A receipt] task ' + task + ' full post-insertion result'
  fault.file = join(a.home, 'a2a/tasks.json'); fault.task = task; fault.fail = true
  const first = await b.ctx.tools.get('a2a_route')!.execute({ team: 'alpha/01234567', message: text, async: true }, runContext(b.agents.agent)) as any
  fault.fail = keepFault
  const journal = JSON.parse(readFileSync(join(a.home, 'a2a/cli-deposits.json'), 'utf8')).receiptCommits.find((r: any) => r.transportId === first.task_id)
  return { a, b, au, pa, task, text, first, journal }
}
const archivedAs = async (url: string, task: string) => ((await nativeFetch(url + '/__dsh_a2a/state').then(r => r.json())) as any).archived.find((row: any) => row.taskId === task)?.endedBy

it('the recovery scan settles a journaled session receipt after a restart, without inserting it again', async () => {
  let s: Awaited<ReturnType<typeof postInsertFailure>> | undefined, again: Awaited<ReturnType<typeof bootNode>> | undefined
  try {
    s = await postInsertFailure()
    expect(s.first.ok).toBe(false)
    expect(s.journal).toMatchObject({ phase: 'pending', targetKey: expect.stringMatching(/^session:/) })
    expect(s.a.steered.filter(m => JSON.stringify(m).includes(s!.text))).toHaveLength(1)
    const home = s.a.home
    await s.a.dispose()
    again = await bootNode({ name: 'post-insert-A', session: 'post-insert-A', team: 'alpha', port: s.pa, peers: [s.b.baseUrl], sessionNodes: true, teamScopeRouting: false, silent: true, settlementAuth: 'enforce', asyncNudgeDelayMs: 86_400_000, home })
    await vi.waitFor(async () => expect(await archivedAs(s!.au, s!.task)).toBe('receipt'), { timeout: 5000 })
    expect(again.steered.filter(m => JSON.stringify(m).includes(s!.text))).toHaveLength(0)
    const answer = await nativeFetch(s.au + '/a2a/query', { method: 'POST', body: JSON.stringify({ task_id: s.first.task_id, fingerprint: s.journal.fingerprint }) }).then(r => r.json()) as any
    expect(answer).toMatchObject({ found: true, status: 'completed', receipt_delivery: 'delivered' })
  } finally { fault.fail = false; await s?.b.dispose(); await again?.dispose() }
})

it('a journaled session receipt never settles an original that was cancelled meanwhile', async () => {
  let s: Awaited<ReturnType<typeof postInsertFailure>> | undefined
  try {
    // The store keeps failing so the scan cannot settle first; cancel the original, then let storage recover.
    s = await postInsertFailure(true)
    expect(s.journal?.phase).toBe('pending')
    const cancel = await nativeFetch(s.au + '/__dsh_a2a/tasks/cancel', { method: 'POST', body: JSON.stringify({ task_id: s.task }) }).then(r => r.json()) as any
    expect(cancel).toMatchObject({ outcome: 'cleared' })
    fault.fail = false
    const answer = await nativeFetch(s.au + '/a2a/query', { method: 'POST', body: JSON.stringify({ task_id: s.first.task_id, fingerprint: s.journal.fingerprint }) }).then(r => r.json()) as any
    expect(answer).toMatchObject({ found: true, status: 'completed', receipt_delivery: 'refused' })
    expect(await archivedAs(s.au, s.task)).toBe('cancelled')
    expect(s.a.steered.filter(m => JSON.stringify(m).includes(s!.text))).toHaveLength(1)
  } finally { fault.fail = false; await s?.b.dispose(); await s?.a.dispose() }
})
