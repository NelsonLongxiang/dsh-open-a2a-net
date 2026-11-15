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
import { forwardScope } from '../../src/outbound-scope.ts'
import { KV } from '../../src/superagent/a2a-watch.ts'

const quiet = { info: () => {}, warn: () => {} }
const exited = (args: string[], out: Record<string, unknown>) => Object.assign(new Error(`a2a-net ${args[0] ?? ''} exited 1: `), { exitCode: 1, stdout: JSON.stringify(out) })
const DEPOSIT = { ok: false, code: -32000, task_id: 'direct-ec79f7226b29', delivered: false, error: 'No live DSH session node accepts team "dsh/420a84a3" and no cold joined session matches it. — not forwarded: caller is not an online local CLI deposit', next: 'run `a2a-net publish` to renew this CLI deposit on its home host, then send again with a new task id' }

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
    expect(error.message).toContain('not an online local CLI deposit')
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
  it('an unbound signature is its own refusal: no renewal, no second route', async () => {
    const { a2a, calls } = source(async args => {
      if (args[0] === 'admission') return admitted
      throw exited(args, { ...DEPOSIT, error: 'No live DSH session node accepts team "dsh/420a84a3". — not forwarded: caller has no bound CLI signature on this host (unsigned, signed by another identity, or an OriginClaim bound to an origin this host does not list); renewing the deposit does not change this' })
    })
    const error = await a2a.askReview('dsh/420a84a3', 'text').catch((e: unknown) => e) as Error
    expect(error.message).toContain('no bound CLI signature')
    expect(calls.map(c => c[0])).toEqual(['admission', 'route'])
  })
  it('the CLI runs carry the published origin as the claim audience', async () => {
    const seen: NodeJS.ProcessEnv[] = []
    const a2a = new A2aSource({
      dir: mkdtempSync(join(tmpdir(), 'sa-outaud-')), homeUrl: () => 'http://127.0.0.1:1', apiKey: () => undefined, claimAudience: () => 'http://lan.example:13080', enabled: () => true,
      receive: () => 'accepted' as never, ticket: () => undefined, logger: quiet,
      run: async (_args, env) => { seen.push(env); return admitted },
    })
    await a2a.askReview('dsh/420a84a3', 'text')
    expect(seen[0]).toMatchObject({ A2A_HOME: 'http://127.0.0.1:1', A2A_CLAIM_AUDIENCE: 'http://lan.example:13080' })
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
    const ask = vi.fn(async () => { throw Object.assign(new Error('a2a-net route refused: not forwarded: caller is not an online local CLI deposit · task direct-ec79f7226b29'), { task: 'direct-ec79f7226b29' }) })
    const out = new OutboundRequests({ path: join(mkdtempSync(join(tmpdir(), 'sa-outrec-')), 'outbound.json'), ask, note, logger: quiet, now: () => '2026-11-12T00:00:00.000Z' })
    out.waiting('c1', 't1', 'dsh/420a84a3', '请补材料', 'session-m')
    await expect(out.decided('c1', true, 'team', () => '成本补材料')).resolves.toBeUndefined()
    expect(out.list()[0]).toMatchObject({ state: 'failed', task: 'direct-ec79f7226b29' })
    expect(out.list()[0]!.error).toContain('not an online local CLI deposit')
    expect(String(note.mock.calls[0]![1])).toContain('task direct-ec79f7226b29')
    // A failed request's task is never read as answered by a receipt (O5 reads sent records only).
    out.received({ meta: { receiptFor: 'direct-ec79f7226b29', proof: 'origin-claim' }, text: 'x', at: 'now' } as never)
    expect(out.list()[0]!.state).toBe('failed')
  })
})

describe('owner ruling 2026-11-12: an approved card is the team identity\'s sender scope for its address, while it is sent', () => {
  it('authorizes only during the send of an approved card, only its address (a canvas target without its owner suffix too)', async () => {
    let during: boolean[] = []
    let out!: OutboundRequests
    const ask = vi.fn(async () => { during = [out.authorizes('dsh/420a84a3'), out.authorizes('dsh/canvas/fin'), out.authorizes('dsh/canvas/fin@0123abcd'), out.authorizes('dsh/99999999')]; return 'direct-ok0000001' })
    out = new OutboundRequests({ path: join(mkdtempSync(join(tmpdir(), 'sa-outauth-')), 'outbound.json'), ask, note: () => {}, logger: quiet, now: () => '2026-11-12T00:00:00.000Z' })
    out.waiting('c1', 't1', 'dsh/420a84a3', '请补材料', 'session-m')
    expect(out.authorizes('dsh/420a84a3')).toBe(false)
    await out.decided('c1', true, 'team', () => '成本')
    expect(during).toEqual([true, false, false, false])
    expect(out.authorizes('dsh/420a84a3')).toBe(false)

    out.waiting('c2', 't1', 'dsh/canvas/fin@0123abcd', '请补材料', 'session-m')
    const seen: boolean[] = []
    ask.mockImplementationOnce(async () => { seen.push(out.authorizes('dsh/canvas/fin'), out.authorizes('dsh/canvas/fin@0123abcd')); return 'direct-ok0000002' })
    await out.decided('c2', true, 'team', () => '成本')
    expect(seen).toEqual([true, true])
  })
  it('a declined card authorizes nothing; a failed send closes the window as well', async () => {
    let during = false
    let out!: OutboundRequests
    const ask = vi.fn(async () => { during = out.authorizes('dsh/420a84a3'); throw new Error('refused') })
    out = new OutboundRequests({ path: join(mkdtempSync(join(tmpdir(), 'sa-outauth2-')), 'outbound.json'), ask, note: () => {}, logger: quiet, now: () => '2026-11-12T00:00:00.000Z' })
    out.waiting('c1', 't1', 'dsh/420a84a3', 'x', 'session-m')
    await out.decided('c1', false, 'team', () => '')
    expect(ask).not.toHaveBeenCalled()
    out.waiting('c2', 't1', 'dsh/420a84a3', 'x', 'session-m')
    await out.decided('c2', true, 'team', () => '')
    expect(during).toBe(true)
    expect(out.authorizes('dsh/420a84a3')).toBe(false)
  })
  it('forwardScope: the card answers for the identity it names; anyone else, or no card, runs the ordinary scope', async () => {
    const scope = vi.fn(async () => ({ ok: false as const, error: 'outside sender scope' }))
    const card = (handle: string, team: string): boolean => handle === 'superagent-team/abc' && team === 'dsh/420a84a3'
    await expect(forwardScope(card, scope, 'superagent-team/abc', 'dsh/420a84a3')).resolves.toEqual({ ok: true })
    expect(scope).not.toHaveBeenCalled()
    await expect(forwardScope(card, scope, 'superagent-team/abc', 'dsh/99999999')).resolves.toMatchObject({ ok: false })
    await expect(forwardScope(card, scope, 'ops-cli/xyz', 'dsh/420a84a3')).resolves.toMatchObject({ ok: false })
    expect(scope).toHaveBeenCalledTimes(2)
  })
})
