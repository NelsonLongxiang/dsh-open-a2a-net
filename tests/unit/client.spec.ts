/**
 * Decentralized client unit tests: card fetch verification, direct-route
 * request/response shapes, the caller-identity override, the API-key header,
 * and HTTP timeout/cancellation — all against injected fetch/schedule seams.
 */
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { A2aClient, type A2aFetch } from '../../src/a2a-client.ts'
import { signCard } from '../../src/card.ts'
import { receiptFailure } from '../../src/receipt-retry.ts'
import { isLinkKey, normalizeLinkKeys, outboundKeyFor } from '../../src/link-keys.ts'


/** One stubbed fetch invocation. */
interface StubCall {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body?: string
  readonly signal?: AbortSignal
}

type StubHandler = (call: StubCall) => { status: number; body: unknown }

function stubFetch(handler: StubHandler): { calls: StubCall[]; fetch: A2aFetch } {
  const calls: StubCall[] = []
  const fetch: A2aFetch = (url, init) => {
    const call: StubCall = {
      url,
      method: init.method,
      headers: init.headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
      ...(init.signal !== undefined ? { signal: init.signal } : {}),
    }
    calls.push(call)
    const result = handler(call)
    return Promise.resolve({
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      text: async () => JSON.stringify(result.body),
    })
  }
  return { calls, fetch }
}

/** The immediate schedule: callbacks fire at once, disposal is a no-op. */
const immediateSchedule = (callback: () => void): (() => void) => {
  callback()
  return () => {}
}

/** A never-firing schedule with recorded arm/dispose pairs. */
interface FrozenSchedule {
  arm: (callback: () => void, delayMs: number) => () => void
  armed: Array<{ callback: () => void; delayMs: number }>
}

function frozenSchedule(): FrozenSchedule {
  const armed: Array<{ callback: () => void; delayMs: number }> = []
  return {
    armed,
    arm: (callback, delayMs) => {
      armed.push({ callback, delayMs })
      return () => {
        const at = armed.findIndex(entry => entry.callback === callback)
        if (at >= 0) armed.splice(at, 1)
      }
    },
  }
}

function makeClient(overrides: Partial<ConstructorParameters<typeof A2aClient>[0]> = {}): A2aClient {
  return new A2aClient({
    apiKey: '',
    sessionId: 'sess-1',
    schedule: immediateSchedule,
    fetch: (url, init) => globalThis.fetch(url, init),
    ...overrides,
  })
}

/** A freshly signed card for the OK path. */
function freshCard(): ReturnType<typeof signCard> {
  const { privateKey } = generateKeyPairSync('ed25519')
  return signCard({ name: 'peer', session: 'sess-9', team: 'research', capabilities: {}, expiresAt: Date.now() + 60_000 }, privateKey)
}

describe('fetchCard', () => {
  it('returns the verified card from a reachable peer', async () => {
    const card = freshCard()
    const { calls, fetch } = stubFetch(() => ({ status: 200, body: card }))
    const client = makeClient({ fetch })
    await expect(client.fetchCard('http://peer:1')).resolves.toMatchObject({ team: 'research' })
    expect(calls[0]?.url).toBe('http://peer:1/.well-known/agent-card.json')
    expect(calls[0]?.method).toBe('GET')
  })

  it('returns undefined for an unreachable peer, an HTTP error, or a rejected card', async () => {
    const failing: A2aFetch = () => Promise.reject(new Error('down'))
    await expect(makeClient({ fetch: failing }).fetchCard('http://gone:1')).resolves.toBeUndefined()
    const { fetch: errorFetch } = stubFetch(() => ({ status: 500, body: { error: 'boom' } }))
    await expect(makeClient({ fetch: errorFetch }).fetchCard('http://err:1')).resolves.toBeUndefined()
    const expired = (() => {
      const { privateKey } = generateKeyPairSync('ed25519')
      return signCard({ name: 'peer', session: 's', team: 't', capabilities: {}, expiresAt: Date.now() - 1 }, privateKey)
    })()
    const { fetch: staleFetch } = stubFetch(() => ({ status: 200, body: expired }))
    await expect(makeClient({ fetch: staleFetch }).fetchCard('http://stale:1')).resolves.toBeUndefined()
  })

  it('passes the sessionTeams listing through with the card', async () => {
    const card = { ...freshCard(), sessionTeams: [{ team: 'dsh/abcd1234', name: 'Porting', description: 'porting the parser' }] }
    const { fetch } = stubFetch(() => ({ status: 200, body: card }))
    await expect(makeClient({ fetch }).fetchCard('http://peer:1')).resolves.toMatchObject({
      sessionTeams: [{ team: 'dsh/abcd1234', name: 'Porting', description: 'porting the parser' }],
    })
  })
})

describe('fetchCardDetail', () => {
  it('classifies a transport or HTTP failure as unreachable with the detail', async () => {
    const failing: A2aFetch = () => Promise.reject(new Error('ECONNREFUSED down'))
    await expect(makeClient({ fetch: failing }).fetchCardDetail('http://gone:1')).resolves.toEqual({
      ok: false,
      stage: 'unreachable',
      detail: expect.stringContaining('ECONNREFUSED'),
    })
    const { fetch: errorFetch } = stubFetch(() => ({ status: 503, body: { error: 'boom' } }))
    await expect(makeClient({ fetch: errorFetch }).fetchCardDetail('http://err:1')).resolves.toMatchObject({
      ok: false,
      stage: 'unreachable',
    })
  })

  it('classifies verification failures with the card rejection reason', async () => {
    const expired = (() => {
      const { privateKey } = generateKeyPairSync('ed25519')
      return signCard({ name: 'peer', session: 's', team: 't', capabilities: {}, expiresAt: Date.now() - 1 }, privateKey)
    })()
    const { fetch } = stubFetch(() => ({ status: 200, body: expired }))
    await expect(makeClient({ fetch }).fetchCardDetail('http://stale:1')).resolves.toEqual({
      ok: false,
      stage: 'rejected',
      reason: 'expired',
    })
  })

  it('returns the verified card on the ok path', async () => {
    const card = freshCard()
    const { fetch } = stubFetch(() => ({ status: 200, body: card }))
    await expect(makeClient({ fetch }).fetchCardDetail('http://peer:1')).resolves.toMatchObject({
      ok: true,
      card: { team: 'research' },
    })
  })
})

describe('routeDirect', () => {
  it('preserves accepted receiver bookkeeping failure and warns the tool caller to reconcile',async()=>{
    const f=stubFetch(()=>({status:200,body:{routed:true,delivered:true,task_id:'work',task_status:'TASK_STATE_DELIVERED',receiverBookkeeping:'failed'}}))
    const result=await makeClient({fetch:f.fetch,schedule:frozenSchedule().arm}).routeDirect('https://peer.invalid','beta/aaaaaaaa','work',undefined,undefined,undefined,true)
    expect(result).toMatchObject({ok:true,receiverBookkeeping:'failed',task_status:'TASK_STATE_DELIVERED'});if(result.ok)expect(result.reply).toContain('不要重派')
  })

  it.each([
    [503,{error:'task ledger write failed; settlement was not committed'},true],
    [503,{error:'service unavailable'},false],
    [200,{error:'verification incomplete',code:-32011},true],
    [403,{error:'authorization mismatch'},false],
    [200,{error:'unknown task',code:-32000},false],
  ] as const)('classifies receipt retry evidence for HTTP %s',async(status,body,transient)=>{
    const f=stubFetch(()=>({status,body})),client=makeClient({fetch:f.fetch,schedule:frozenSchedule().arm})
    const result=await client.routeDirect('https://peer.invalid','team','receipt',undefined,undefined,undefined,true)
    expect(result.ok).toBe(false);if(!result.ok)expect(receiptFailure(result).transient).toBe(transient)
  })
  it.each([new TypeError('fetch failed'),Object.assign(Error('timeout'),{name:'TimeoutError'}),Object.assign(Error('connect failed'),{code:'ECONNREFUSED'})])('classifies connection and timeout failures for receipt recovery',async error=>{
    const client=makeClient({fetch:async()=>{throw error},schedule:frozenSchedule().arm}),result=await client.routeDirect('https://peer.invalid','team','receipt',undefined,undefined,undefined,true)
    expect(result.ok).toBe(false);if(!result.ok)expect(receiptFailure(result).transient).toBe(true)
  })

  it('sends the canonical args and returns the canonical result', async () => {
    const { calls, fetch } = stubFetch(() => ({ status: 200, body: { routed: true, task_id: 't-1', context_id: 'ctx-1', task_status: 'TASK_STATE_COMPLETED', result: { text: 'reply body' } } }))
    const client = makeClient({ fetch })
    await expect(client.routeDirect('http://peer:1', 'research', 'hello', 'ctx-0')).resolves.toEqual({
      ok: true,
      team: 'research',
      reply: 'reply body',
      task_id: 't-1',
      context_id: 'ctx-1',
      task_status: 'TASK_STATE_COMPLETED',
    })
    const body = JSON.parse(calls[0]?.body ?? '{}') as Record<string, string>
    expect(body).toEqual({ team: 'research', message: 'hello', context_id: 'ctx-0', caller_session: 'sess-1' })
    expect(calls[0]?.url).toBe('http://peer:1/a2a/direct')
  })

  it('encodes string and object results, and stringifies anything else', async () => {
    const { fetch } = stubFetch(() => ({ status: 200, body: { result: 'plain text' } }))
    await expect(makeClient({ fetch }).routeDirect('http://p:1', 't', 'm')).resolves.toMatchObject({ reply: 'plain text' })
    const { fetch: objectFetch } = stubFetch(() => ({ status: 200, body: { result: { text: 'wrapped' } } }))
    await expect(makeClient({ fetch: objectFetch }).routeDirect('http://p:1', 't', 'm')).resolves.toMatchObject({ reply: 'wrapped' })
    const { fetch: nullFetch } = stubFetch(() => ({ status: 200, body: { result: null } }))
    await expect(makeClient({ fetch: nullFetch }).routeDirect('http://p:1', 't', 'm')).resolves.toMatchObject({ reply: '""' })
  })

  it('falls back to the caller-born task id when a sync answer echoes none', async () => {
    const { fetch } = stubFetch(() => ({ status: 200, body: { result: 'reply body' } }))
    await expect(makeClient({ fetch }).routeDirect('http://p:1', 't', 'm', undefined, undefined, undefined, false, 't-9')).resolves.toMatchObject({ task_id: 't-9' })
    // Without a caller id either, the absent echo stays empty.
    await expect(makeClient({ fetch }).routeDirect('http://p:1', 't', 'm')).resolves.toMatchObject({ task_id: '' })
  })

  it('returns an explicit failure for a peer error answer', async () => {
    const { fetch } = stubFetch(() => ({ status: 200, body: { error: 'no live agent', code: -32000 } }))
    await expect(makeClient({ fetch }).routeDirect('http://p:1', 't', 'm')).resolves.toEqual({
      ok: false,
      error: 'no live agent',
      code: -32000,
    })
  })

  it('stringifies a non-string error member', async () => {
    const { fetch } = stubFetch(() => ({ status: 200, body: { error: { detail: 'boom' }, code: -32000 } }))
    await expect(makeClient({ fetch }).routeDirect('http://p:1', 't', 'm')).resolves.toEqual({
      ok: false,
      error: JSON.stringify({ detail: 'boom' }),
      code: -32000,
    })
  })

  it('wraps transport failures as -32000', async () => {
    const failing: A2aFetch = () => Promise.reject(new Error('ECONNREFUSED'))
    await expect(makeClient({ fetch: failing }).routeDirect('http://p:1', 't', 'm')).resolves.toMatchObject({ ok: false, code: -32000 })
  })

  it('answers a sync wait-budget timeout as DELIVERED-UNSETTLED (-32005), not failed', async () => {
    // F1 (t-mth5gmxy): the 15s budget firing does not mean the peer failed —
    // the delivery landed and the peer keeps executing. The honest shape is
    // -32005 with the task id and a no-blind-redispatch instruction.
    const frozen = frozenSchedule()
    const slow: A2aFetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
    const client = new A2aClient({ apiKey: '', sessionId: 's', schedule: frozen.arm, fetch: slow })
    const pending = client.routeDirect('http://p:1', 't', 'm', undefined, undefined, undefined, false, 'task-77')
    frozen.armed[0]?.callback()
    const result = await pending
    expect(result.ok).toBe(false)
    expect(result.code).toBe(-32005)
    expect(result.task_id).toBe('task-77')
    expect(result.error).toContain('do NOT re-dispatch')
  })

  it('stamps the calling session label over the node label', async () => {
    const { calls, fetch } = stubFetch(() => ({ status: 200, body: { result: { text: 'ok' } } }))
    await makeClient({ fetch }).routeDirect('http://p:1', 't', 'm', undefined, undefined, 'sess-1-agent-1')
    const body = JSON.parse(calls[0]?.body ?? '{}') as Record<string, string>
    expect(body.caller_session).toBe('sess-1-agent-1')
  })

  it('sends the X-API-Key header when configured', async () => {
    const { calls, fetch } = stubFetch(() => ({ status: 200, body: { result: { text: 'ok' } } }))
    await makeClient({ apiKey: 'sekrit', fetch }).routeDirect('http://p:1', 't', 'm')
    expect(calls[0]?.headers['X-API-Key']).toBe('sekrit')
    expect(calls[0]?.headers['Content-Type']).toBe('application/json')
  })

  it('#317 sends a link key to its own peer and the apiKey everywhere else', async () => {
    const { calls, fetch } = stubFetch(() => ({ status: 200, body: { result: { text: 'ok' } } }))
    const client = makeClient({ fetch, apiKey: 'fleet', apiKeyFor: url => outboundKeyFor(url, normalizeLinkKeys({ 'https://vps.example': 'link' }), 'fleet') })
    await client.routeDirect('https://vps.example', 't', 'm')
    await client.routeDirect('http://p:1', 't', 'm')
    expect(calls.map(call => call.headers['X-API-Key'])).toEqual(['link', 'fleet'])
  })
})

describe('http seam', () => {
  it('aborts before dispatch when the caller signal is already aborted', async () => {
    const { calls, fetch } = stubFetch(() => ({ status: 200, body: {} }))
    const controller = new AbortController()
    controller.abort()
    await expect(makeClient({ fetch }).routeDirect('http://p:1', 't', 'm', undefined, controller.signal)).resolves.toMatchObject({ ok: false, code: -32000 })
    expect(calls).toHaveLength(0)
  })

  it('times out through the schedule seam', async () => {
    const frozen = frozenSchedule()
    const slow: A2aFetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
    const client = new A2aClient({ apiKey: '', sessionId: 's', schedule: frozen.arm, fetch: slow })
    const pending = client.routeDirect('http://p:1', 't', 'm')
    expect(frozen.armed.length).toBe(1)
    frozen.armed[0]?.callback()
    // Sync + no caller task id: still the honest DELIVERED-UNSETTLED shape.
    await expect(pending).resolves.toMatchObject({ ok: false, code: -32005 })
  })

  it('rejects a non-2xx answer with the body excerpt', async () => {
    const { fetch } = stubFetch(() => ({ status: 503, body: { error: 'maintenance' } }))
    await expect(makeClient({ fetch }).fetchCard('http://p:1')).resolves.toBeUndefined()
  })
})

describe('http abort propagation', () => {
  it('forwards a mid-flight caller abort to the fetch seam', async () => {
    const frozen = frozenSchedule()
    const seen: Array<{ aborted: boolean }> = []
    const hanging: A2aFetch = (_url, init) => new Promise((_resolve, reject) => {
      seen.push({ aborted: init.signal?.aborted ?? false })
      init.signal?.addEventListener('abort', () => { reject(new Error('caller aborted')) })
    })
    const client = new A2aClient({ apiKey: '', sessionId: 's', schedule: frozen.arm, fetch: hanging })
    const controller = new AbortController()
    const pending = client.routeDirect('http://p:1', 't', 'm', undefined, controller.signal)
    controller.abort()
    await expect(pending).resolves.toMatchObject({ ok: false, code: -32000 })
    expect(seen[0]?.aborted).toBe(false)
  })
})

describe('error code absence', () => {
  it('omits the code when the peer error carries none', async () => {
    const { fetch } = stubFetch(() => ({ status: 200, body: { error: 'plain failure' } }))
    await expect(makeClient({ fetch }).routeDirect('http://p:1', 't', 'm')).resolves.toEqual({ ok: false, error: 'plain failure' })
  })
})

describe('queryOutcome (W7 slice 2)', () => {
  it('posts the task id + fingerprint to /a2a/query and parses the four states', async () => {
    const { calls, fetch } = stubFetch(() => ({ status: 200, body: { found: true, status: 'completed', reply: 'the product', settled_at: '2026-08-29T00:00:00.000Z', task_id: 't-1' } }))
    const client = makeClient({ fetch })
    const answer = await client.queryOutcome('http://peer', 't-1', 'fprint')
    expect(answer).toEqual({ found: true, status: 'completed', reply: 'the product', settledAt: '2026-08-29T00:00:00.000Z' })
    expect(calls[0].url).toBe('http://peer/a2a/query')
    expect(JSON.parse(String(calls[0].body))).toEqual({ task_id: 't-1', fingerprint: 'fprint' })
    const failed = await makeClient({ fetch: stubFetch(() => ({ status: 200, body: { found: true, status: 'failed', error: 'boom prose', settled_at: '2026-08-29T01:00:00.000Z', truncated: true, task_id: 't-2' } })).fetch })
      .queryOutcome('http://peer', 't-2', 'fprint')
    expect(failed).toEqual({ found: true, status: 'failed', error: 'boom prose', settledAt: '2026-08-29T01:00:00.000Z', truncated: true })
    const pending = await makeClient({ fetch: stubFetch(() => ({ status: 200, body: { found: true, status: 'pending', task_id: 't-3' } })).fetch })
      .queryOutcome('http://peer', 't-3', 'fprint')
    expect(pending).toEqual({ found: true, status: 'pending' })
    const negative = await makeClient({ fetch: stubFetch(() => ({ status: 200, body: { found: false, reason: 'payload-mismatch', task_id: 't-4' } })).fetch })
      .queryOutcome('http://peer', 't-4', 'fprint')
    expect(negative).toEqual({ found: false, reason: 'payload-mismatch' })
  })

  it('degrades every transport failure, HTTP error, and malformed body to undefined', async () => {
    const rejecting = makeClient({ fetch: () => Promise.reject(new Error('network down')) })
    await expect(rejecting.queryOutcome('http://peer', 't-1', 'fprint')).resolves.toBeUndefined()
    const httpError = makeClient({ fetch: stubFetch(() => ({ status: 404, body: { error: 'no route' } })).fetch })
    await expect(httpError.queryOutcome('http://peer', 't-1', 'fprint')).resolves.toBeUndefined()
    const garbage = makeClient({ fetch: stubFetch(() => ({ status: 200, body: { found: 'yes', status: 'completed' } })).fetch })
    await expect(garbage.queryOutcome('http://peer', 't-1', 'fprint')).resolves.toBeUndefined()
    const foundless = makeClient({ fetch: stubFetch(() => ({ status: 200, body: { found: true, status: 'completed', reply: 42, settled_at: 'x' } })).fetch })
    await expect(foundless.queryOutcome('http://peer', 't-1', 'fprint')).resolves.toBeUndefined()
  })

  it('never dispatches when the task id or fingerprint is empty', async () => {
    const { calls, fetch } = stubFetch(() => ({ status: 200, body: { found: true, status: 'pending' } }))
    const client = makeClient({ fetch })
    await expect(client.queryOutcome('http://peer', '', 'fprint')).resolves.toBeUndefined()
    await expect(client.queryOutcome('http://peer', 't-1', '')).resolves.toBeUndefined()
    expect(calls).toEqual([])
  })
})

describe('delivered shape carries the consumed probe (F1 client half, async-stall §三)', () => {
  it('passes consumed through when the peer reports it true, keeping the async receipt wording', async () => {
    const { fetch } = stubFetch(() => ({ status: 200, body: { routed: true, delivered: true, consumed: true, task_id: 't-9', context_id: 'ctx-9', task_status: 'TASK_STATE_DELIVERED' } }))
    await expect(makeClient({ fetch }).routeDirect('http://p:1', 'crew', 'hello',undefined,undefined,undefined,true)).resolves.toEqual({
      ok: true,
      team: 'crew',
      reply: 'Delivered to crew (async). The target routes a receipt — a message starting "[A2A receipt] task t-9 <outcome summary>" — back to your team when done; watch a2a_status activity or follow up with the context id.',
      task_id: 't-9',
      context_id: 'ctx-9',
      task_status: 'TASK_STATE_DELIVERED',
      consumed: true,
    })
  })

  it('answers consumed:false with the queued-turn wording — follow up, do not resend', async () => {
    const { fetch } = stubFetch(() => ({ status: 200, body: { routed: true, delivered: true, consumed: false, task_id: 't-8', context_id: 'ctx-8', task_status: 'TASK_STATE_DELIVERED' } }))
    const result = await makeClient({ fetch }).routeDirect('http://p:1', 'crew', 'hello',undefined,undefined,undefined,true)
    expect(result).toMatchObject({ ok: true, consumed: false })
    expect((result as { reply: string }).reply).toContain('queued behind the session')
    expect((result as { reply: string }).reply).toContain('do not resend')
  })

  it('omits consumed when the peer is older and does not report it', async () => {
    const { fetch } = stubFetch(() => ({ status: 200, body: { routed: true, delivered: true, task_id: 't-7', context_id: 'ctx-7', task_status: 'TASK_STATE_DELIVERED' } }))
    const result = await makeClient({ fetch }).routeDirect('http://p:1', 'crew', 'hello',undefined,undefined,undefined,true)
    expect(result).not.toHaveProperty('consumed')
  })
})

describe('#317 link-keys helpers', () => {
  const equal = (a: string, b: string): boolean => a === b
  it('normalizes keys by origin, drops blanks and junk, and picks the outbound key per target', () => {
    const keys = normalizeLinkKeys({ 'https://vps.example/some/path': 'link', 'http://lan:13080': 'lan-link', 'not a url': 'x', 'http://blank': '' })
    expect([...keys.keys()]).toEqual(['https://vps.example', 'http://lan:13080'])
    expect(outboundKeyFor('https://vps.example/a2a/direct', keys, 'fleet')).toBe('link')
    expect(outboundKeyFor('http://other:1/a2a/direct', keys, 'fleet')).toBe('fleet')
    expect(outboundKeyFor('http://other:1/a2a/direct', keys, '')).toBe('')
  })
  it('recognizes a presented link key only on an exact match', () => {
    const keys = normalizeLinkKeys({ 'https://vps.example': 'link', 'http://lan:13080': 'lan-link' })
    expect(isLinkKey('lan-link', keys, equal)).toBe(true)
    expect(isLinkKey('link', keys, equal)).toBe(true)
    expect(isLinkKey('nope', keys, equal)).toBe(false)
    expect(isLinkKey('', keys, equal)).toBe(false)
  })
})
it.each([false,true])('sync delivered reply has explicit reconcile instruction (delivered shape %s)',async delivered=>{
 const {fetch,calls}=stubFetch(()=>({status:200,body:{routed:true,...(delivered?{delivered:true}:{}),task_id:'sync-wait',task_status:'TASK_STATE_DELIVERED',result:{text:'host placeholder'}}}))
 const reply=await makeClient({fetch}).routeDirect('http://peer:1','ops','work',undefined,undefined,undefined,false,undefined,'sync-wait')
 expect(reply).toMatchObject({ok:true,task_status:'TASK_STATE_DELIVERED',reply:expect.stringContaining('已送达、未得到最终答复，请按 task id 对账')});expect((reply as any).replyFinal).toBeUndefined();expect(calls.filter(x=>x.method==='POST')).toHaveLength(1)
})
it('unknown acceptance remains a failure with the exact original task reconciliation instruction',async()=>{const{fetch,calls}=stubFetch(()=>({status:200,body:{error:'接纳状态未知，请用原 task id 对账，不要换 id 重派',acceptance:'unknown',task_id:'unknown-1',code:-32000,task_status:'TASK_STATE_FAILED'}}));const out=await makeClient({fetch}).routeDirect('http://peer:1','ops','work');expect(out).toMatchObject({ok:false,acceptance:'unknown',task_id:'unknown-1',code:-32000,error:expect.stringContaining('不要换 id 重派')});expect(calls.filter(x=>x.method==='POST')).toHaveLength(1)})
it('proven insertion is delivery only, not a final or consumption assertion',async()=>{const{fetch}=stubFetch(()=>({status:200,body:{routed:true,delivered:true,acceptance:'inserted',task_id:'insert-1',task_status:'TASK_STATE_DELIVERED',consumed:false}}));const out=await makeClient({fetch}).routeDirect('http://peer:1','ops','work');expect(out).toMatchObject({ok:true,acceptance:'inserted',task_status:'TASK_STATE_DELIVERED',consumed:false,reply:expect.stringContaining('后续处理未确认')});expect((out as any).replyFinal).toBeUndefined()})
