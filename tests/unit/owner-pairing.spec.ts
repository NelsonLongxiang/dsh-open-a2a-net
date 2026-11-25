// @vitest-environment node
/** #933: device-code pairing for an owner delegate — the pure core (no route, no files). */
import { describe, expect, it } from 'vitest'
import { OwnerPairings, PAIRING_STARTS_PER_ADDRESS, PAIRING_START_WINDOW_MS, PAIRING_TTL_MS, PAIRINGS_PENDING_MAX, pairingCode } from '../../src/superagent/host/owner-pairing.ts'

function setup() {
  const clock = { ms: Date.parse('2026-11-25T22:00:00Z') }
  let n = 0
  const p = new OwnerPairings(() => clock.ms, () => { n++; return { id: `pair-${n}`, secret: `secret-${n}`, code: `AAAA-AAA${n}` } })
  let issued = 0
  const issue = () => { issued++; return { token: `dshod_token_${issued}`, id: `delegate-${issued}` } }
  return { p, clock, issue, issuedCount: () => issued }
}
const started = (out: ReturnType<OwnerPairings['start']>) => { if (!out.ok) throw new Error(out.error); return out }

describe('#933 owner pairing', () => {
  it('codes are XXXX-XXXX from an alphabet without look-alikes', () => {
    for (let i = 0; i < 50; i++) expect(pairingCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  })
  it('start → approve → one poll with the secret hands the token once; then not-found', () => {
    const t = setup()
    const s = started(t.p.start('client-a', 'laptop', 7))
    expect(s.expiresAt).toBe(new Date(t.clock.ms + PAIRING_TTL_MS).toISOString())
    expect(t.p.poll(s.id, s.secret, t.issue)).toMatchObject({ state: 'waiting' })
    expect(t.p.list()).toEqual([expect.objectContaining({ id: s.id, code: s.code, name: 'laptop', days: 7, state: 'waiting' })])
    expect(JSON.stringify(t.p.list())).not.toContain(s.secret)
    expect(t.p.approve(s.id)).toEqual({ ok: true })
    // Allowing issues nothing yet: the delegate is made when the terminal collects it.
    expect(t.issuedCount()).toBe(0)
    expect(JSON.stringify(t.p.list())).not.toContain('dshod_token_1')
    expect(t.p.poll(s.id, s.secret, t.issue)).toEqual({ state: 'approved', token: 'dshod_token_1', delegateId: 'delegate-1' })
    expect(t.p.poll(s.id, s.secret, t.issue)).toEqual({ state: 'not-found' })
  })
  it('a wrong or missing secret, or an unknown id, all answer not-found and do not consume the token', () => {
    const t = setup()
    const s = started(t.p.start('a', 'n', 1))
    t.p.approve(s.id)
    for (const [id, secret] of [[s.id, 'wrong'], [s.id, ''], [s.id, undefined], ['pair-x', s.secret], [undefined, s.secret]] as const) expect(t.p.poll(id, secret, t.issue)).toEqual({ state: 'not-found' })
    expect(t.issuedCount()).toBe(0)
    expect(t.p.poll(s.id, s.secret, t.issue)).toMatchObject({ state: 'approved' })
  })
  it('a refusal is told once to the terminal; a refused pairing cannot be approved', () => {
    const t = setup()
    const s = started(t.p.start('a', 'n', 1))
    expect(t.p.deny(s.id)).toEqual({ ok: true })
    expect(t.p.approve(s.id)).toMatchObject({ ok: false, code: 'not-found' })
    expect(t.issuedCount()).toBe(0)
    expect(t.p.poll(s.id, s.secret, t.issue)).toEqual({ state: 'denied' })
    expect(t.p.poll(s.id, s.secret, t.issue)).toEqual({ state: 'not-found' })
  })
  it('expiry: a waiting pairing expires, cannot be approved, and polls expired once', () => {
    const t = setup()
    const s = started(t.p.start('a', 'n', 1))
    t.clock.ms += PAIRING_TTL_MS
    expect(t.p.approve(s.id)).toMatchObject({ ok: false })
    expect(t.p.list()).toEqual([])
    expect(t.p.poll(s.id, s.secret, t.issue)).toEqual({ state: 'expired' })
    expect(t.p.poll(s.id, s.secret, t.issue)).toEqual({ state: 'not-found' })
  })
  it('an approved pairing nobody collected in time issued nothing, so nothing is left to revoke', () => {
    const t = setup()
    const s = started(t.p.start('a', 'n', 1))
    t.p.approve(s.id)
    t.clock.ms += PAIRING_TTL_MS
    t.p.sweep()
    expect(t.p.poll(s.id, s.secret, t.issue)).toEqual({ state: 'not-found' })
    expect(t.issuedCount()).toBe(0)
  })
  it('issuing that fails at collection keeps the pairing approved: the terminal is told to retry, then collects', () => {
    const t = setup()
    const s = started(t.p.start('a', 'n', 1))
    t.p.approve(s.id)
    expect(t.p.poll(s.id, s.secret, () => { throw new Error('disk full') })).toEqual({ state: 'retry', error: 'disk full' })
    expect(t.p.poll(s.id, s.secret, t.issue)).toMatchObject({ state: 'approved', token: 'dshod_token_1' })
    expect(t.p.poll(s.id, s.secret, t.issue)).toEqual({ state: 'not-found' })
    expect(t.issuedCount()).toBe(1)
  })
  it('at most PAIRINGS_PENDING_MAX wait at once; answering one frees a place', () => {
    const t = setup()
    const ids = Array.from({ length: PAIRINGS_PENDING_MAX }, (_, i) => started(t.p.start(`addr-${i}`, 'n', 1)).id)
    expect(t.p.start('addr-x', 'n', 1)).toMatchObject({ ok: false, code: 'busy' })
    t.p.deny(ids[0]!)
    expect(t.p.start('addr-x', 'n', 1)).toMatchObject({ ok: true })
  })
  it('one address may start only a few pairings per window', () => {
    const t = setup()
    for (let i = 0; i < PAIRING_STARTS_PER_ADDRESS; i++) { const s = started(t.p.start('same', 'n', 1)); t.p.deny(s.id) }
    expect(t.p.start('same', 'n', 1)).toMatchObject({ ok: false, code: 'rate' })
    expect(t.p.start('other', 'n', 1)).toMatchObject({ ok: true })
    t.clock.ms += PAIRING_START_WINDOW_MS + 1
    t.p.sweep()
    expect(t.p.start('same', 'n', 1)).toMatchObject({ ok: true })
  })
  it('validates the name and days', () => {
    const t = setup()
    for (const [name, days] of [['', 1], ['x'.repeat(81), 1], ['a\u0007b', 1], ['ok', 0], ['ok', 366], ['ok', 1.5], ['ok', '7']] as const) expect(t.p.start('a', name, days)).toMatchObject({ ok: false, code: 'input' })
    expect(started(t.p.start('a', ' 终端 ', undefined))).toMatchObject({ ok: true })
    expect(t.p.list()[0]).toMatchObject({ name: '终端', days: 30 })
  })
})
