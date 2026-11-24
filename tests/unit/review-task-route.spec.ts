// @vitest-environment node
/**
 * #877 (owner decision 2026-11-24): a review request gets its task id before the send and goes from the team identity
 * over the --task route. A send whose outcome is unknown is asked again under the same id, so the reviewer never gets
 * a second request; a send that never went out is asked anew; a changed team identity refuses before anything runs.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ReviewRequests } from '../../src/superagent/host/review-requests.ts'
import { A2aSource, RouteRefused } from '../../src/superagent/host/a2a-source.ts'

const reviewer = 'dsh/f49961b0', head = 'abcdef1234567890', URL = 'https://github.com/o/net/pull/7'
const TEAM = 'superagent-team/0123456789abcdef'
type Ask = (address: string, text: string, task?: string, sender?: string) => Promise<string | undefined>

function requests(ask: Ask, path = join(mkdtempSync(join(tmpdir(), 'sa-review-task-')), 'r.json'), sender = async () => TEAM) {
  const asked: Array<{ task?: string; sender?: string }> = [], notes: Array<[string, string]> = []
  let n = 0
  const senders = vi.fn(sender)
  const r = new ReviewRequests({ path, reviewer: () => reviewer, logger: { warn: () => {} }, note: (t, x) => { notes.push([t, x]) },
    ask: async (a, x, task, s) => { asked.push({ task, sender: s }); return await ask(a, x, task, s) }, sender: senders, taskId: () => `rev-${String(++n)}` })
  return { r, asked, notes, path, senders }
}
const stored = (path: string) => (JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, unknown>>)['o/net#7']

describe('#877: review requests carry a task id recorded before the send', () => {
  it('the task id and the team identity are on disk before the send; the answer keeps them', async () => {
    let release!: (v: string) => void
    const m = requests(async () => await new Promise<string>(resolve => { release = resolve }))
    const pending = m.r.opened('o/net#7', head, URL, 't1')
    await vi.waitFor(() => { expect(m.asked).toHaveLength(1) })
    expect(stored(m.path)).toMatchObject({ task: 'rev-1', sender: TEAM, state: 'asking', head })
    expect(m.asked[0]).toEqual({ task: 'rev-1', sender: TEAM })
    release('rev-1')
    await pending
    expect(stored(m.path)).toMatchObject({ task: 'rev-1', sender: TEAM })
    expect(stored(m.path)).not.toHaveProperty('state')
  })

  it('an unknown outcome keeps the id: the next read asks again under the same id, never a new one', async () => {
    let calls = 0
    const m = requests(async (_a, _x, task) => { calls += 1; if (calls === 1) throw new Error('acceptance unknown'); return task })
    await expect(m.r.opened('o/net#7', head, URL, 't1')).rejects.toThrow('acceptance unknown')
    expect(stored(m.path)).toMatchObject({ task: 'rev-1', state: 'asking' })
    await m.r.opened('o/net#7', head, URL, 't1')
    expect(m.asked.map(a => a.task)).toEqual(['rev-1', 'rev-1'])
    expect(stored(m.path)).toMatchObject({ task: 'rev-1' })
    expect(stored(m.path)).not.toHaveProperty('state')
    await m.r.opened('o/net#7', head, URL, 't1')
    expect(m.asked).toHaveLength(2)
  })

  it('a send that never went out (not-sent) is asked anew on the next read, under a new id', async () => {
    let calls = 0
    const m = requests(async (_a, _x, task) => { calls += 1; if (calls === 1) throw new RouteRefused('团队发送身份变化，未执行 route。', task, 'not-sent'); return task })
    await expect(m.r.opened('o/net#7', head, URL, 't1')).rejects.toBeInstanceOf(RouteRefused)
    expect(m.r.list()).toHaveLength(0)
    await m.r.opened('o/net#7', head, URL, 't1')
    expect(m.asked.map(a => a.task)).toEqual(['rev-1', 'rev-2'])
  })

  it('a restart in the middle of the send asks again under the recorded id and tells no ticket it is unknown', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'sa-review-task-')), 'r.json')
    const first = requests(() => new Promise<string | undefined>(() => {}), path)
    void first.r.opened('o/net#7', head, URL, 't1')
    await vi.waitFor(() => { expect(first.asked).toHaveLength(1) })
    const after = requests(async (_a, _x, task) => task, path, async () => 'superagent-team/fedcba9876543210')
    expect(after.r.list()[0]).toMatchObject({ state: 'asking', task: 'rev-1', sender: TEAM })
    await after.r.opened('o/net#7', head, URL, 't1')
    expect(after.asked).toEqual([{ task: 'rev-1', sender: TEAM }])
    expect(after.senders).not.toHaveBeenCalled()
    expect(after.notes).toHaveLength(0)
    expect(after.r.list()[0]).not.toHaveProperty('state')
  })

  it('an unlinked reviewer leaves no record; an answer for another task id is refused and the id is kept', async () => {
    const unlinked = requests(async () => undefined)
    await unlinked.r.opened('o/net#7', head, URL, 't1')
    expect(unlinked.r.list()).toHaveLength(0)
    const other = requests(async () => 'rev-other')
    await expect(other.r.opened('o/net#7', head, URL, 't1')).rejects.toThrow('not rev-1')
    expect(stored(other.path)).toMatchObject({ task: 'rev-1', state: 'asking' })
  })
})

describe('#877: askReviewAs sends under the task id from the team identity', () => {
  function held(run: (args: string[]) => Promise<string>) {
    const calls: string[][] = []
    const dir = mkdtempSync(join(tmpdir(), 'sa-review-as-'))
    mkdirSync(join(dir, 'team-cli'), { recursive: true })
    writeFileSync(join(dir, 'team-cli', 'cli.json'), JSON.stringify({ handle: TEAM }))
    const a2a = new A2aSource({ dir, homeUrl: () => 'http://127.0.0.1:1', apiKey: () => undefined, enabled: () => true, receive: () => 'accepted' as never, ticket: () => undefined,
      logger: { info: () => {}, warn: () => {} }, run: async args => { calls.push(args); return await run(args) } })
    return { a2a, calls }
  }
  const admitted = JSON.stringify({ admitted: true, rule: 'canvas-shared' })

  it('refuses before anything runs when the team identity changed', async () => {
    const x = held(async () => admitted)
    await expect(x.a2a.askReviewAs(reviewer, 'text', 'rev-1', 'superagent-team/fedcba9876543210')).rejects.toMatchObject({ task: 'rev-1', delivery: 'not-sent' })
    expect(x.calls).toHaveLength(0)
  })

  it('checks the reviewer link, then routes with --task; an unlinked reviewer gets nothing', async () => {
    const x = held(async args => args[0] === 'admission' ? admitted : JSON.stringify({ delivered: true, task_id: 'rev-1' }))
    await expect(x.a2a.askReviewAs(reviewer, 'text', 'rev-1', TEAM)).resolves.toBe('rev-1')
    expect(x.calls).toEqual([['admission', reviewer, '--json'], ['route', reviewer, '--json', '--task', 'rev-1', '--', 'text']])
    const no = held(async () => JSON.stringify({ admitted: false }))
    await expect(no.a2a.askReviewAs(reviewer, 'text', 'rev-1', TEAM)).resolves.toBeUndefined()
    expect(no.calls.map(c => c[0])).toEqual(['admission'])
  })

  it('an unconfirmed acceptance is never read as not-sent (the id is kept for the next read)', async () => {
    const x = held(async args => args[0] === 'admission' ? admitted : JSON.stringify({ delivered: true, acceptance: 'unknown', task_id: 'rev-1' }))
    const failure = await x.a2a.askReviewAs(reviewer, 'text', 'rev-1', TEAM).catch(e => e)
    expect(failure).toMatchObject({ task: 'rev-1' })
    expect(failure).not.toHaveProperty('delivery', 'not-sent')
  })
})
