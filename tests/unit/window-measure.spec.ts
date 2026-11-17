/**
 * #64 step 2: the OriginClaim window measure keeps per-UTC-day counts on disk, so the 7-day zero streak survives a
 * restart; a day the host never ran ends the streak, a non-zero day ends it, and today never counts.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'
import { WINDOW_KEEP_DAYS, WindowMeasure } from '../../src/window-measure.ts'

const DAY = 86_400_000
const at = (iso: string): number => Date.parse(iso)
const file = (): string => join(mkdtempSync(join(tmpdir(), 'window-measure-')), 'a2a', 'origin-claim-window.json')

describe('OriginClaim window measure', () => {
  it('counts by UTC day and survives a restart', () => {
    const path = file()
    let now = at('2026-11-10T12:00:00Z')
    const first = new WindowMeasure(path, () => now)
    first.note('unbound'); first.note('boundMiss'); first.note('boundMiss')
    now += DAY
    const second = new WindowMeasure(path, () => now)
    const view = second.view()
    expect(view.since).toBe('2026-11-10')
    expect(view.days).toEqual([
      { day: '2026-11-11', legacy: 0, unbound: 0, boundMiss: 0 },
      { day: '2026-11-10', legacy: 0, unbound: 1, boundMiss: 2 },
    ])
    expect(view.zeroStreakDays).toBe(0)
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
    expect((JSON.parse(readFileSync(path, 'utf8')) as { days: unknown[] }).days).toHaveLength(WINDOW_KEEP_DAYS)
    writeFileSync(path, '{not json')
    const warnings: string[] = []
    const fresh = new WindowMeasure(path, () => now, message => warnings.push(message))
    expect(warnings.some(w => w.includes('unreadable'))).toBe(true)
    expect(fresh.view().days).toHaveLength(1)
  })
})
