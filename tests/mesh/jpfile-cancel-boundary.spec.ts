/** #733 review R1: authenticated cancellation may stop work, but must not inject retired file chunks into the session. */
import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPrivateKey } from 'node:crypto'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { bootNode, reservePort, runContext } from './harness.ts'

it('does not deliver JPFILE-PART content through the signed claimed-task cancellation path', async () => {
  const pa = await reservePort(), pb = await reservePort(), au = 'http://127.0.0.1:' + pa, bu = 'http://127.0.0.1:' + pb
  const a = await bootNode({ name: 'part-cancel-A', session: 'part-cancel-A', team: 'alpha', port: pa, peers: [bu], silent: true, sessionNodes: true, teamScopeRouting: false, asyncNudgeDelayMs: 86_400_000 })
  const b = await bootNode({ name: 'part-cancel-B', session: 'part-cancel-B', team: 'beta', port: pb, peers: [au], silent: true, sessionNodes: true, teamScopeRouting: false, asyncNudgeDelayMs: 86_400_000 })
  const queued: any[] = [], stops: any[] = []
  b.agents.agent!.followup = message => { queued.push(message) }
  b.agents.agent!.steer = message => { stops.push(message) }
  try {
    for (const [n, zone] of [[a, 'alpha'], [b, 'beta']] as const) { const joinResult = await fetch(n.baseUrl + '/__dsh_a2a/join', { method: 'POST', body: JSON.stringify({ id: String(n.agents.agent!.id) }) }).then(r => r.json()); expect(joinResult.team).toBe(zone + '/01234567') }
    const sent = await a.ctx.tools.get('a2a_route')!.execute({ team: 'beta/01234567', message: 'ordinary task from its actual signed sender', async: true }, runContext(a.agents.agent)) as any
    expect(sent.ok).toBe(true)
    expect(queued).toHaveLength(1)
    const message = queued.shift()
    b.ctx.emit('agent/inbox/claimed', { agent: b.agents.agent!, message, turn: 1 })
    const target = bu + '/a2a/direct'
    const text = '[A2A cancel] (task ' + sent.task_id + ') If this task reaches you later from the queue, do not execute it.\n[JPFILE-PART v1] ' + JSON.stringify({ transfer_id: 'cancel-file', file_id: 'payload', part_i: 1, part_n: 1, payload: 'retired file content' })
    const body = JSON.stringify({ team: 'beta/01234567', caller_session: 'alpha/01234567', task_id: 'review-cancel-part', cancel_task_id: sent.task_id, message: text, wait: false })
    const privateKey = createPrivateKey(readFileSync(join(a.home, 'a2a/node-key.pem'), 'utf8'))
    const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signOriginClaim({ url: target, method: 'POST', body }, { caller: 'alpha', callerUrl: au, privateKey, unbound: false, now: Date.now() }) }, body })
    const answer = await response.json() as any
    const partsInSession = stops.filter(m => JSON.stringify(m.content).includes('[JPFILE-PART')).length
    expect(answer.steered).toBe(true) // the stop itself still lands
    expect(stops.some(m => JSON.stringify(m.content).includes(sent.task_id))).toBe(true)
    expect(partsInSession, JSON.stringify({ requirement: 'no retired file chunk body delivered by any wire path', httpStatus: response.status, code: answer.code, reason: answer.reason, delivered: answer.delivered, steered: answer.steered, cancellationStops: stops.length, partsInSession })).toBe(0)
  } finally { await b.dispose(); await a.dispose() }
})
