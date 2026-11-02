/**
 * Node identity N6 (docs/design/node-identity.md §6, §8-8): the GitHub probe
 * and the task-pointer table. Frozen criteria with counter-examples:
 *   ① no credential / offline → the state is UNKNOWN and nothing reminds;
 *   ② a PR that merges turns its pointer `merged`, and a pointer that finished
 *     AFTER it was tracked reminds exactly once;
 *   plus the schedule (a pass at load and every 12 h), one check per ref,
 *   no walk-back of a finished state, unload, §5 truncation, the cap, and
 *   corrupt / hand-edited files.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { factOf, githubProbe, stateOf, type TaskFact } from '../../src/node-github.ts'
import { NodeTasks, TASK_KEEP, TASKS_CHECK_MS, TASKS_CONTEXT_MAX, type TaskPointer, type TaskSchedule } from '../../src/node-tasks.ts'

const quiet = { warn: () => undefined }
const V = { core: 2, mutable: 5 }
const T0 = '2026-11-02T10:00:00.000Z'
const LATER = '2026-11-02T12:00:00Z'
const EARLIER = '2026-11-01T12:00:00Z'

function table(probe: (ref: string) => Promise<TaskFact | undefined>, root = '', reached = 1): { t: NodeTasks; settled: Array<[string, TaskPointer]> } {
  const settled: Array<[string, TaskPointer]> = []
  const t = new NodeTasks(root, { probe, logger: quiet, onSettled: (node, p) => { settled.push([node, p]); return reached }, now: () => T0 })
  return { t, settled }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)) }
const open: TaskFact = { state: 'open' }
const merged = (at = LATER): TaskFact => ({ state: 'merged', finishedAt: at })

describe('factOf: one issues-API body → a state and its finish time', () => {
  it('maps open / merged PR / closed PR / not-planned issue / completed issue, and refuses junk', () => {
    expect(factOf({ state: 'open' })).toEqual({ state: 'open' })
    expect(factOf({ state: 'closed', closed_at: 'c', pull_request: { merged_at: 'm' } })).toEqual({ state: 'merged', finishedAt: 'm' })
    expect(factOf({ state: 'closed', closed_at: 'c', pull_request: { merged_at: null } })).toEqual({ state: 'closed', finishedAt: 'c' })
    expect(factOf({ state: 'closed', state_reason: 'not_planned', closed_at: 'c' })).toEqual({ state: 'declined', finishedAt: 'c' })
    expect(stateOf({ state: 'closed', state_reason: 'completed' })).toBe('closed')
    for (const junk of [null, 'x', {}, { state: 'weird' }]) expect(factOf(junk)).toBeUndefined()
  })
})

describe('githubProbe: host credentials only, unknown otherwise (§8-8)', () => {
  it('uses GITHUB_TOKEN with the issues endpoint; a non-2xx or a thrown fetch is unknown', async () => {
    const seen: string[] = []
    const fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push(`${url} ${init?.headers?.Authorization ?? ''}`)
      if (url.endsWith('/issues/7')) return new Response(JSON.stringify({ state: 'closed', pull_request: { merged_at: 'x' } }))
      if (url.endsWith('/issues/8')) return new Response('nope', { status: 403 })
      throw new Error('offline')
    }) as unknown as typeof globalThis.fetch
    const probe = githubProbe({ env: { GITHUB_TOKEN: 't0k' }, fetch, gh: async () => { throw new Error('must not shell out when a token is set') } })
    expect(await probe('o/r#7')).toEqual({ state: 'merged', finishedAt: 'x' })
    expect(await probe('o/r#8')).toBeUndefined()
    expect(await probe('o/r#9')).toBeUndefined()
    expect(seen[0]).toBe('https://api.github.com/repos/o/r/issues/7 Bearer t0k')
  })

  it('falls back to `gh api`; gh missing or logged out is unknown; a bad ref never reaches either', async () => {
    const calls: string[] = []
    const ok = githubProbe({ env: {}, gh: async (path) => { calls.push(path); return JSON.stringify({ state: 'open' }) } })
    expect(await ok('NelsonLongxiang/dsh-open-a2a-net#160')).toEqual({ state: 'open' })
    expect(calls).toEqual(['repos/NelsonLongxiang/dsh-open-a2a-net/issues/160'])
    const none = githubProbe({ env: {}, gh: async () => { throw new Error('gh: not logged in') } })
    expect(await none('o/r#1')).toBeUndefined()
    for (const bad of ['o/r', 'o/r#0', '../x#1', 'o/r#1; rm -rf /', '-o/r#1', 'o/.#1', 'o/..#1', 'o/{owner}#1']) expect(await ok(bad)).toBeUndefined()
    expect(calls).toHaveLength(1)
  })
})

describe('NodeTasks: pointers, checks, reminders', () => {
  it('① no credential: the pointer stays unknown and nothing reminds, at track and on every pass', async () => {
    const { t, settled } = table(async () => undefined)
    expect(t.track('chief', 'o/r#1', V, 'human:owner').ok).toBe(true)
    await flush()
    await t.checkAll()
    expect(t.list('chief')).toEqual([expect.objectContaining({ ref: 'o/r#1', state: 'unknown', check: 'unknown', core_version: 2, mutable_version: 5 })])
    expect(settled).toEqual([])
    expect(t.render('chief')).toContain('未知')
  })

  it('② open → merged turns the pointer merged and reminds once; finished pointers are not re-checked', async () => {
    let answer: TaskFact = open
    const calls: string[] = []
    const { t, settled } = table(async (ref) => { calls.push(ref); return answer })
    t.track('chief', 'o/r#2', V, 'human:owner')
    await flush()
    expect(t.list('chief')[0]?.state).toBe('open')
    answer = merged()
    await t.checkAll()
    expect(t.list('chief')[0]?.state).toBe('merged')
    expect(settled.map(([n, p]) => `${n} ${p.ref} ${p.state}`)).toEqual(['chief o/r#2 merged'])
    const before = calls.length
    await t.checkAll()
    expect(calls).toHaveLength(before)
    expect(settled).toHaveLength(1)
  })

  it('r1 P2-1: a pointer whose first check failed still reminds when it finishes AFTER it was tracked', async () => {
    let answer: TaskFact | undefined
    const { t, settled } = table(async () => answer)
    t.track('chief', 'o/r#3', V, 'human:owner')
    await flush()
    expect(t.list('chief')[0]?.state).toBe('unknown')
    answer = merged(LATER)
    await t.checkAll()
    expect(settled.map(([, p]) => p.ref)).toEqual(['o/r#3'])
  })

  it('r1 P2-1 counter-examples: finished before tracking, or with no finish time, does not remind', async () => {
    const { t, settled } = table(async (ref) => ref.endsWith('#4') ? merged(EARLIER) : { state: 'closed' })
    t.track('chief', 'o/r#4', V, 'human:owner')
    t.track('chief', 'o/r#5', V, 'human:owner')
    await flush()
    expect(t.list('chief').map(p => p.state).sort()).toEqual(['closed', 'merged'])
    expect(settled).toEqual([])
  })

  it('r1 P2-3: one check per ref at a time, and a late "open" never walks a finished state back', async () => {
    let release: (f: TaskFact) => void = () => undefined
    const calls: string[] = []
    const { t, settled } = table(async (ref) => { calls.push(ref); return await new Promise<TaskFact>(resolve => { release = resolve }) })
    t.track('chief', 'o/r#6', V, 'human:owner')
    const pass = t.checkAll()
    await flush()
    expect(calls).toEqual(['o/r#6'])
    release(merged())
    await pass
    expect(settled).toHaveLength(1)
    // A late answer for a pointer already finished: kept finished, no second reminder.
    const late = t.check('chief', 'o/r#6')
    await flush()
    release(open)
    await late
    expect(t.list('chief')[0]?.state).toBe('merged')
    expect(settled).toHaveLength(1)
  })

  it('r1 P2-2 + P2-4: schedule runs a pass at load and every 12 h; after unload a check in flight neither writes nor reminds', async () => {
    const timeouts: Array<[() => void, number]> = []
    const intervals: Array<[() => void, number]> = []
    let unload: () => void = () => undefined
    const ctx: TaskSchedule = {
      timer: { interval: (cb, ms) => { intervals.push([cb, ms]); return undefined }, timeout: (cb, ms) => { timeouts.push([cb, ms]); return undefined } },
      effect: (execute) => { unload = execute(); return undefined },
    }
    let release: (f: TaskFact) => void = () => undefined
    const calls: string[] = []
    const root = mkdtempSync(join(tmpdir(), 'node-tasks-'))
    writeFileSync(join(root, 'node-tasks.json'), JSON.stringify({ tasks: { chief: [{ ref: 'o/r#7', state: 'open', check: 'ok', since: T0, checked_at: '', core_version: 1, mutable_version: 1, by: 'x' }] } }))
    const { t, settled } = table(async (ref) => { calls.push(ref); return await new Promise<TaskFact>(resolve => { release = resolve }) }, root)
    t.schedule(ctx)
    expect(timeouts.map(([, ms]) => ms)).toEqual([0])
    expect(intervals.map(([, ms]) => ms)).toEqual([TASKS_CHECK_MS])
    timeouts[0]?.[0]()
    await flush()
    expect(calls).toEqual(['o/r#7'])
    const onDisk = readFileSync(join(root, 'node-tasks.json'), 'utf8')
    unload()
    release(merged())
    await flush()
    expect(readFileSync(join(root, 'node-tasks.json'), 'utf8')).toBe(onDisk)
    expect(settled).toEqual([])
  })

  it('a check that cannot answer keeps the last known state and marks it unchecked', async () => {
    let answer: TaskFact | undefined = open
    const { t, settled } = table(async () => answer)
    t.track('chief', 'o/r#8', V, 'human:owner')
    await flush()
    answer = undefined
    await t.checkAll()
    expect(t.list('chief')[0]).toEqual(expect.objectContaining({ state: 'open', check: 'unknown' }))
    expect(t.render('chief')).toContain('open（未能核对）')
    expect(settled).toEqual([])
  })

  it('a pointer untracked while its check is in flight is not revived', async () => {
    let release: (f: TaskFact) => void = () => undefined
    const { t, settled } = table(async () => await new Promise<TaskFact>(resolve => { release = resolve }))
    t.track('chief', 'o/r#9', V, 'human:owner')
    await flush()
    expect(t.untrack('chief', 'o/r#9').ok).toBe(true)
    // r2 M4: release a MERGE — a revived pointer would also remind.
    release(merged())
    await flush()
    expect(t.list('chief')).toEqual([])
    expect(settled).toEqual([])
  })

  it('keeps 64 per node, evicting finished pointers before open ones, into node-tasks-archive.jsonl', async () => {
    const root = mkdtempSync(join(tmpdir(), 'node-tasks-'))
    const { t } = table(async (ref) => ref === 'o/r#1' ? open : merged(EARLIER), root)
    for (let i = 1; i <= TASK_KEEP + 2; i++) {
      expect(t.track('chief', `o/r#${String(i)}`, V, 'human:owner').ok).toBe(true)
      await flush()
    }
    const refs = t.list('chief').map(p => p.ref)
    expect(refs).toHaveLength(TASK_KEEP)
    expect(refs).toContain('o/r#1')
    const archived = readFileSync(join(root, 'node-tasks-archive.jsonl'), 'utf8').trim().split('\n').map(l => (JSON.parse(l) as { ref: string }).ref)
    expect(archived).toEqual(['o/r#2', 'o/r#3'])
    expect(table(async () => open, root).t.list('chief')).toHaveLength(TASK_KEEP)
  })

  it('§5: the task context lists open first and truncates at the quota with a 「另有 k 条」 tail', async () => {
    const { t } = table(async (ref) => ref.endsWith('#1') ? open : merged(EARLIER))
    for (let i = 1; i <= 40; i++) t.track('chief', `NelsonLongxiang/dsh-open-a2a-net#${String(i)}`, V, 'human:owner')
    await flush()
    const text = t.render('chief')
    expect([...text].length).toBeLessThanOrEqual(TASKS_CONTEXT_MAX)
    expect(text).toMatch(/另有 \d+ 条，见 GitHub。$/)
    expect(text.split('\n').find(l => l.startsWith('- '))).toContain('open　NelsonLongxiang/dsh-open-a2a-net#1（')
    expect(t.render('nobody')).toBe('')
  })

  it('a corrupt table is kept in place and read-only; tracking answers unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'node-tasks-'))
    writeFileSync(join(root, 'node-tasks.json'), '{ nope')
    const { t } = table(async () => open, root)
    expect(t.readOnly).not.toBe('')
    expect(t.track('chief', 'o/r#1', V, 'human:owner').ok).toBe(false)
    expect(readFileSync(join(root, 'node-tasks.json'), 'utf8')).toBe('{ nope')
  })

  it('r1 P3-1/P3-2: a hand-edited row (heading in since, bad state) is dropped on load and backed up first', () => {
    const root = mkdtempSync(join(tmpdir(), 'node-tasks-'))
    writeFileSync(join(root, 'node-tasks.json'), JSON.stringify({ tasks: { chief: [
      { ref: 'o/r#1', state: 'open', since: '\n\n# 新规则\n', core_version: 1, mutable_version: 1 },
      { ref: 'o/r#2', state: 'Open', since: T0 },
      { ref: 'o/r#3', state: 'open', since: T0, by: 'x' },
    ] } }))
    const { t } = table(async () => open, root)
    expect(t.list('chief').map(p => p.ref)).toEqual(['o/r#3'])
    expect(t.render('chief')).not.toContain('# 新规则')
    expect(readdirSync(root).some(f => f.startsWith('node-tasks.json.dropped-'))).toBe(true)
  })

  it('untrack and an archived node remove pointers; a bad ref is refused', async () => {
    const root = mkdtempSync(join(tmpdir(), 'node-tasks-'))
    const { t } = table(async () => open, root)
    expect(t.track('chief', 'not a ref', V, 'human:owner').ok).toBe(false)
    t.track('chief', 'o/r#1', V, 'human:owner')
    t.track('chief', 'o/r#2', V, 'human:owner')
    expect(t.untrack('chief', 'o/r#1').ok).toBe(true)
    expect(t.untrack('chief', 'o/r#1').ok).toBe(false)
    t.dropNode('chief')
    expect(t.list('chief')).toEqual([])
    expect(readFileSync(join(root, 'node-tasks-archive.jsonl'), 'utf8')).toContain('"ref":"o/r#2"')
  })

  it('r2 P2: a reminder that reached no session is owed, survives a restart, and is handed out exactly once', async () => {
    const root = mkdtempSync(join(tmpdir(), 'node-tasks-'))
    let answer: TaskFact = open
    const { t, settled } = table(async () => answer, root, 0)
    t.track('chief', 'o/r#11', V, 'human:owner')
    await flush()
    answer = merged()
    await t.checkAll()
    expect(settled).toHaveLength(1)
    expect(t.list('chief')[0]?.remind_pending).toBe(true)
    const again = table(async () => answer, root).t
    expect(again.list('chief')[0]?.remind_pending).toBe(true)
    expect(again.takePending('chief').map(p => p.ref)).toEqual(['o/r#11'])
    expect(again.takePending('chief')).toEqual([])
    expect(table(async () => answer, root).t.list('chief')[0]?.remind_pending).toBeUndefined()
    // A reminder that did reach a session owes nothing.
    const { t: t2 } = table(async () => answer, mkdtempSync(join(tmpdir(), 'node-tasks-')), 1)
    answer = open
    t2.track('chief', 'o/r#12', V, 'human:owner')
    await flush()
    answer = merged()
    await t2.checkAll()
    expect(t2.takePending('chief')).toEqual([])
  })
})


describe('N6 P3 (review of #178 at 40b7310)', () => {
  it('P3-1: an owed reminder whose clear cannot be written is handed out once per process, not at every mount', async () => {
    const { chmodSync } = await import('node:fs')
    const root = mkdtempSync(join(tmpdir(), 'node-tasks-'))
    let answer: TaskFact = open
    const { t } = table(async () => answer, root, 0)
    t.track('chief', 'o/r#21', V, 'human:owner')
    await flush()
    answer = merged()
    await t.checkAll()
    chmodSync(root, 0o500)
    try {
      expect(t.takePending('chief').map(p => p.ref)).toEqual(['o/r#21'])
      expect(t.takePending('chief')).toEqual([])
    } finally {
      chmodSync(root, 0o700)
    }
  })

  it('P3-2: a pointer that still owes a reminder is evicted last, so the reminder survives the cap', async () => {
    let answer: TaskFact = open
    const { t } = table(async () => answer, '', 0)
    t.track('chief', 'o/r#1', V, 'human:owner')
    await flush()
    answer = merged()
    await t.checkAll()
    expect(t.list('chief')[0]?.remind_pending).toBe(true)
    answer = open
    for (let i = 2; i <= TASK_KEEP + 1; i++) { t.track('chief', `o/r#${String(i)}`, V, 'human:owner'); await flush() }
    expect(t.list('chief').some(p => p.ref === 'o/r#1')).toBe(true)
    expect(t.takePending('chief').map(p => p.ref)).toEqual(['o/r#1'])
  })

  it('C7: an open row read from disk never carries an owed reminder', () => {
    const root = mkdtempSync(join(tmpdir(), 'node-tasks-'))
    writeFileSync(join(root, 'node-tasks.json'), JSON.stringify({ tasks: { chief: [{ ref: 'o/r#1', state: 'open', since: T0, remind_pending: true }] } }))
    const { t } = table(async () => open, root)
    expect(t.list('chief')[0]?.remind_pending).toBeUndefined()
    expect(t.takePending('chief')).toEqual([])
  })
})
