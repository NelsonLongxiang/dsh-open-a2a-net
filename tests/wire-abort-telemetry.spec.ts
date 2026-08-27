/**
 * Outbound wait-window telemetry (A2aRouteError.abortElapsedMs +
 * ownBudgetExhausted): whose budget ended the route, measured instead of
 * guessed — the instrument the await-abort signature asked for.
 */
import { describe, expect, it } from 'vitest'
import { A2aClient, type A2aFetch, type A2aSchedule } from '../src/a2a-client.ts'

/** Fetch that never answers until its abort signal fires. */
function hangingFetch(): A2aFetch {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')), { once: true })
    })
}

/** Schedule seam exposing the armed own-timeout callback for manual firing. */
function firableSchedule(): { schedule: A2aSchedule; fire: () => void } {
  let fireOwn: (() => void) | undefined
  const schedule: A2aSchedule = callback => {
    fireOwn = callback
    return () => undefined
  }
  return { schedule, fire: () => fireOwn?.() }
}

function client(schedule: A2aSchedule, fetch: A2aFetch): A2aClient {
  return new A2aClient({ apiKey: '', sessionId: 'telemetry', schedule, fetch })
}

describe('outbound abort telemetry', () => {
  it('own budget firing: error carries abortElapsedMs + ownBudgetExhausted=true', async () => {
    const { schedule, fire } = firableSchedule()
    const subject = client(schedule, hangingFetch())
    const pending = subject.routeDirect('http://peer.example', 'dsh', 'slow target')
    // Let dispatch settle, then end the wait the way our own timer would.
    await Promise.resolve()
    fire()
    const result = await pending
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(-32000)
      expect(result.ownBudgetExhausted).toBe(true)
      expect(result.abortElapsedMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('caller pre-abort: telemetry present but ownBudgetExhausted stays unset', async () => {
    const { schedule } = firableSchedule()
    const signal = new AbortController().signal
    // Pre-aborted: the controller is dead before routeDirect is even called.
    Object.defineProperty(signal, 'aborted', { value: true })
    const subject = client(schedule, hangingFetch())
    const result = await subject.routeDirect('http://peer.example', 'dsh', 'x', undefined, signal)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.abortElapsedMs).toBeLessThan(50)
      expect(result.ownBudgetExhausted).toBeUndefined()
    }
  })

  it('happy path carries no telemetry fields at all', async () => {
    const fetch: A2aFetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ result: 'ok', task_id: 't', context_id: 'c' }),
      })
    const subject = client(firableSchedule().schedule, fetch)
    const result = await subject.routeDirect('http://peer.example', 'dsh', 'quick one')
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect('abortElapsedMs' in result).toBe(false)
    expect('ownBudgetExhausted' in result).toBe(false)
  })
})
