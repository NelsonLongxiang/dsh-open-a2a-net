/**
 * The layout save loop, over an injected scheduler and transport: debounce
 * coalescing, the lamp ladder, adopt-only-on-unchanged, mid-flight edit
 * chaining, explicit retry, and the pagehide flush.
 */
import { describe, expect, it } from 'vitest'
import { SAVE_DEBOUNCE_MS, createSaveLoop, type LampState, type SaveLoopDeps, type SaveResponse } from '../nexus-stage/src/layout-wire.ts'

/** Deterministic scheduler: timers are a list the test fires by hand. */
function manualScheduler(): { schedule: SaveLoopDeps['schedule']; tick: () => void; pending: () => number } {
  let timers: Array<{ fn: () => void }> = []
  return {
    schedule(fn) {
      const t = { fn }
      timers.push(t)
      return () => { timers = timers.filter(x => x !== t) }
    },
    tick() {
      const run = timers
      timers = []
      for (const t of run) t.fn()
    },
    pending: () => timers.length,
  }
}

interface Fixture {
  lamps: LampState[]
  errors: string[]
  adopted: unknown[]
  sends: Array<{ doc: unknown; keepalive: boolean }>
  loop: ReturnType<typeof createSaveLoop>
  tick: () => void
  pending: () => number
  setSnapshot: (doc: unknown) => void
  respond: (res: SaveResponse | 'throw') => void
}

function fixture(initial: unknown): Fixture {
  const sched = manualScheduler()
  const f: Fixture = {
    lamps: [],
    errors: [],
    adopted: [],
    sends: [],
    tick: sched.tick,
    pending: sched.pending,
    setSnapshot: () => {},
    respond: () => {},
    loop: undefined as unknown as Fixture['loop'],
  }
  let snapshot: unknown = initial
  let release: ((res: SaveResponse | 'throw') => void) | undefined
  const deps: SaveLoopDeps = {
    snapshot: () => snapshot,
    send: (doc, opts) => new Promise<SaveResponse>((resolve, reject) => {
      f.sends.push({ doc, keepalive: opts.keepalive })
      release = (res) => { if (res === 'throw') reject(new Error('network down')); else resolve(res) }
    }),
    schedule: sched.schedule,
    now: () => 0,
    onLamp: (s) => { f.lamps.push(s) },
    onAdopt: (layout) => { f.adopted.push(layout) },
    onHttpError: (m) => { f.errors.push(m) },
  }
  f.setSnapshot = (doc) => { snapshot = doc }
  // Resolving the send promise only schedules fire()'s continuation; a
  // couple of microtask flushes let the async function run to its settle.
  f.respond = async (res) => {
    release?.(res)
    release = undefined
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }
  f.loop = createSaveLoop(deps)
  return f
}

describe('layout save loop', () => {
  it('coalesces a nudge storm into one debounced send', () => {
    const f = fixture({ v: 1 })
    f.loop.markDirty()
    f.loop.markDirty()
    f.loop.markDirty()
    expect(f.pending()).toBe(1)
    expect(f.sends).toHaveLength(0)
    f.tick()
    expect(f.sends).toHaveLength(1)
    expect(f.sends[0]!.doc).toEqual({ v: 1 })
  })

  it('walks the lamp ladder pending -> saved and adopts on unchanged success', async () => {
    const f = fixture({ v: 1 })
    f.loop.markDirty()
    expect(f.lamps).toEqual(['pending'])
    f.tick()
    await f.respond({ ok: true, layout: { v: 1, normalized: true } })
    expect(f.lamps).toEqual(['pending', 'saved'])
    expect(f.adopted).toEqual([{ v: 1, normalized: true }])
  })

  it('surfaces refusals as error + message; retry recovers', async () => {
    const f = fixture({ v: 1 })
    f.loop.markDirty()
    f.tick()
    await f.respond({ ok: false, error: 'payload is not a version-1 layout document' })
    expect(f.lamps).toEqual(['pending', 'error'])
    expect(f.errors).toEqual(['layout save: payload is not a version-1 layout document'])
    f.loop.retry()
    expect(f.lamps).toEqual(['pending', 'error', 'pending'])
    await f.respond({ ok: true, layout: { v: 1 } })
    expect(f.lamps).toEqual(['pending', 'error', 'pending', 'saved'])
  })

  it('surfaces transport throws the same way', async () => {
    const f = fixture({ v: 1 })
    f.loop.markDirty()
    f.tick()
    await f.respond('throw')
    expect(f.lamps).toEqual(['pending', 'error'])
    expect(f.errors[0]).toContain('network down')
  })

  it('never adopts a foreign edit: mid-flight changes chain the next save', async () => {
    const f = fixture({ v: 1 })
    f.loop.markDirty()
    f.tick()
    // The user keeps dragging while the request is in flight: the edit
    // arrives through markDirty (the only path a real edit can take) and
    // the snapshot advances under the in-flight document.
    f.loop.markDirty()
    f.setSnapshot({ v: 2 })
    await f.respond({ ok: true, layout: { v: 1 } })
    expect(f.adopted).toEqual([]) // the stale echo is not adopted
    expect(f.lamps).toEqual(['pending']) // no false "saved"
    expect(f.pending()).toBe(1) // a chained save is armed
    f.tick()
    expect(f.sends).toHaveLength(2)
    expect(f.sends[1]!.doc).toEqual({ v: 2 })
    await f.respond({ ok: true, layout: { v: 2 } })
    expect(f.lamps).toEqual(['pending', 'saved'])
    expect(f.adopted).toEqual([{ v: 2 }])
  })

  it('queues edits that land while a request is in flight', async () => {
    const f = fixture({ v: 1 })
    f.loop.markDirty()
    f.tick()
    f.loop.markDirty() // during flight: queued; the lamp honestly returns to pending
    await f.respond({ ok: true, layout: { v: 1 } })
    expect(f.lamps).toEqual(['pending', 'saved', 'pending'])
    expect(f.pending()).toBe(1)
    f.tick()
    expect(f.sends).toHaveLength(2)
    await f.respond({ ok: true, layout: { v: 1 } })
    expect(f.lamps).toEqual(['pending', 'saved', 'pending', 'saved'])
  })

  it('flush fires immediately with keepalive for the pagehide path', async () => {
    const f = fixture({ v: 9 })
    f.loop.markDirty()
    f.loop.flush()
    expect(f.sends).toHaveLength(1)
    expect(f.sends[0]!.keepalive).toBe(true)
    expect(f.pending()).toBe(0)
    await f.respond({ ok: true, layout: { v: 9 } })
    expect(f.lamps).toEqual(['pending', 'saved'])
  })

  it('uses the 800ms debounce constant (the design contract)', () => {
    const seen: number[] = []
    createSaveLoop({
      snapshot: () => null,
      send: () => Promise.resolve({ ok: true }),
      schedule: (fn, ms) => { seen.push(ms); return () => {} },
      now: () => 0,
      onLamp: () => {},
      onAdopt: () => {},
      onHttpError: () => {},
    }).markDirty()
    expect(seen).toEqual([SAVE_DEBOUNCE_MS])
  })
})
