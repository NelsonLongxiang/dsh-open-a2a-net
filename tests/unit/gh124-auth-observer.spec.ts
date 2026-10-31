/**
 * #124 (#114 S6): the allowlist observer — version history, the pure
 * re-judgement of unsettled tasks (basis-changed / would-revoke), the
 * peer-org recheck, and the persisted rings (round trip, corrupt file
 * dropped whole, malformed entries dropped one by one). Observe mode only.
 */
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUTH_HISTORY_CAP, AuthObserver, judgeAffected, type JudgedRow } from '../../src/auth-observer.ts'
import { buildAuthorization, type Admission, type TaskAuthorization } from '../../src/task-auth.ts'

const V1 = 'al1:1111111111111111'
const V2 = 'al1:2222222222222222'

function auth(over: { via?: 'canvas-member' | 'peer-org' | 'cli-deposit'; basis?: string[]; version?: string; caller?: string } = {}): TaskAuthorization {
  const via = over.via ?? 'canvas-member'
  return buildAuthorization(
    { ok: true, via, rule: via === 'peer-org' ? 'peer-org' : via === 'cli-deposit' ? 'cli-deposit' : 'canvas-shared', basis: over.basis ?? (via === 'cli-deposit' ? [] : ['dsh/canvas/ops']) },
    { caller: over.caller ?? 'dsh/aaaaaaaa', proof: 'legacy-window', ingress: 'wire', allowlistVersion: over.version ?? V1, target: 'dsh/bbbbbbbb', receiptTarget: 'dsh/aaaaaaaa', receivedAt: 1 },
  )
}

const row = (taskId: string, a?: TaskAuthorization): JudgedRow => ({ taskId, direction: 'inbound', ...(a !== undefined ? { auth: a } : {}) })
const pass = (rule: 'canvas-shared' | 'roster-shared' | 'peer-org' | 'cli-deposit' | 'remote-ref-samezone', basis: string[]): Admission => ({ ok: true, via: rule === 'peer-org' ? 'peer-org' : rule === 'cli-deposit' ? 'cli-deposit' : rule === 'roster-shared' ? 'joined-session' : 'canvas-member', rule, basis })
const refuse = (text: string): Admission => ({ ok: false, refusal: text })

function observerPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsh-a2a-authobs-')), 'a2a', 'auth-versions.json')
}

describe('#124 judgeAffected (pure)', () => {
  it('overlapping basis → not listed; disjoint basis → basis-changed; refused → would-revoke with the refusal text', () => {
    const rows = [row('t-same', auth()), row('t-moved', auth()), row('t-gone', auth()), row('t-legacy')]
    const verdicts: Record<string, Admission> = {
      't-same': pass('canvas-shared', ['dsh/canvas/ops', 'dsh/canvas/new']),
      't-moved': pass('roster-shared', ['dsh/team-x']),
      't-gone': refuse('caller "dsh/aaaaaaaa" declares no team membership'),
    }
    let call = 0
    const order = ['t-same', 't-moved', 't-gone']
    const affected = judgeAffected(rows, V2, () => verdicts[order[call++] as string] as Admission)
    expect(call).toBe(3) // the row without auth (pre-S2) is never judged
    expect(affected).toEqual([
      { taskId: 't-moved', direction: 'inbound', caller: 'dsh/aaaaaaaa', target: 'dsh/bbbbbbbb', verdict: 'basis-changed', reason: 'admitted by roster-shared on [dsh/team-x], was canvas-shared on [dsh/canvas/ops]' },
      { taskId: 't-gone', direction: 'inbound', caller: 'dsh/aaaaaaaa', target: 'dsh/bbbbbbbb', verdict: 'would-revoke', reason: 'caller "dsh/aaaaaaaa" declares no team membership' },
    ])
  })

  it('rows born under the current version are skipped — except peer-org rows, whose basis the version does not hash', () => {
    const judged: string[] = []
    judgeAffected([row('t-current', auth({ version: V2 })), row('t-org', auth({ via: 'peer-org', basis: ['peer-org:dsh/canvas/far'], version: V2 }))], V2, caller => {
      judged.push(caller)
      return pass('peer-org', ['peer-org:dsh/canvas/far'])
    })
    expect(judged).toHaveLength(1)
  })

  it('a basis-less rule (cli-deposit) holds when the same rule admits again', () => {
    expect(judgeAffected([row('t-cli', auth({ via: 'cli-deposit' }))], V2, () => pass('cli-deposit', []))).toEqual([])
    expect(judgeAffected([row('t-cli', auth({ via: 'cli-deposit' }))], V2, () => refuse('no node fact'))[0]?.verdict).toBe('would-revoke')
  })
})

describe('#124 AuthObserver', () => {
  const input = (version: string, rows: JudgedRow[], judge: (caller: string, target: string) => Admission, cause = 'canvas') => ({
    version, cause, inputs: () => ({ zone: 'dsh' }), rows: () => rows, judge,
  })

  it('records the first version, then an affected entry only when the version moves', () => {
    const obs = new AuthObserver('', () => 1000)
    const rows = [row('t-1', auth())]
    expect(obs.observe(input(V1, rows, () => pass('canvas-shared', ['dsh/canvas/ops']), 'boot'))).toBeUndefined()
    expect(obs.history().map(entry => entry.version)).toEqual([V1])
    // Unchanged version: nothing re-judged, no entry, no new history row.
    let judged = 0
    expect(obs.observe(input(V1, rows, () => { judged++; return refuse('x') }))).toBeUndefined()
    expect(judged).toBe(0)
    expect(obs.history()).toHaveLength(1)
    expect(obs.entries()).toEqual([])
    // Moved: the row is judged, and refused.
    const entry = obs.observe(input(V2, rows, () => refuse('caller shares no team with target')))
    expect(entry).toEqual({ at: 1000, from_version: V1, to_version: V2, cause: 'canvas', tasks: [expect.objectContaining({ taskId: 't-1', verdict: 'would-revoke', reason: 'caller shares no team with target' })] })
    expect(obs.history().map(e => e.version)).toEqual([V2, V1])
    expect(obs.entries()).toEqual([entry])
  })

  it('peer-org rows are re-judged on every read but reported only when their verdict changes', () => {
    const obs = new AuthObserver('')
    const rows = [row('t-org', auth({ via: 'peer-org', basis: ['peer-org:dsh/canvas/far'], version: V1 })), row('t-plain', auth({ version: V1 }))]
    let orgOk = true
    const judge = (): Admission => (orgOk ? pass('peer-org', ['peer-org:dsh/canvas/far']) : refuse('peer org no longer names the caller'))
    expect(obs.observe(input(V1, rows, judge, 'boot'))).toBeUndefined()
    orgOk = false
    const first = obs.observe(input(V1, rows, judge, 'lazy'))
    expect(first?.cause).toBe('peer-org-recheck')
    expect(first?.from_version).toBe(V1)
    expect(first?.tasks.map(task => task.taskId)).toEqual(['t-org'])
    // Same verdict again: no repeated entry on every poll.
    expect(obs.observe(input(V1, rows, judge, 'lazy'))).toBeUndefined()
    // Recovered, then relapsed: reported again.
    orgOk = true
    expect(obs.observe(input(V1, rows, judge, 'lazy'))).toBeUndefined()
    orgOk = false
    expect(obs.observe(input(V1, rows, judge, 'lazy'))?.tasks).toHaveLength(1)
  })

  it('both rings are capped at AUTH_HISTORY_CAP, newest first', () => {
    const obs = new AuthObserver('')
    // A fresh task per move (one already reported the same way is not listed again).
    for (let i = 0; i < AUTH_HISTORY_CAP + 5; i++) {
      obs.observe(input(`al1:${(0x1000 + i).toString(16).padStart(16, '0')}`, [row(`t-${String(i)}`, auth({ version: V1 }))], () => refuse(`r${String(i)}`)))
    }
    expect(obs.history()).toHaveLength(AUTH_HISTORY_CAP)
    expect(obs.entries()).toHaveLength(AUTH_HISTORY_CAP)
    expect(obs.entries()[0]?.tasks[0]?.reason).toBe(`r${String(AUTH_HISTORY_CAP + 4)}`)
  })

  it('round-trips through auth-versions.json', () => {
    const path = observerPath()
    const first = new AuthObserver(path, () => 7)
    first.observe(input(V1, [row('t-1', auth())], () => pass('canvas-shared', ['dsh/canvas/ops']), 'boot'))
    first.observe(input(V2, [row('t-1', auth())], () => refuse('gone')))
    const second = new AuthObserver(path)
    expect(second.history()).toEqual(first.history())
    expect(second.entries()).toEqual(first.entries())
    expect(second.history()[0]).toEqual({ version: V2, at: 7, cause: 'canvas', inputs: { zone: 'dsh' } })
    // The restored head is the baseline: the same version records nothing new.
    expect(second.observe(input(V2, [row('t-1', auth())], () => refuse('gone')))).toBeUndefined()
  })

  it('a corrupt file is dropped whole; the next observation starts a fresh history and rewrites it', () => {
    const path = observerPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, '{ not json')
    const obs = new AuthObserver(path)
    expect(obs.history()).toEqual([])
    expect(obs.entries()).toEqual([])
    obs.observe(input(V1, [], () => refuse('x'), 'boot'))
    expect((JSON.parse(readFileSync(path, 'utf8')) as { versions: unknown[] }).versions).toHaveLength(1)
  })

  it('malformed entries are dropped one by one; well-formed ones survive', () => {
    const path = observerPath()
    mkdirSync(dirname(path), { recursive: true })
    const good = { version: V1, at: 1, cause: 'boot', inputs: {} }
    const goodTask = { taskId: 't-1', direction: 'inbound', caller: 'dsh/a', target: 'dsh/b', verdict: 'would-revoke', reason: 'r' }
    writeFileSync(path, JSON.stringify({
      versions: [good, { version: 'v1', at: 1, cause: 'boot' }, { version: V2, at: 'x', cause: 'boot' }, null],
      affected: [
        { at: 2, from_version: null, to_version: V1, cause: 'boot', tasks: [goodTask] },
        { at: 2, from_version: V1, to_version: V2, cause: 'canvas', tasks: [{ ...goodTask, verdict: 'cancelled' }] },
        { at: 2, from_version: 'nope', to_version: V2, cause: 'canvas', tasks: [] },
      ],
    }))
    const obs = new AuthObserver(path)
    expect(obs.history()).toEqual([good])
    expect(obs.entries()).toEqual([{ at: 2, from_version: null, to_version: V1, cause: 'boot', tasks: [goodTask] }])
  })
})

describe('#138 review fixes', () => {
  const input = (version: string, rows: JudgedRow[], judge: () => Admission, cause = 'lazy') => ({
    version, cause, inputs: () => ({}), rows: () => rows, judge,
  })
  const orgRow = row('t-org', auth({ via: 'peer-org', basis: ['peer-org:dsh/canvas/far'], version: V1 }))

  it('R1: a boot observation never judges cache-resting rows — the cold peer-card cache would read them as refused', () => {
    const path = observerPath()
    expect(new AuthObserver(path).observe(input(V1, [orgRow], () => pass('peer-org', ['peer-org:dsh/canvas/far']), 'boot'))).toBeUndefined()
    const cold = (): Admission => refuse('caller declares no team membership (cache cold)')
    const rebooted = new AuthObserver(path)
    // Same version after the restart, and a moved one: neither lists the row.
    expect(rebooted.observe(input(V1, [orgRow], cold, 'boot'))).toBeUndefined()
    expect(new AuthObserver(observerPath()).observe(input(V2, [orgRow], cold, 'boot'))).toBeUndefined()
    // The first read after boot does recheck it.
    expect(rebooted.observe(input(V1, [orgRow], cold))?.tasks.map(task => task.verdict)).toEqual(['would-revoke'])
  })

  it('R2: the recheck keys on the latest judged rule, not the birth via', () => {
    const obs = new AuthObserver('')
    const rows = [row('t-ref', auth({ basis: ['dsh/canvas/ops'], version: V1 }))]
    obs.observe(input(V1, rows, () => pass('remote-ref-samezone', ['dsh/canvas/ops']), 'boot'))
    // The remote ref is removed; only the warm cache still pairs the two.
    const moved = obs.observe(input(V2, rows, () => pass('peer-org', ['peer-org:dsh/canvas/ops']), 'canvas'))
    expect(moved?.tasks[0]?.verdict).toBe('basis-changed')
    // The cache entry expires: same version, today's records refuse the caller.
    const after = obs.observe(input(V2, rows, () => refuse('no link')))
    expect(after?.cause).toBe('peer-org-recheck')
    expect(after?.tasks[0]?.verdict).toBe('would-revoke')
    // A firm rule admits it again: no longer cache-resting, so a same-version read judges nothing.
    obs.observe(input('al1:3333333333333333', rows, () => pass('canvas-shared', ['dsh/canvas/ops']), 'canvas'))
    let judged = 0
    obs.observe(input('al1:3333333333333333', rows, () => { judged++; return refuse('x') }))
    expect(judged).toBe(0)
  })

  it('R3: a task still affected the same way is not listed again on a later move; a changed verdict is', () => {
    const obs = new AuthObserver('')
    const rows = [row('t-1', auth())]
    obs.observe(input(V1, rows, () => pass('canvas-shared', ['dsh/canvas/ops']), 'boot'))
    expect(obs.observe(input(V2, rows, () => refuse('caller is not joined'), 'joined'))?.tasks).toHaveLength(1)
    // Same gesture, another store, other wording: still would-revoke → no second entry.
    expect(obs.observe(input('al1:3333333333333333', rows, () => refuse('caller shares no team with target'), 'canvas'))).toBeUndefined()
    // Recovers on a new basis: that is a new report.
    expect(obs.observe(input('al1:4444444444444444', rows, () => pass('roster-shared', ['dsh/team-x']), 'roster'))?.tasks[0]?.verdict).toBe('basis-changed')
    expect(obs.entries()).toHaveLength(2)
  })

  it('P3: a task gone from the rows is forgotten, so a later report for the same id is not swallowed', () => {
    const obs = new AuthObserver('')
    const rows = [row('t-1', auth())]
    obs.observe(input(V1, rows, () => pass('canvas-shared', ['dsh/canvas/ops']), 'boot'))
    expect(obs.observe(input(V2, rows, () => refuse('gone'), 'canvas'))).toBeDefined()
    obs.observe(input('al1:3333333333333333', [], () => refuse('gone'), 'canvas'))
    expect(obs.observe(input('al1:4444444444444444', rows, () => refuse('gone'), 'canvas'))?.tasks).toHaveLength(1)
  })

  it('P3: auth-versions.json is replaced by rename (a read-only old file does not block the write; no tmp left behind)', () => {
    const path = observerPath()
    const obs = new AuthObserver(path)
    obs.observe(input(V1, [], () => refuse('x'), 'boot'))
    chmodSync(path, 0o400)
    obs.observe(input(V2, [], () => refuse('x'), 'canvas'))
    expect((JSON.parse(readFileSync(path, 'utf8')) as { versions: Array<{ version: string }> }).versions.map(entry => entry.version)).toEqual([V2, V1])
    expect(readdirSync(dirname(path))).toEqual(['auth-versions.json'])
  })
})
