/**
 * The canvas wire over an injected transport: sequencing (create → add per
 * id, first failure stops), notice classification (error verbatim,
 * error-less ok:false = idempotent silent success, transport throws, HTTP
 * >= 400), the reorder op channel, and per-team serialization with
 * cross-team parallelism.
 */
import { describe, expect, it } from 'vitest'
import { createCanvasWire, type CanvasWireResult } from '../nexus-stage/src/canvas-wire.ts'

interface Fixture {
  bodies: unknown[]
  notices: Array<{ kind: 'error' | 'info'; text: string }>
  respond: (res: CanvasWireResult | 'throw') => Promise<void>
  settleAll: () => Promise<void>
}

function fixture(auto?: CanvasWireResult): { f: Fixture; wire: ReturnType<typeof createCanvasWire> } {
  const f: Fixture = {
    bodies: [],
    notices: [],
    respond: async () => {},
    settleAll: async () => {},
  }
  let release: ((res: CanvasWireResult | 'throw') => void) | undefined
  const wire = createCanvasWire({
    send: (body) => new Promise<CanvasWireResult>((resolve, reject) => {
      f.bodies.push(body)
      if (auto !== undefined) resolve(auto)
      else release = (res) => { if (res === 'throw') reject(new Error('network down')); else resolve(res) }
    }),
    onNotice: (kind, text) => { f.notices.push({ kind, text }) },
  })
  f.respond = async (res) => {
    // The queue task (and its send) may not have run yet — wait for the
    // release to appear before resolving, or the respond is lost.
    for (let i = 0; i < 50 && release === undefined; i++) await Promise.resolve()
    release?.(res)
    release = undefined
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }
  f.settleAll = async () => {
    for (let i = 0; i < 24; i++) await Promise.resolve()
  }
  return { f, wire }
}

const ok: CanvasWireResult = { status: 200, body: { ok: true, teams: [] } }

describe('canvas wire', () => {
  it('sequences create → add-member per id, in order', async () => {
    const { f, wire } = fixture(ok)
    const done = wire.createTeam('采购', ['a', 'b'])
    await f.respond(ok)
    expect(await done).toBe(true)
    expect(f.bodies).toEqual([
      { action: 'create', name: '采购' },
      { action: 'add-member', name: '采购', id: 'a' },
      { action: 'add-member', name: '采购', id: 'b' },
    ])
  })

  it('surfaces a create rejection verbatim and never sends member adds', async () => {
    const { f, wire } = fixture({ status: 200, body: { ok: false, error: 'invalid name or team cap reached' } })
    const done = wire.createTeam('a/b', ['x', 'y'])
    await f.respond({ status: 200, body: { ok: false, error: 'invalid name or team cap reached' } })
    expect(await done).toBe(false)
    expect(f.notices).toEqual([{ kind: 'error', text: 'invalid name or team cap reached' }])
    expect(f.bodies).toHaveLength(1) // no add-member attempts
  })

  it('stops the serial adds on the first failing member', async () => {
    const { f, wire } = fixture()
    const done = wire.addMembers('甲', ['a', 'bad', 'c'])
    await f.respond(ok) // 'a' goes through
    await f.respond({ status: 200, body: { ok: false, error: 'name and a joined session id are required' } })
    expect(await done).toBe(false)
    expect(f.bodies).toHaveLength(2) // a ok, bad refused, c never sent
    expect(f.notices).toEqual([{ kind: 'error', text: 'name and a joined session id are required' }])
  })

  it('treats error-less ok:false as idempotent success, silently', async () => {
    const { f, wire } = fixture({ status: 200, body: { ok: false, teams: [], members: [] } })
    expect(await wire.removeTeam('不存在')).toBe(true)
    expect(await wire.removeMembers('甲', ['ghost'])).toBe(true)
    expect(f.notices).toEqual([])
  })

  it('classifies transport throws and bare HTTP errors', async () => {
    const { f, wire } = fixture()
    const first = wire.removeTeam('甲')
    await f.respond('throw')
    expect(await first).toBe(false)
    expect(f.notices[0]).toEqual({ kind: 'error', text: '画布不可达：network down' })

    const second = wire.removeTeam('甲')
    await f.respond({ status: 400, body: { error: 'malformed body' } })
    expect(await second).toBe(false)
    expect(f.notices[1]).toEqual({ kind: 'error', text: 'malformed body' })

    const third = wire.removeTeam('甲')
    await f.respond({ status: 500, body: {} })
    expect(await third).toBe(false)
    expect(f.notices[2]).toEqual({ kind: 'error', text: 'HTTP 500' })
  })

  it('runs roster ops in order (reorder channel)', async () => {
    const { f, wire } = fixture(ok)
    const done = wire.runRosterOps('甲', [
      { op: 'remove', id: 'c' }, { op: 'add', id: 'c' },
    ])
    await f.respond(ok)
    await f.respond(ok)
    expect(await done).toBe(true)
    expect(f.bodies).toEqual([
      { action: 'remove-member', name: '甲', id: 'c' },
      { action: 'add-member', name: '甲', id: 'c' },
    ])
  })

  it('serializes same-team ops but lets other teams run in parallel', async () => {
    let releaseA: (() => void) | undefined
    let seenWhileBlocked: string[] = []
    const wire = createCanvasWire({
      send: (body) => new Promise<CanvasWireResult>((resolve) => {
        const b = body as { name?: string }
        if (b.name === '甲' && !releaseA) {
          releaseA = () => resolve({ status: 200, body: { ok: true } })
        } else if (b.name === '甲') {
          // Same-team second request: must not exist until the first settles.
          seenWhileBlocked.push('甲-second')
          resolve({ status: 200, body: { ok: true } })
        } else {
          seenWhileBlocked.push(String(b.name))
          resolve({ status: 200, body: { ok: true } })
        }
      }),
      onNotice: () => {},
    })
    const first = wire.addMembers('甲', ['a'])
    // Wait a microtask: the first 甲 request is in flight, unresolved.
    await Promise.resolve()
    const queued = wire.addMembers('甲', ['b'])
    const other = wire.addMembers('乙', ['x'])
    await other
    expect(seenWhileBlocked).toContain('乙') // cross-team ran in parallel
    expect(seenWhileBlocked).not.toContain('甲-second')
    releaseA?.()
    await first
    await queued
    expect(seenWhileBlocked).toContain('甲-second') // queued until the first settled
    expect(wire.hasPending()).toBe(false)
  })

  it('hasPending tracks in-flight work', async () => {
    const { f, wire } = fixture()
    expect(wire.hasPending()).toBe(false)
    const done = wire.addMembers('甲', ['a'])
    expect(wire.hasPending()).toBe(true)
    await f.respond(ok)
    await done
    expect(wire.hasPending()).toBe(false)
  })
})
