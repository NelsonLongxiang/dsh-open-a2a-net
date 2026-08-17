/**
 * Decentralized client unit tests: card fetch verification, direct-route
 * request/response shapes, the caller-identity override, the API-key header,
 * and HTTP timeout/cancellation — all against injected fetch/schedule seams.
 */
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { A2aClient, type A2aFetch } from '../src/a2a-client.ts'
import { signCard } from '../src/card.ts'


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

describe('routeDirect', () => {
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
    await expect(pending).resolves.toMatchObject({ ok: false, code: -32000 })
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
