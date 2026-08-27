/**
 * Receipt delivery three-tier ladder (work-order P2 residual): caller lane →
 * owner mailbox escalation (once) → breadcrumb exhaustion. Owner-team calls
 * never escalate to themselves; both-lane failure stays a logged condition
 * while correlation/archive keep authoritative truth.
 */
import { describe, expect, it, vi } from 'vitest'
import { runReceiptLadder } from '../src/receipt-ladder.ts'

function harness(deliverBehavior: (team: string) => 'ok' | 'fail') {
  const delivered: string[] = []
  const logs: Array<{ stage: string; error: unknown }> = []
  const deps = {
    deliver: async (team: string) => {
      if (deliverBehavior(team) === 'fail') throw new Error(`lane down: ${team}`)
      delivered.push(team)
      return { routed: true }
    },
    ownerTeam: 'dsh',
    log: (stage: string, error: unknown) => {
      logs.push({ stage, error })
    },
  }
  return { deps, delivered, logs }
}

describe('receipt delivery ladder', () => {
  it('healthy caller lane delivers once and never escalates', async () => {
    const { deps, delivered, logs } = harness(team => (team === 'dsh/caller' ? 'ok' : 'fail'))
    await runReceiptLadder(deps, 'dsh/caller')
    expect(delivered).toEqual(['dsh/caller'])
    expect(logs).toHaveLength(0)
  })

  it('failed caller lane escalates exactly once to the owner mailbox', async () => {
    const { deps, delivered, logs } = harness(team => (team === 'dsh' ? 'ok' : 'fail'))
    await runReceiptLadder(deps, 'dsh/ghost')
    expect(delivered).toEqual(['dsh'])
    expect(logs).toEqual([{ stage: 'to dsh/ghost', error: expect.any(Error) }])
  })

  it('owner-team receipt that fails does NOT escalate to itself — single attempt, double-free', async () => {
    const { deps, delivered, logs } = harness(() => 'fail')
    await expect(runReceiptLadder(deps, 'dsh')).rejects.toThrow('lane down: dsh')
    expect(delivered).toEqual([])
    expect(logs).toEqual([{ stage: 'to dsh', error: expect.any(Error) }])
  })

  it('both lanes failing exhausts into two breadcrumbs and a swallowed rejection', async () => {
    const { deps, delivered, logs } = harness(team => (team === 'dsh' ? 'fail' : 'fail'))
    // caller='dsh/x' fails, then owner 'dsh' also fails.
    const deliver = deps.deliver
    void deliver
    await expect(runReceiptLadder(
      { ...deps, deliver: async team => { if (team !== 'dsh') throw new Error(`lane down: ${team}`); throw new Error('lane down: dsh') } },
      'dsh/x',
    )).rejects.toThrow()
    expect(logs.map(l => l.stage)).toEqual(['to dsh/x', 'to owner dsh', 'both lanes'])
    expect(delivered).toEqual([])
  })
})
