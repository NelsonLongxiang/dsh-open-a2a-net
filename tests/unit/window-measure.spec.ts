/**
 * #64 step 2: the OriginClaim window measure keeps per-UTC-day counts on disk, so the 7-day zero streak survives a
 * restart; a day the host never ran ends the streak, a non-zero day ends it, and today never counts. Unknown is never
 * zero (#727 review R1/R2): a damaged record, a write that never landed, or a run that did not end cleanly all end the
 * streak instead of certifying it.
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'
import { WINDOW_KEEP_DAYS, WindowMeasure } from '../../src/window-measure.ts'

const DAY = 86_400_000
const at = (iso: string): number => Date.parse(iso)
const file = (): string => join(mkdtempSync(join(tmpdir(), 'window-measure-')), 'a2a', 'origin-claim-window.json')
const zero = (day: string) => ({ day, legacy: 0, unbound: 0, boundMiss: 0 })
const firstSix = () => Array.from({ length: 6 }, (_, i) => zero('2026-11-' + String(i + 1).padStart(2, '0')))
// A clean previous run whose last record is two minutes before the 2026-11-07T12:00Z boot the tests use: a covered restart.
const seed = (path: string, days: unknown[], run: unknown = { since: '2026-11-01', clean: true, lastSeenAt: Date.parse('2026-11-07T11:58:00Z') }) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify({ run, days }))
}
const onDisk = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as { run: { since: string; clean: boolean }; days: Array<{ day: string; unbound: number; invalid?: true }> }

describe('OriginClaim window measure', () => {
  it('counts by UTC day and survives a short restart; the first boot day is only partly measured', () => {
    const path = file()
    let now = at('2026-11-10T12:00:00Z')
    const first = new WindowMeasure(path, () => now)
    first.note('unbound'); first.note('boundMiss'); first.note('boundMiss')
    first.close()
    now += 2 * 60_000
    const view = new WindowMeasure(path, () => now).view()
    expect(view.since).toBe('2026-11-10')
    expect(view.persisted).toBe(true)
    expect(view.days).toEqual([{ day: '2026-11-10', legacy: 0, unbound: 1, boundMiss: 2, invalid: true }])
  })

  it('a short restart keeps the streak; a long gap marks its days invalid', () => {
    const path = file()
    let now = at('2026-11-01T12:00:00Z')
    const m = new WindowMeasure(path, () => now)
    for (let i = 0; i < 8; i++) { now += DAY; m.touch() }
    m.close()
    now += 2 * 60_000
    const restarted = new WindowMeasure(path, () => now)
    expect(restarted.view().zeroStreakDays).toBe(7)
    restarted.close()
    now += DAY
    const afterGap = new WindowMeasure(path, () => now)
    expect(afterGap.view().days.slice(0, 2).every(d => d.invalid === true)).toBe(true)
    expect(afterGap.view().zeroStreakDays).toBe(0)
  })

  it('re-review R2: a run whose first marker never reached disk cannot leave the previous clean marker vouching for it', () => {
    const path = file()
    let now = at('2026-11-01T12:00:00Z')
    const prior = new WindowMeasure(path, () => now)
    for (let day = 0; day < 6; day++) { now += DAY; prior.touch() }
    prior.close()
    expect(onDisk(path).run.clean).toBe(true)
    const blocked = `${path}.${String(process.pid)}.tmp`
    mkdirSync(blocked) // only this test's own temporary-file path: even the new run's first write fails
    const active = new WindowMeasure(path, () => now)
    expect(active.view().persisted).toBe(false)
    active.note('unbound')
    active.close()
    expect(onDisk(path).run.clean).toBe(true) // the failed run left nothing behind
    rmdirSync(blocked)
    now += DAY
    const next = new WindowMeasure(path, () => now)
    expect(next.view().persisted).toBe(true)
    expect(next.view().zeroStreakDays).toBeLessThan(7)
    expect(next.view().days.find(d => d.day === '2026-11-07')?.invalid).toBe(true)
  })

  it('streak = whole days before today that the host ran with all counts at zero', () => {
    const path = file()
    let now = at('2026-11-01T08:00:00Z')
    const m = new WindowMeasure(path, () => now)
    m.note('legacy')
    for (let i = 0; i < 8; i++) { now += DAY; m.touch() }
    m.note('unbound') // today (11-09) is not a whole day yet: it does not count either way
    expect(m.view().zeroStreakDays).toBe(7)
  })

  it('a day the host never ran ends the streak (a gap is not a zero day)', () => {
    const path = file()
    let now = at('2026-11-01T08:00:00Z')
    const m = new WindowMeasure(path, () => now)
    now += DAY; m.touch()
    now += 3 * DAY; m.touch() // 11-02 and 11-03 had no run
    now += DAY; m.touch()
    expect(m.view().zeroStreakDays).toBe(1)
  })

  it('keeps at most WINDOW_KEEP_DAYS buckets on disk and starts empty on a corrupt file', () => {
    const path = file()
    let now = at('2026-10-01T00:00:00Z')
    const m = new WindowMeasure(path, () => now)
    for (let i = 0; i < WINDOW_KEEP_DAYS + 5; i++) { now += DAY; m.touch() }
    expect(onDisk(path).days).toHaveLength(WINDOW_KEEP_DAYS)
    writeFileSync(path, '{not json')
    const warnings: string[] = []
    const fresh = new WindowMeasure(path, () => now, message => warnings.push(message))
    expect(warnings.some(w => w.includes('unreadable'))).toBe(true)
    expect(fresh.view().days).toHaveLength(1)
  })

  it('R1: a damaged or incomplete record is unknown, never a zero day', () => {
    for (const damaged of [{ day: '2026-11-07', legacy: 0, unbound: '1', boundMiss: 0 }, { day: '2026-11-07', legacy: 0, boundMiss: 0 }, { day: '2026-11-07', legacy: -1, unbound: 0, boundMiss: 0 }]) {
      const path = file()
      seed(path, [...firstSix(), damaged])
      const warnings: string[] = []
      const m = new WindowMeasure(path, () => at('2026-11-08T12:00:00Z'), message => warnings.push(message))
      expect(m.view().zeroStreakDays).toBe(0)
      expect(m.view().days.find(d => d.day === '2026-11-07')?.invalid).toBe(true)
      expect(warnings.some(w => w.includes('damaged'))).toBe(true)
      expect(onDisk(path).days.find(d => d.day === '2026-11-07')?.invalid).toBe(true)
    }
  })

  it('R1: a valid historical non-zero count is kept as is', () => {
    const path = file()
    seed(path, [...firstSix(), { day: '2026-11-07', legacy: 0, unbound: 2, boundMiss: 1 }], { since: '2026-11-01', clean: true, lastSeenAt: at('2026-11-08T11:58:00Z') })
    const m = new WindowMeasure(path, () => at('2026-11-08T12:00:00Z'))
    expect(m.view().days.find(d => d.day === '2026-11-07')).toEqual({ day: '2026-11-07', legacy: 0, unbound: 2, boundMiss: 1 })
  })

  it('R2: a failed non-zero write is retried by the hourly touch and survives the restart', () => {
    const path = file()
    seed(path, firstSix())
    let now = at('2026-11-07T12:00:00Z')
    const warnings: string[] = []
    const m = new WindowMeasure(path, () => now, message => warnings.push(message))
    const blocked = `${path}.${String(process.pid)}.tmp`
    mkdirSync(blocked) // only this test's own temporary-file path: one deterministic write failure
    m.note('unbound')
    expect(warnings.some(w => w.includes('not written'))).toBe(true)
    expect(m.view().persisted).toBe(false)
    expect(onDisk(path).days.find(d => d.day === '2026-11-07')?.unbound).toBe(0)
    rmdirSync(blocked)
    m.touch()
    expect(m.view().persisted).toBe(true)
    expect(onDisk(path).days.find(d => d.day === '2026-11-07')?.unbound).toBe(1)
    m.close()
    now += DAY
    expect(new WindowMeasure(path, () => now).view().zeroStreakDays).toBe(0)
  })

  it('R2: a run that ends with a write still failing marks its days invalid on the next boot', () => {
    const path = file()
    seed(path, firstSix())
    let now = at('2026-11-07T12:00:00Z')
    const m = new WindowMeasure(path, () => now)
    const blocked = `${path}.${String(process.pid)}.tmp`
    mkdirSync(blocked)
    m.note('unbound')
    m.close() // still failing: the run stays unclean on disk
    expect(onDisk(path).run.clean).toBe(false)
    rmdirSync(blocked)
    now += DAY
    const warnings: string[] = []
    const next = new WindowMeasure(path, () => now, message => warnings.push(message))
    expect(next.view().zeroStreakDays).toBe(0)
    expect(next.view().days.find(d => d.day === '2026-11-07')?.invalid).toBe(true)
    expect(warnings.some(w => w.includes('did not end cleanly'))).toBe(true)
  })

  it('a crashed run (never closed) invalidates its days; days of earlier clean runs keep counting', () => {
    const path = file()
    seed(path, firstSix(), { since: '2026-11-01', clean: true })
    let now = at('2026-11-07T12:00:00Z')
    new WindowMeasure(path, () => now) // boots 11-07 and crashes without close()
    now += DAY
    const next = new WindowMeasure(path, () => now)
    expect(next.view().days.find(d => d.day === '2026-11-07')?.invalid).toBe(true)
    expect(next.view().days.find(d => d.day === '2026-11-06')?.invalid).toBeUndefined()
    expect(next.view().zeroStreakDays).toBe(0)
  })
})
