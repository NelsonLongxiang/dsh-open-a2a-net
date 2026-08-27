/**
 * Fault-reporter lifecycle tests — the regression net for the P0-1 incident
 * class (an empty catch burying real faults behind a healthy render loop).
 * Contract: the sink always shows the newest fault, the diagnostic log is
 * throttled to one line per window, and clear() hides the sink AND resets
 * the throttle so the next outage logs promptly.
 */
import { describe, expect, it } from 'vitest'
import { createFaultReporter } from '../nexus-stage/src/fault.ts'

function rig() {
  const shown: string[] = []
  let hidden = 0
  const logged: string[] = []
  let clock = 1_000
  const reporter = createFaultReporter(
    { show: m => shown.push(m), hide: () => { hidden += 1 } },
    m => logged.push(m),
    () => clock,
  )
  return {
    reporter,
    shown,
    get hidden() { return hidden },
    logged,
    advance: (ms: number) => { clock += ms },
  }
}

describe('fault reporter lifecycle', () => {
  it('always shows the newest fault but logs at most once per window', () => {
    const r = rig()
    r.reporter.fault('state 500 from host')
    r.reporter.fault('state 503 from host')
    expect(r.shown).toEqual(['state 500 from host', 'state 503 from host'])
    expect(r.logged).toEqual(['[nexus] state 500 from host'])
  })

  it('logs again once the throttle window has passed', () => {
    const r = rig()
    r.reporter.fault('first')
    r.advance(60_000)
    r.reporter.fault('second')
    expect(r.logged).toEqual(['[nexus] first', '[nexus] second'])
  })

  it('clear() hides the sink and resets the throttle clock', () => {
    const r = rig()
    r.reporter.fault('boom')
    r.reporter.clear()
    expect(r.hidden).toBe(1)
    r.reporter.fault('after reset')
    expect(r.shown.at(-1)).toBe('after reset')
    expect(r.logged).toEqual(['[nexus] boom', '[nexus] after reset'])
  })
})
