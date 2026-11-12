// @vitest-environment node
/**
 * An approved outbound request whose route the home host refused: the reason the CLI printed on stdout (--json writes
 * nothing to stderr) reaches the ticket with the task id it used, and a refusal for a deposit that is not online there is
 * repaired once — publish, then one more route — since the host refused before any dispatch.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { A2aSource, cliRefusal } from '../../src/superagent/host/a2a-source.ts'
import { OutboundRequests } from '../../src/superagent/host/outbound.ts'
import { KV } from '../../src/superagent/a2a-watch.ts'

const quiet = { info: () => {}, warn: () => {} }
const exited = (args: string[], out: Record<string, unknown>) => Object.assign(new Error(`a2a-net ${args[0] ?? ''} exited 1: `), { exitCode: 1, stdout: JSON.stringify(out) })
const DEPOSIT = { ok: false, code: -32000, task_id: 'direct-ec79f7226b29', delivered: false, error: 'No live DSH session node accepts team "dsh/420a84a3" and no cold joined session matches it. — not forwarded: caller is not a proven online local CLI deposit', next: 'run `a2a-net publish` to renew this CLI deposit on its home host, then send again with a new task id' }

function source(run: (args: string[]) => Promise<string>, enabled = true) {
  const calls: string[][] = []
  const a2a = new A2aSource({
    dir: mkdtempSync(join(tmpdir(), 'sa-outsend-')), homeUrl: () => 'http://127.0.0.1:1', apiKey: () => undefined, enabled: () => enabled,
    receive: () => 'accepted' as never, ticket: () => undefined, logger: quiet,
    run: async args => { calls.push(args); return await run(args) },
  })
  return { a2a, calls }
}
const admitted = JSON.stringify({ admitted: true, rule: 'canvas-shared' })

describe('the CLI refusal on stdout', () => {
  it('names the error, the next step and the task id; a non-JSON stdout is kept as it is', () => {
    expect(cliRefusal(JSON.stringify(DEPOSIT))).toMatchObject({ error: DEPOSIT.error, task: 'direct-ec79f7226b29' })
    expect(cliRefusal(JSON.stringify(DEPOSIT)).summary).toContain('next: run `a2a-net publish`')
    expect(cliRefusal('plain words').summary).toBe('plain words')
    expect(cliRefusal(undefined).summary).toBe('no reason given')
  })
})

describe('askReview on a refused route', () => {
  it('a deposit refusal renews the deposit and sends once more; the second task id is the one returned', async () => {
    let routes = 0
    const { a2a, calls } = source(async args => {
      if (args[0] === 'admission') return admitted
      if (args[0] === 'publish') return '{}'
      routes += 1
      if (routes === 1) throw exited(args, DEPOSIT)
      return JSON.stringify({ delivered: true, task_id: 'direct-second00001' })
    })
    await expect(a2a.askReview('dsh/420a84a3', 'text')).resolves.toBe('direct-second00001')
    expect(calls.map(c => c[0])).toEqual(['admission', 'route', 'publish', 'route'])
    expect(calls[2]).toEqual(['publish', '--owes'])
    expect(typeof a2a.context.state.get(KV.renewedAt)).toBe('number')
  })
  it('still refused after renewing: the error carries the reason and the task id, and there is no third route', async () => {
    const { a2a, calls } = source(async args => {
      if (args[0] === 'admission') return admitted
      if (args[0] === 'publish') return '{}'
      throw exited(args, { ...DEPOSIT, task_id: 'direct-again000001' })
    })
    const error = await a2a.askReview('dsh/420a84a3', 'text').catch((e: unknown) => e) as Error & { task?: string }
    expect(error.message).toContain('not a proven online local CLI deposit')
    expect(error.message).toContain('after renewing the deposit')
    expect(error.task).toBe('direct-again000001')
    expect(calls.filter(c => c[0] === 'route')).toHaveLength(2)
  })
  it('any other refusal is not retried and keeps its reason', async () => {
    const { a2a, calls } = source(async args => {
      if (args[0] === 'admission') return admitted
      throw exited(args, { ok: false, delivered: false, task_id: 'direct-other000001', error: 'not forwarded: target is outside sender scope: x' })
    })
    const error = await a2a.askReview('dsh/420a84a3', 'text').catch((e: unknown) => e) as Error & { task?: string }
    expect(error.message).toContain('outside sender scope')
    expect(error.task).toBe('direct-other000001')
    expect(calls.map(c => c[0])).toEqual(['admission', 'route'])
  })
  it('a failed renewal says so and does not route again', async () => {
    const { a2a, calls } = source(async args => {
      if (args[0] === 'admission') return admitted
      if (args[0] === 'publish') throw new Error('a2a-net publish exited 1: home unreachable')
      throw exited(args, DEPOSIT)
    })
    const error = await a2a.askReview('dsh/420a84a3', 'text').catch((e: unknown) => e) as Error
    expect(error.message).toContain('deposit renewal failed')
    expect(calls.filter(c => c[0] === 'route')).toHaveLength(1)
  })
})

describe('the outbound record of a refused send', () => {
  it('keeps the reason and the task id; the ticket note names both', async () => {
    const note = vi.fn()
    const ask = vi.fn(async () => { throw Object.assign(new Error('a2a-net route refused: not forwarded: caller is not a proven online local CLI deposit · task direct-ec79f7226b29'), { task: 'direct-ec79f7226b29' }) })
    const out = new OutboundRequests({ path: join(mkdtempSync(join(tmpdir(), 'sa-outrec-')), 'outbound.json'), ask, note, logger: quiet, now: () => '2026-11-12T00:00:00.000Z' })
    out.waiting('c1', 't1', 'dsh/420a84a3', '请补材料', 'session-m')
    await expect(out.decided('c1', true, 'team', () => '成本补材料')).resolves.toBeUndefined()
    expect(out.list()[0]).toMatchObject({ state: 'failed', task: 'direct-ec79f7226b29' })
    expect(out.list()[0]!.error).toContain('not a proven online local CLI deposit')
    expect(String(note.mock.calls[0]![1])).toContain('task direct-ec79f7226b29')
    // A failed request's task is never read as answered by a receipt (O5 reads sent records only).
    out.received({ meta: { receiptFor: 'direct-ec79f7226b29', proof: 'origin-claim' }, text: 'x', at: 'now' } as never)
    expect(out.list()[0]!.state).toBe('failed')
  })
})
