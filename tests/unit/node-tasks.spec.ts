/**
 * Node identity N6 (docs/design/node-identity.md §6, §8-8): the GitHub probe
 * and the task-pointer table. Frozen criteria with counter-examples:
 *   ① no credential / offline → the state is UNKNOWN and nothing reminds;
 *   ② a PR that merges turns its pointer `merged` (and only an open → finished
 *     change reminds);
 *   plus §5 truncation, the 64-pointer cap with archive, and a corrupt table.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { githubProbe, stateOf, type TaskState } from '../../src/node-github.ts'
import { NodeTasks, TASK_KEEP, TASKS_CONTEXT_MAX, type TaskPointer } from '../../src/node-tasks.ts'

const quiet = { warn: () => undefined }
const V = { core: 2, mutable: 5 }

function table(probe: (ref: string) => Promise<TaskState | undefined>, root = ''): { t: NodeTasks; settled: Array<[string, TaskPointer]> } {
  const settled: Array<[string, TaskPointer]> = []
  let tick = 0
  const t = new NodeTasks(root, { probe, logger: quiet, onSettled: (node, p) => { settled.push([node, p]) }, now: () => `2026-11-02T00:00:${String(tick++).padStart(2, '0')}.000Z` })
  return { t, settled }
}
const flush = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 0)) }

describe('stateOf: one issues-API body → a state', () => {
  it('maps open / merged PR / closed PR / not-planned issue / completed issue, and refuses junk', () => {
    expect(stateOf({ state: 'open' })).toBe('open')
    expect(stateOf({ state: 'closed', pull_request: { merged_at: '2026-11-02T13:15:01Z' } })).toBe('merged')
    expect(stateOf({ state: 'closed', pull_request: { merged_at: null } })).toBe('closed')
    expect(stateOf({ state: 'closed', state_reason: 'not_planned' })).toBe('declined')
    expect(stateOf({ state: 'closed', state_reason: 'completed' })).toBe('closed')
    for (const junk of [null, 'x', {}, { state: 'weird' }]) expect(stateOf(junk)).toBeUndefined()
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
    expect(await probe('o/r#7')).toBe('merged')
    expect(await probe('o/r#8')).toBeUndefined()
    expect(await probe('o/r#9')).toBeUndefined()
    expect(seen[0]).toBe('https://api.github.com/repos/o/r/issues/7 Bearer t0k')
  })

  it('falls back to `gh api`; gh missing or logged out is unknown; a bad ref never reaches either', async () => {
    const calls: string[] = []
    const ok = githubProbe({ env: {}, gh: async (path) => { calls.push(path); return JSON.stringify({ state: 'open' }) } })
    expect(await ok('NelsonLongxiang/dsh-open-a2a-net#160')).toBe('open')
    expect(calls).toEqual(['repos/NelsonLongxiang/dsh-open-a2a-net/issues/160'])
    const none = githubProbe({ env: {}, gh: async () => { throw new Error('gh: not logged in') } })
    expect(await none('o/r#1')).toBeUndefined()
    for (const bad of ['o/r', 'o/r#0', '../x#1', 'o/r#1; rm -rf /', '-o/r#1']) expect(await ok(bad)).toBeUndefined()
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

  it('② open → merged turns the pointer merged and reminds once; a pointer first seen finished does not remind', async () => {
    let answer: TaskState = 'open'
    const { t, settled } = table(async () => answer)
    t.track('chief', 'o/r#2', V, 'human:owner')
    await flush()
    expect(t.list('chief')[0]?.state).toBe('open')
    answer = 'merged'
    await t.checkAll()
    expect(t.list('chief')[0]?.state).toBe('merged')
    expect(settled.map(([n, p]) => `${n} ${p.ref} ${p.state}`)).toEqual(['chief o/r#2 merged'])
    // Finished pointers are not re-checked, so the reminder never repeats.
    await t.checkAll()
    expect(settled).toHaveLength(1)
    // Counter-example: tracked after it already merged → merged, no reminder.
    t.track('chief', 'o/r#3', V, 'human:owner')
    await flush()
    expect(t.list('chief').find(p => p.ref === 'o/r#3')?.state).toBe('merged')
    expect(settled).toHaveLength(1)
  })

  it('a check that cannot answer keeps the last known state and marks it unchecked', async () => {
    let answer: TaskState | undefined = 'open'
    const { t, settled } = table(async () => answer)
    t.track('chief', 'o/r#4', V, 'human:owner')
    await flush()
    answer = undefined
    await t.checkAll()
    expect(t.list('chief')[0]).toEqual(expect.objectContaining({ state: 'open', check: 'unknown' }))
    expect(t.render('chief')).toContain('open（未能核对）')
    expect(settled).toEqual([])
  })

  it('keeps the newest 64 per node and archives the rest to node-tasks-archive.jsonl', async () => {
    const root = mkdtempSync(join(tmpdir(), 'node-tasks-'))
    const { t } = table(async () => 'open', root)
    for (let i = 1; i <= TASK_KEEP + 2; i++) expect(t.track('chief', `o/r#${String(i)}`, V, 'human:owner').ok).toBe(true)
    await flush()
    expect(t.list('chief')).toHaveLength(TASK_KEEP)
    expect(t.list('chief')[0]?.ref).toBe(`o/r#${String(TASK_KEEP + 2)}`)
    const archived = readFileSync(join(root, 'node-tasks-archive.jsonl'), 'utf8').trim().split('\n').map(l => (JSON.parse(l) as { ref: string }).ref)
    expect(archived).toEqual(['o/r#1', 'o/r#2'])
    // Survives a restart.
    const again = table(async () => 'open', root).t
    expect(again.list('chief')).toHaveLength(TASK_KEEP)
  })

  it('§5: the task context lists open first and truncates at the quota with a 「另有 k 条」 tail', async () => {
    const { t } = table(async (ref) => ref.endsWith('#1') ? 'open' : 'merged')
    for (let i = 1; i <= 40; i++) t.track('chief', `NelsonLongxiang/dsh-open-a2a-net#${String(i)}`, V, 'human:owner')
    await flush()
    const text = t.render('chief')
    expect([...text].length).toBeLessThanOrEqual(TASKS_CONTEXT_MAX)
    expect(text).toMatch(/另有 \d+ 条，见 GitHub。$/)
    const firstItem = text.split('\n').find(l => l.startsWith('- '))
    expect(firstItem).toContain('open　NelsonLongxiang/dsh-open-a2a-net#1（')
    expect(t.render('nobody')).toBe('')
  })

  it('a corrupt table is kept in place and read-only; tracking answers unavailable', () => {
    const root = mkdtempSync(join(tmpdir(), 'node-tasks-'))
    writeFileSync(join(root, 'node-tasks.json'), '{ nope')
    const { t } = table(async () => 'open', root)
    expect(t.readOnly).not.toBe('')
    const r = t.track('chief', 'o/r#1', V, 'human:owner')
    expect(r.ok).toBe(false)
    expect(readFileSync(join(root, 'node-tasks.json'), 'utf8')).toBe('{ nope')
  })

  it('untrack and an archived node remove pointers; a bad ref is refused', async () => {
    const root = mkdtempSync(join(tmpdir(), 'node-tasks-'))
    const { t } = table(async () => 'open', root)
    expect(t.track('chief', 'not a ref', V, 'human:owner').ok).toBe(false)
    t.track('chief', 'o/r#1', V, 'human:owner')
    t.track('chief', 'o/r#2', V, 'human:owner')
    expect(t.untrack('chief', 'o/r#1').ok).toBe(true)
    expect(t.untrack('chief', 'o/r#1').ok).toBe(false)
    t.dropNode('chief')
    expect(t.list('chief')).toEqual([])
    expect(readFileSync(join(root, 'node-tasks-archive.jsonl'), 'utf8')).toContain('"ref":"o/r#2"')
  })
})
