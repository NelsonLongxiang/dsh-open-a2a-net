// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { OwnerReleases, type ReleaseHost, type ReleaseStorage } from '../../src/user-session-release.ts'
import { PromptIdempotency } from '../../src/user-sessions.ts'

const ID = 'session-0123456789abcdef'
const CREATOR = { id: 'delegate-a', name: 'Creator' }
const WITHDRAWER = { id: 'delegate-b', name: 'Withdrawer' }
const START = Date.parse('2026-01-01T00:00:00Z')
const MINUTE = 60_000

function fixture() {
  let now = START
  let disk: Parameters<ReleaseStorage['write']>[0] = []
  let failWrite: string | undefined
  let failAudit: string | undefined
  let authorized = true
  const steps: string[] = []
  const audits: Array<Readonly<Record<string, unknown>>> = []
  const agent = { status: 'idle', steer: vi.fn(() => { steps.push('steer') }), followup: vi.fn(() => { steps.push('followup') }) }
  const storage: ReleaseStorage = {
    read: () => structuredClone(disk),
    write: rows => {
      const state = rows.at(-1)?.state ?? 'empty'
      steps.push('disk:' + state)
      if (state === failWrite) throw new Error('write failure')
      disk = structuredClone(rows)
    },
  }
  const audit = (fields: Readonly<Record<string, unknown>>) => {
    const action = String(fields.action)
    steps.push('audit:' + action)
    if (action === failAudit) return false
    audits.push(fields)
    return true
  }
  const deps = {
    live: () => true, joined: () => true, archived: () => false, agent: () => agent,
    role: () => 'member' as const, taint: vi.fn(), idem: new PromptIdempotency(),
  }
  const host: ReleaseHost = { deps, now: () => now, delegateActive: () => authorized, auditTimer: audit, warn: vi.fn() }
  const store = new OwnerReleases(storage, host)
  const fields = { id: ID, text: 'private prompt', when: 'at:2026-01-01T00:05:00Z', then: 'queue' }
  return {
    store, audit, audits, steps, agent, deps, fields, host, storage,
    clock: (minutes: number) => { now = START + minutes * MINUTE },
    failWrite: (state?: string) => { failWrite = state },
    failAudit: (action?: string) => { failAudit = action },
    revoke: () => { authorized = false },
    restart: () => new OwnerReleases(storage, host),
    arm: (over: Record<string, unknown> = {}) => store.arm({ ...fields, ...over }, CREATOR, 'relay-taint', audit),
  }
}

function armId(f: ReturnType<typeof fixture>, over?: Record<string, unknown>): string {
  const result = f.arm(over)
  if (!result.ok) throw new Error(result.error)
  return result.release
}

describe('owner releases', () => {
  it('arms durably, fires after restart, and exposes metadata without prompt text', () => {
    const f = fixture()
    const id = armId(f, { request_id: 'replay' })
    expect(f.arm({ request_id: 'replay' })).toMatchObject({ release: id, replayed: true })
    expect(f.arm({ request_id: 'replay', then: 'steer' })).toMatchObject({ status: 409, code: 'request-id-conflict' })
    const restarted = f.restart()
    f.clock(5)
    restarted.tick()
    expect(f.steps).toEqual(['audit:release-arm', 'disk:armed', 'audit:fire-accepted', 'disk:releasing', 'followup', 'disk:released', 'audit:released'])
    expect(f.deps.taint).toHaveBeenCalledWith(ID)
    expect(restarted.list()).toMatchObject({ releases: [{ release: id, state: 'released' }] })
    expect(JSON.stringify(restarted.list())).not.toContain('private prompt')
    expect(JSON.stringify(f.storage.read())).not.toContain('private prompt')
    expect(JSON.stringify(f.audits)).not.toContain('private prompt')
  })

  it('separates the current withdraw actor from the creator', () => {
    const f = fixture()
    const id = armId(f)
    expect(f.store.withdraw(id, WITHDRAWER, f.audit)).toMatchObject({ state: 'withdrawn' })
    expect(f.audits.at(-1)).toMatchObject({ action: 'release-withdraw', actor: WITHDRAWER, armedBy: CREATOR })
    expect(f.store.withdraw(id, WITHDRAWER, f.audit)).toMatchObject({ status: 409, code: 'not-armed' })
    expect(f.store.withdraw('missing', WITHDRAWER, f.audit)).toMatchObject({ status: 404, code: 'no-release' })
    f.clock(5)
    f.store.tick()
    expect(f.agent.followup).not.toHaveBeenCalled()
  })

  it('cancels a revoked delegate, and does not audit an unacquired busy trigger attempt', () => {
    const f = fixture()
    armId(f, { then: 'trigger' })
    f.agent.status = 'running'
    f.clock(5)
    f.store.tick()
    expect(f.store.list()).toMatchObject({ releases: [{ state: 'armed' }] })
    expect(f.audits.map(row => row.action)).toEqual(['release-arm'])
    f.revoke()
    f.agent.status = 'idle'
    f.store.tick()
    expect(f.store.list()).toMatchObject({ releases: [{ state: 'cancelled', code: 'delegate-invalid' }] })
    expect(f.audits.at(-1)).toMatchObject({ action: 'release-cancelled', armedBy: CREATOR, authorized: false })
    expect(f.agent.steer).not.toHaveBeenCalled()
  })

  it('retries only an attempt that did not pass the acceptance and persistence gates', () => {
    const f = fixture()
    armId(f)
    f.clock(5)
    f.failAudit('fire-accepted')
    f.store.tick()
    expect(f.store.list()).toMatchObject({ releases: [{ state: 'armed' }] })
    expect(f.agent.followup).not.toHaveBeenCalled()
    f.failAudit()
    f.failWrite('releasing')
    f.store.tick()
    expect(f.audits.at(-1)).toMatchObject({ action: 'fire-aborted' })
    expect(f.store.list()).toMatchObject({ releases: [{ state: 'armed' }] })
    expect(f.agent.followup).not.toHaveBeenCalled()
    f.failWrite()
    f.store.tick()
    expect(f.agent.followup).toHaveBeenCalledOnce()
  })

  it('never repeats a delivery with an uncertain outcome', () => {
    const f = fixture()
    armId(f)
    f.agent.followup.mockImplementationOnce(() => { throw new Error('possible side effect') })
    f.clock(5)
    f.store.tick()
    expect(f.store.list()).toMatchObject({ releases: [{ state: 'unknown', code: 'deliver-failed' }] })
    const restarted = f.restart()
    restarted.tick()
    expect(f.agent.followup).toHaveBeenCalledOnce()
  })

  it('never delivers a persisted releasing entry after restart, even before the original callback ran', () => {
    const f = fixture()
    armId(f)
    const rows = f.storage.read() as Parameters<ReleaseStorage['write']>[0]
    f.storage.write(rows.map(row => ({ ...row, state: 'releasing' })) as typeof rows)
    f.clock(5)
    const restarted = f.restart()
    restarted.tick()
    expect(restarted.list()).toMatchObject({ releases: [{ state: 'unknown' }] })
    expect(f.agent.followup).not.toHaveBeenCalled()
  })

  it('keeps reported state tied to storage when terminal persistence or outcome auditing fails', () => {
    const f = fixture()
    armId(f)
    f.failWrite('released')
    f.clock(5)
    f.store.tick()
    expect(f.store.list()).toMatchObject({ releases: [{ state: 'releasing' }] })
    expect(f.audits.at(-1)).toMatchObject({ action: 'released', persisted: false })
    f.failWrite()
    const restarted = f.restart()
    restarted.tick()
    expect(restarted.list()).toMatchObject({ releases: [{ state: 'unknown' }] })
    expect(f.agent.followup).toHaveBeenCalledOnce()

    const g = fixture()
    armId(g)
    g.failAudit('released')
    g.clock(5)
    g.store.tick()
    g.store.tick()
    expect(g.store.list()).toMatchObject({ releases: [{ state: 'released' }] })
    expect(g.agent.followup).toHaveBeenCalledOnce()
    expect(g.host.warn).toHaveBeenCalled()
  })

  it('reports failed arm and withdraw writes and never exposes uncommitted state', () => {
    const f = fixture()
    f.failWrite('armed')
    expect(f.arm()).toMatchObject({ status: 503, code: 'not-saved' })
    expect(f.store.list()).toEqual({ ok: true, releases: [] })
    expect(f.audits.at(-1)).toMatchObject({ action: 'release-arm-failed' })
    f.failWrite()
    const id = armId(f)
    f.failWrite('withdrawn')
    expect(f.store.withdraw(id, WITHDRAWER, f.audit)).toMatchObject({ status: 503, code: 'not-saved' })
    expect(f.store.list()).toMatchObject({ releases: [{ state: 'armed' }] })
    expect(f.audits.at(-1)).toMatchObject({ action: 'withdraw-failed' })
  })

  it('enforces idle, absolute time, expiry and active count boundaries', () => {
    const f = fixture()
    for (const when of ['idle:9', 'idle:1441', 'at:2026-01-01T00:04:00Z', 'at:2026-01-08T00:00:01Z']) {
      expect(f.arm({ when })).toMatchObject({ code: 'when' })
    }
    expect(f.arm({ expires_hours: 0 })).toMatchObject({ code: 'expires' })
    expect(f.arm({ when: 'at:2026-01-01T01:00:00Z', expires_hours: 1 })).toMatchObject({ code: 'when' })
    expect(f.arm({ when: 'at:2026-01-08T00:00:00Z', expires_hours: 168 })).toMatchObject({ code: 'when' })
    expect(f.arm({ when: 'at:2026-01-07T23:59:59Z', expires_hours: 168 }).ok).toBe(true)
    for (const when of ['idle:10', 'idle:1440', f.fields.when]) expect(f.arm({ when }).ok).toBe(true)
    armId(f)
    expect(f.arm()).toMatchObject({ status: 409, code: 'full' })
  })

  it('expires before an idle release can reach its attempt gate at the same instant', () => {
    const f = fixture()
    armId(f, { when: 'idle:10', expires_hours: 1 / 6 })
    f.store.tick()
    f.clock(10)
    f.store.tick()
    expect(f.store.list()).toMatchObject({ releases: [{ state: 'expired' }] })
    expect(f.agent.followup).not.toHaveBeenCalled()
    expect(f.audits.map(row => row.action)).toEqual(['release-arm', 'release-expired'])
  })

  it('rechecks idle when an earlier release wakes the target in the same tick', () => {
    const f = fixture()
    armId(f, { when: 'idle:10' })
    armId(f, { when: 'idle:10' })
    f.agent.followup.mockImplementationOnce(() => { f.agent.status = 'running' })
    f.store.tick()
    f.clock(10)
    f.store.tick()
    expect(f.agent.followup).toHaveBeenCalledOnce()
    expect(f.store.list()).toMatchObject({ releases: [{ state: 'released' }, { state: 'armed' }] })
  })

  it('starts idle timing again after a status change or a restart', () => {
    const f = fixture()
    armId(f, { when: 'idle:10' })
    f.store.tick()
    f.clock(9)
    f.store.noteStatus(ID)
    f.store.tick()
    f.clock(18)
    f.store.tick()
    expect(f.agent.followup).not.toHaveBeenCalled()
    const restarted = f.restart()
    restarted.tick()
    f.clock(27)
    restarted.tick()
    expect(f.agent.followup).not.toHaveBeenCalled()
    f.clock(28)
    restarted.tick()
    expect(f.agent.followup).toHaveBeenCalledOnce()
  })
})
