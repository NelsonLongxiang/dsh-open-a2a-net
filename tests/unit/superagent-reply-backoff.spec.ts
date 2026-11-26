import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, cleanupBeforeTempDirs } from '../temp-dirs.ts'
import { SuperagentHost } from '../../src/superagent/host/index.ts'
import { failedReplyRetry, validReplyRetry } from '../../src/superagent/host/reply-backoff.ts'
const T0 = Date.parse('2026-11-25T10:00:00Z')
async function fixture(home = mkdtempSync(join(tmpdir(), 'reply-backoff-')), initial = T0) {
  let clock = initial, down = true
  const calls: string[][] = [], warnings: unknown[][] = []
  const host = new SuperagentHost({ home, canvasTeam: () => ({ local: [], remote: [] }),
    logger: { info: () => {}, warn: (...args: unknown[]) => { warnings.push(args) } }, deliverToSession: () => true,
    interval: () => () => {}, now: () => new Date(clock).toISOString(), homeUrl: () => 'http://127.0.0.1:1',
    runCli: async (args: string[]) => { calls.push(args); if (args[0] === 'admission') return JSON.stringify({ admitted: true, rule: 'cli-deposit' }); if (down) throw Object.assign(new Error('synthetic private reply body'), { exitCode: 1 }); return '{}' },
  })
  cleanupBeforeTempDirs(() => host.stop())
  expect(host.saveSettings({ sources: { a2a: true } }, () => true)).toMatchObject({ ok: true })
  const queue = (id: string) => host.store.atomic(() => host.store.messages.save({ message: { id, channel: { source: 'a2a', thread: 'a2a:ctx', address: { caller: 'peer/0123456789abcdef', task: 'direct-original', context: 'ctx' } }, text: 'synthetic reply', kind: 'reply' }, status: 'pending', queuedAt: new Date(T0).toISOString() }))
  const flush = async () => { host.pass(); for (let n = 0; n < 20; n++) await Promise.resolve() }
  return { home, host, calls, warnings, queue, flush, setClock: (ms: number) => { clock = ms }, recover: () => { down = false }, sends: () => calls.filter(a => a[0] === 'receipt' || a[0] === 'route') }
}
describe('#918 pending reply retries', () => {
  it('keeps a confirmed gone result terminal instead of retrying it', async () => {
    const f = await fixture();f.queue('one')
    ;(f.host as any).a2a.send = async () => 'gone'
    await f.flush()
    expect(f.host.store.messages.get('one')?.status).toBe('dropped')
    expect((f.host.store.messages.get('one') as any).retry).toBeUndefined()
    f.setClock(T0 + 30000);await f.flush();expect(f.sends()).toHaveLength(0)
  })
  it('validates persisted cooldowns and refuses malformed counts, dates and shortened intervals', () => {
    const one = failedReplyRetry(undefined, T0)
    expect(validReplyRetry(one)).toBe(true)
    for (const bad of [null, {}, { ...one, failures: 0 }, { ...one, failures: Infinity }, { ...one, failures: 100 },
      { ...one, firstFailedAt: 'unknown' }, { ...one, nextAt: new Date(T0 + 1).toISOString() },
      { ...one, nextAt: new Date(T0 + 3600000).toISOString() }]) expect(validReplyRetry(bad)).toBe(false)
  })
  it('does not resend or relog at every five-second host pass, and retries the identical call at the due boundary', async () => {
    const f = await fixture(); f.queue('reply-one'); await f.flush()
    const original = f.sends()[0]
    expect(f.host.state().replyRetries).toEqual([expect.objectContaining({ id: 'reply-one', task: 'direct-original', valid: true, retry: expect.objectContaining({ failures: 1, nextAt: new Date(T0 + 30000).toISOString() }) })])
    expect(JSON.stringify(f.host.state().replyRetries)).not.toContain('synthetic reply')
    expect(f.sends()).toHaveLength(1)
    for (let n = 1; n < 6; n++) { f.setClock(T0 + n * 5000); await f.flush() }
    expect(f.sends()).toHaveLength(1)
    expect(f.warnings).toHaveLength(1)
    expect(JSON.stringify(f.warnings)).not.toContain('synthetic private reply body')
    expect(f.host.store.messages.get('reply-one')?.status).toBe('pending')
    f.setClock(T0 + 30000); await f.flush(); expect(f.sends()).toHaveLength(2)
    expect(f.sends()[1]).toEqual(original)
    for (let n = 35000; n < 90000; n += 5000) { f.setClock(T0 + n); await f.flush() }
    expect(f.sends()).toHaveLength(2)
    f.recover(); f.setClock(T0 + 90000); await f.flush()
    expect(f.sends()).toHaveLength(3); expect(f.host.store.messages.get('reply-one')?.status).toBe('sent')
    expect((f.host.store.messages.get('reply-one') as any).retry).toBeUndefined()
  })
  it('persists cooldown across a host restart and leaves another message independent', async () => {
    const f = await fixture();f.queue('one');await f.flush();await f.host.stop()
    const g = await fixture(f.home, T0 + 5000);await g.flush();expect(g.sends()).toHaveLength(0)
    g.queue('two');await g.flush();expect(g.sends()).toHaveLength(1)
    g.setClock(T0 + 30000);await g.flush();expect(g.sends()).toHaveLength(2)
  })
  it('caps exponential waiting at five minutes while preserving pending and the original 24h deadline', async () => {
    const f = await fixture();f.queue('one')
    for (const t of [0,30000,90000,210000,450000,750000]) { f.setClock(T0+t);await f.flush() }
    expect(f.sends()).toHaveLength(6)
    expect((f.host.store.messages.get('one') as any).retry.nextAt).toBe(new Date(T0+1050000).toISOString())
    f.setClock(T0 + 24*3600000);await f.flush()
    expect(f.host.store.messages.get('one')?.status).toBe('dropped')
  })
  it('holds malformed persisted retry state without throwing or sending and exposes the problem', async () => {
    const f = await fixture();f.queue('one')
    f.host.store.atomic(() => { const row = f.host.store.messages.get('one')!;f.host.store.messages.save({ ...row, retry: null as never }) })
    await expect(f.flush()).resolves.toBeUndefined();expect(f.sends()).toHaveLength(0)
    expect(f.host.state().replyRetries).toEqual([expect.objectContaining({ id: 'one', valid: false })])
    expect(f.host.store.messages.get('one')?.status).toBe('pending')
  })
  it('reserves the cooldown on disk before starting a send, including a crash before its outcome', async () => {
    const f = await fixture();f.queue('one')
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const savedSend = (f.host as any).a2a.send.bind((f.host as any).a2a)
    ;(f.host as any).a2a.send = async () => { await pending;return savedSend(f.host.store.messages.get('one')!.message) }
    f.host.pass()
    expect((f.host.store.messages.get('one') as any).retry.nextAt).toBe(new Date(T0+30000).toISOString())
    const g = await fixture(f.home, T0+5000);await g.flush();expect(g.sends()).toHaveLength(0)
    release();for(let i=0;i<30;i++)await Promise.resolve()
  })
  it('waits a full cooldown after a slow failure instead of retrying on the next host pass', async () => {
    const f = await fixture();f.queue('slow')
    let fail!: () => void
    const pending = new Promise<never>((_, reject) => { fail = () => reject(new Error('synthetic slow failure')) })
    ;(f.host as any).a2a.send = async () => pending
    f.host.pass();f.setClock(T0 + 60000);fail()
    for(let i=0;i<30;i++)await Promise.resolve()
    expect((f.host.store.messages.get('slow') as any).retry.nextAt).toBe(new Date(T0+90000).toISOString())
    let calls = 0
    ;(f.host as any).a2a.send = async () => { calls++;return 'sent' }
    f.setClock(T0+65000);await f.flush();expect(calls).toBe(0)
    f.setClock(T0+90000);await f.flush();expect(calls).toBe(1)
  })
  it('treats backward wall-clock jumps conservatively instead of restarting the tight loop', async () => {
    const f = await fixture();f.queue('one');await f.flush()
    f.setClock(T0-3600000);await f.flush();expect(f.sends()).toHaveLength(1)
    f.setClock(T0+30000);await f.flush();expect(f.sends()).toHaveLength(2)
  })
})
