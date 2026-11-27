// @vitest-environment node
/** #951 S1: the three user routes over real HTTP, with a real delegate book and audit file. */
import { mkdtempSync } from '../temp-dirs.ts'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerUserSessionFaces } from '../../src/faces/user-sessions.ts'
import { OWNER_DELEGATE_HEADER, OwnerDelegates, issueOwnerDelegate } from '../../src/superagent/host/owner-delegate.ts'
import { configureOwnerDelegates } from '../../src/superagent/host/owner-proof.ts'
import { OWNER_PROMPT_BODY_MAX_BYTES } from '../../src/user-sessions.ts'

const LIVE = 'session-0123456789abcdef', COLD = 'session-aaaaaaaaaaaaaaaa', UNJOINED = 'session-bbbbbbbbbbbbbbbb', ARCHIVED = 'session-cccccccccccccccc', UNKNOWN = 'session-dddddddddddddddd'

let server: Server, base = '', dir = '', auditPath = '', token = '', routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>(), maxBytesSeen: number[] = []
let agent: { steer: ReturnType<typeof vi.fn>; followup: ReturnType<typeof vi.fn>; status: string; inbox: { nextTurn: unknown[]; nextStep: unknown[] }; model?: { current: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> } }
let taint: ReturnType<typeof vi.fn>
let catalog: unknown
let controllerSelect: ReturnType<typeof vi.fn>
let effects: Array<() => unknown>

const event = (i: number): string => JSON.stringify(i % 2 === 0 ? { type: 'user/message', time: 1000 + i, data: { content: [{ type: 'text', text: `问 ${String(i)}` }] } } : { type: 'assistant/message', time: 1000 + i, data: { message: { content: [{ type: 'text', text: `答 ${String(i)} ${'长'.repeat(i === 3 ? 900 : 1)}` }] } } })

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'user-sessions-'))
  auditPath = join(dir, 'audit.jsonl')
  const store = join(dir, 'delegates.json')
  token = issueOwnerDelegate(store, '带教', 30, { read: () => undefined, write: (p, t) => writeFileSync(p, t), random: () => ({ token: 'dshod_fixture-token', id: 'd-1' }), now: () => new Date() }).token
  const delegates = new OwnerDelegates(store, auditPath)
  configureOwnerDelegates(delegates)
  effects = []
  mkdirSync(join(dir, 'sessions', 'b1', LIVE), { recursive: true })
  writeFileSync(join(dir, 'sessions', 'b1', LIVE, 'session.jsonl'), Array.from({ length: 45 }, (_, i) => event(i)).join('\n') + '\n')
  agent = { steer: vi.fn(), followup: vi.fn(), status: 'running', inbox: { nextTurn: [1], nextStep: [] } }
  taint = vi.fn()
  catalog = { groups: [{ id: 'provider', models: [{ id: 'model', reasoning: { efforts: [{ id: 'low' }] } }] }] }
  controllerSelect = vi.fn()
  routes = new Map(); maxBytesSeen = []
  const webServer = { register: (r: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => { routes.set(r.path, r.handler); return () => undefined } }
  const connection = { browserPeer: { id: 'owner' }, admit: (req: Pick<IncomingMessage, 'headers'>) => (req.headers.cookie === 'login=ok' ? { peer: { id: 'owner' } } : { rejection: 401 as const }) }
  registerUserSessionFaces(webServer as never, {
    ctx: { effect: (fn: () => () => unknown) => effects.push(fn()), on: () => undefined, get: (key: string) => key === 'connection'
      ? connection : { modelCatalog: async () => catalog, selectModel: controllerSelect } } as never,
    ownerDelegates: delegates, releasePath: join(dir, 'releases.json'),
    controlRoute: handler => handler,
    readJsonBody: (req, res, use, maxBytes) => {
      maxBytesSeen.push(maxBytes ?? 10_000)
      const chunks: Buffer[] = []; let size = 0, over = false
      req.on('data', (c: Buffer) => { size += c.length; if (size > (maxBytes ?? 10_000)) over = true; else chunks.push(c) })
      req.on('end', () => { if (over) { res.writeHead(413); res.end('{}'); return } use(JSON.parse(Buffer.concat(chunks).toString('utf8'))) })
    },
    liveSessions: { has: id => [LIVE, UNJOINED, ARCHIVED].includes(id), get: id => ([LIVE, UNJOINED, ARCHIVED].includes(id) ? agent : undefined), keys: () => [LIVE, UNJOINED, ARCHIVED] },
    joinedSessions: { has: id => [LIVE, COLD, ARCHIVED].includes(id), list: () => [LIVE, COLD, ARCHIVED] },
    archived: id => id === ARCHIVED, sessionLogRoots: () => [join(dir, 'sessions')], scanSessionLogList: () => [{ id: LIVE, mtimeMs: 50 }],
    nameOf: () => '席位一', teamOf: () => 'ops', roleOf: id => (id === LIVE ? 'member' : null), taint,
  })
  server = createServer((req, res) => { const handler = routes.get(new URL(req.url ?? '/', 'http://x').pathname); if (handler === undefined) { res.writeHead(404); res.end(); return } handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`
})
afterEach(async () => { effects.forEach(dispose => dispose()); configureOwnerDelegates(undefined); await new Promise<void>(resolve => server.close(() => resolve())) })

const owner = (extra: Record<string, string> = {}): Record<string, string> => ({ [OWNER_DELEGATE_HEADER]: token, ...extra })
const call = async (method: string, path: string, headers: Record<string, string> = owner(), body?: unknown): Promise<{ status: number; json: Record<string, any> }> => {
  const res = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) })
  const text = await res.text()
  return { status: res.status, json: text === '' ? {} : JSON.parse(text) }
}
const audit = (): Array<Record<string, any>> => { try { return readFileSync(auditPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } }
const prompt = (over: Record<string, unknown> = {}, headers?: Record<string, string>) => call('POST', '/__dsh_a2a/user/session/prompt', headers, { id: LIVE, mode: 'steer', text: '看一下 #12', ...over })

describe('who may call: the control key alone is not the owner', () => {
  it.each([['GET', '/__dsh_a2a/user/sessions'], ['GET', `/__dsh_a2a/user/session?id=${LIVE}`], ['POST', '/__dsh_a2a/user/session/prompt']])('%s %s: no delegate and no login is 401, a bad delegate 403, a login is accepted; session-log is untouched', async (method, path) => {
    const body = method === 'POST' ? { id: LIVE, mode: 'steer', text: 'x' } : undefined
    expect((await call(method, path, {}, body)).status).toBe(401)
    expect((await call(method, path, { [OWNER_DELEGATE_HEADER]: 'dshod_wrong' }, body)).status).toBe(403)
    expect((await call(method, path, { cookie: 'login=ok' }, body)).status).toBe(200)
    expect((await call(method, path, owner(), body)).status).toBe(200)
  })
  it('a revoked or expired delegate is 403 and writes nothing; the wrong method is 405', async () => {
    const store = join(dir, 'delegates.json')
    const rows = JSON.parse(readFileSync(store, 'utf8')) as { delegates: Array<Record<string, unknown>> }
    rows.delegates[0]!.revokedAt = new Date().toISOString(); writeFileSync(store, JSON.stringify(rows))
    expect((await call('GET', '/__dsh_a2a/user/sessions')).status).toBe(403)
    expect(audit()).toEqual([])
    expect((await call('POST', '/__dsh_a2a/user/sessions', {}, {})).status).toBe(405)
    expect((await call('GET', '/__dsh_a2a/user/session/prompt', {})).status).toBe(405)
  })
})

describe('session state', () => {
  it('returns counts and kinds, with independent unknown fields and no message data', async () => {
    agent.inbox.nextTurn = [{ source: { kind: 'user', person: 'private identity' }, content: 'private queue text' }]
    agent.inbox.nextStep = [{ source: { kind: 'user' } }, { source: { kind: '__proto__' } }]
    const res = await call('GET', '/__dsh_a2a/user/session/state?id=' + LIVE)
    expect(res).toEqual({ status: 200, json: {
      ok: true, id: LIVE, live: true, status: 'running',
      inbox: { nextTurn: 1, nextStep: 2, total: 3, kinds: { user: 2, ['__proto__']: 1 } },
    } })
    expect(audit()).toEqual([expect.objectContaining({ action: 'state', target: LIVE })])
    Object.defineProperty(agent.inbox, 'nextStep', { get() { throw new Error('not exposed') } })
    const partial = await call('GET', '/__dsh_a2a/user/session/state?id=' + LIVE)
    expect(partial.json).toEqual({ ok: true, id: LIVE, live: true, status: 'running', inbox: { nextTurn: 1 }, available: false })
    const cold = await call('GET', '/__dsh_a2a/user/session/state?id=' + COLD)
    expect(cold.json).toEqual({ ok: true, id: COLD, live: false, inbox: {}, available: false })
  })

  it('requires owner proof and rejects unknown IDs without a successful audit', async () => {
    expect((await call('GET', '/__dsh_a2a/user/session/state?id=' + LIVE, {})).status).toBe(401)
    expect((await call('GET', '/__dsh_a2a/user/session/state?id=' + UNKNOWN)).status).toBe(404)
    expect(audit()).toEqual([])
  })
})

describe('session model', () => {
  const path = '/__dsh_a2a/user/session/model'
  const model = (fields: Record<string, unknown> = {}) => call('POST', path, owner(), { id: LIVE, provider: 'provider', model: 'model', ...fields })

  it('checks owner proof and target before returning the capability refusal', async () => {
    expect((await call('POST', path, {}, { id: LIVE })).status).toBe(401)
    expect((await call('POST', path, { cookie: 'login=ok', [OWNER_DELEGATE_HEADER]: 'invalid' }, { id: LIVE })).status).toBe(403)
    for (const [id, status, code] of [['bad-id', 400, 'id'], [UNKNOWN, 404, 'unknown-session'], [COLD, 409, 'not-live'], [UNJOINED, 409, 'not-joined'], [ARCHIVED, 409, 'archived']] as const) {
      expect(await model({ id })).toMatchObject({ status, json: { code } })
    }
    expect(await model()).toMatchObject({ status: 501, json: { code: 'no-model-api' } })
    expect(audit()).toEqual([])
  })

  it('refuses even when the legacy controller and Agent model methods exist, with zero side effects', async () => {
    agent.model = { current: vi.fn(() => ({ provider: 'provider', model: 'model' })), select: vi.fn() }
    agent.status = 'idle'
    const res = await model({ reasoning_effort: 'low' })
    expect(res).toMatchObject({ status: 501, json: { ok: false, code: 'no-model-api' } })
    expect(res.json).not.toHaveProperty('previous')
    expect(agent.model.current).not.toHaveBeenCalled()
    expect(agent.model.select).not.toHaveBeenCalled()
    expect(controllerSelect).not.toHaveBeenCalled()
    expect(agent.steer).not.toHaveBeenCalled()
    expect(agent.followup).not.toHaveBeenCalled()
    expect(taint).not.toHaveBeenCalled()
    expect(audit()).toEqual([])
  })
})

describe('trigger and release', () => {
  const path = '/__dsh_a2a/user/session/release'

  it('uses steer only for an idle trigger and replays the original wake observation', async () => {
    expect(await prompt({ mode: 'trigger' })).toMatchObject({ status: 409, json: { code: 'busy' } })
    agent.status = 'unknown'
    expect(await prompt({ mode: 'trigger' })).toMatchObject({ status: 409, json: { code: 'no-idle-signal' } })
    expect(audit()).toEqual([])
    agent.status = 'idle'
    expect(await prompt({ mode: 'trigger' })).toMatchObject({ status: 200, json: { woken: false } })
    agent.steer.mockImplementationOnce(() => { agent.status = 'running' })
    const fields = { mode: 'trigger', request_id: 'trigger-once' }
    expect(await prompt(fields)).toMatchObject({ status: 200, json: { woken: true } })
    expect(await prompt(fields)).toMatchObject({ status: 200, json: { woken: true, replayed: true } })
    expect(agent.steer).toHaveBeenCalledTimes(2)
    expect(agent.steer).toHaveBeenLastCalledWith(expect.objectContaining({ source: expect.objectContaining({ kind: 'a2a-owner-proxy', mode: 'trigger' }) }))
    expect(agent.followup).not.toHaveBeenCalled()
    expect(audit().map(row => row.action)).toEqual(['prompt-trigger', 'prompt-trigger'])
  })

  it('guards release routes, accepts a full prompt and lists only metadata', async () => {
    const fields = { action: 'arm', id: LIVE, then: 'queue', when: 'idle:10', request_id: 'release-once', text: '世'.repeat(8000) }
    expect((await call('POST', path, {}, fields)).status).toBe(401)
    const armed = await call('POST', path, owner(), fields)
    expect(armed).toMatchObject({ status: 200, json: { state: 'armed', chars: 8000 } })
    const repeated = await call('POST', path, owner(), fields)
    expect(repeated.json).toMatchObject({ release: armed.json.release, replayed: true })
    const listed = await call('GET', '/__dsh_a2a/user/session/releases?id=' + LIVE)
    expect(listed.json.releases).toEqual([expect.objectContaining({ release: armed.json.release, state: 'armed' })])
    expect(listed.json.releases[0]).not.toHaveProperty('text')
    expect(audit().filter(row => row.action === 'release-arm')).toEqual([expect.objectContaining({
      actor: { id: 'd-1', name: '带教' }, armedBy: { id: 'd-1', name: '带教' },
    })])
    const cleared = await call('POST', path, { cookie: 'login=ok' }, { action: 'withdraw', release: armed.json.release })
    expect(cleared.json.state).toBe('withdrawn')
    expect(audit().at(-1)).toMatchObject({ action: 'release-withdraw', actor: { id: null, name: 'browser-owner' }, armedBy: { id: 'd-1', name: '带教' } })
    expect(JSON.stringify(audit())).not.toContain(fields.text)
  })
})

describe('sessions and read', () => {
  it('lists the sessions with joined, live and the seat state, audits one line, and never prints the delegate token', async () => {
    const res = await call('GET', '/__dsh_a2a/user/sessions?team=ops')
    expect(res.status).toBe(200)
    expect(res.json.sessions.map((s: { id: string }) => s.id)).toEqual([LIVE, UNJOINED, ARCHIVED, COLD].sort((a, b) => (a === LIVE ? -1 : b === LIVE ? 1 : 0)).filter(id => id !== COLD))
    expect(res.json.sessions[0]).toMatchObject({ id: LIVE, name: '席位一', joined: true, live: true, status: 'running', queued: 1, role: 'member' })
    expect(JSON.stringify(res.json)).not.toContain('dshod_')
    expect(audit()).toEqual([expect.objectContaining({ id: 'd-1', name: '带教', method: 'GET', path: '/__dsh_a2a/user/sessions', action: 'sessions', target: 'ops' })])
  })
  it('read pages backward without overlap or gap; before past the end is stale and gives the newest page; chars cuts each entry', async () => {
    const newest = (await call('GET', `/__dsh_a2a/user/session?id=${LIVE}&limit=20`)).json
    expect(newest).toMatchObject({ ok: true, total: 45, from: 25, to: 45, stale: false }); expect(newest.entries[0].i).toBe(25); expect(newest.entries.at(-1).i).toBe(44)
    const middle = (await call('GET', `/__dsh_a2a/user/session?id=${LIVE}&limit=20&before=25`)).json
    expect([middle.from, middle.to]).toEqual([5, 25])
    const oldest = (await call('GET', `/__dsh_a2a/user/session?id=${LIVE}&limit=20&before=5`)).json
    expect([oldest.from, oldest.to, oldest.entries.length]).toEqual([0, 5, 5])
    const all = [...oldest.entries, ...middle.entries, ...newest.entries].map((e: { i: number }) => e.i)
    expect(all).toEqual(Array.from({ length: 45 }, (_, i) => i))
    expect((await call('GET', `/__dsh_a2a/user/session?id=${LIVE}&limit=5&before=9999`)).json).toMatchObject({ stale: true, to: 45, from: 40 })
    const long = (await call('GET', `/__dsh_a2a/user/session?id=${LIVE}&limit=5&before=6&chars=50`)).json.entries.find((e: { i: number }) => e.i === 3)
    expect(long.text.length).toBe(51)
    const wide = (await call('GET', `/__dsh_a2a/user/session?id=${LIVE}&limit=5&before=6&chars=4000`)).json.entries.find((e: { i: number }) => e.i === 3)
    expect(wide.text.length).toBeGreaterThan(500)
    expect((await call('GET', `/__dsh_a2a/user/session?id=${LIVE}&limit=5&before=6`)).json.entries.find((e: { i: number }) => e.i === 3).text.length).toBe(501)
  })
  it.each([['limit=0'], ['limit=101'], ['before=-1'], ['before=x'], ['chars=4001'], ['chars=0']])('read %s is a 400 and writes nothing', async query => {
    expect((await call('GET', `/__dsh_a2a/user/session?id=${LIVE}&${query}`)).status).toBe(400)
    expect(audit()).toEqual([])
  })
  it('read refuses a bad id 400 and an id with no log 404, without an audit line; a cold joined session with a log is readable', async () => {
    expect((await call('GET', '/__dsh_a2a/user/session?id=..%2Fsession-0123456789abcdef')).status).toBe(400)
    expect((await call('GET', `/__dsh_a2a/user/session?id=${UNKNOWN}`)).json).toMatchObject({ code: 'no-log' })
    expect(audit()).toEqual([])
  })
})

describe('prompt', () => {
  it('delivers a steer and a queue to the right agent method with the marker, and writes one accepted line with sizes and a digest but not the text', async () => {
    const steer = await prompt({ text: '请先看 #12 的评审' })
    expect(steer).toMatchObject({ status: 200, json: { ok: true, delivered: 'steered', role: 'member' } })
    expect(agent.steer.mock.calls[0]![0].content[0].text).toBe('[属主代输入 · 带教 · steer]\n请先看 #12 的评审')
    const queued = await prompt({ mode: 'queue', text: '稍后' })
    expect(queued.json.delivered).toBe('queued'); expect(agent.followup).toHaveBeenCalledTimes(1); expect(agent.steer).toHaveBeenCalledTimes(1)
    const lines = audit()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ id: 'd-1', name: '带教', method: 'POST', path: '/__dsh_a2a/user/session/prompt', action: 'prompt-steer', target: LIVE, phase: 'accepted', chars: 11, bytes: 23 })
    expect(JSON.stringify(lines)).not.toContain('评审'); expect(JSON.stringify(lines)).not.toContain('dshod_')
    expect(taint).not.toHaveBeenCalled()
  })
  it('a browser owner is audited as browser-owner with a null id and the marker says so', async () => {
    expect((await prompt({}, { cookie: 'login=ok' })).status).toBe(200)
    expect(audit()[0]).toMatchObject({ id: null, name: 'browser-owner', action: 'prompt-steer' })
    expect(agent.steer.mock.calls[0]![0].source).toMatchObject({ delegateName: 'browser-owner' }); expect(agent.steer.mock.calls[0]![0].source).not.toHaveProperty('delegateId')
  })
  it.each([
    ['unknown', { id: UNKNOWN }, 404], ['archived', { id: ARCHIVED }, 409], ['live not joined', { id: UNJOINED }, 409], ['cold', { id: COLD }, 409],
    ['bad id', { id: 'x' }, 400], ['bad mode', { mode: 'now' }, 400], ['empty text', { text: '' }, 400], ['too long', { text: 'a'.repeat(8001) }, 400],
  ])('%s is %i with no audit line and nothing delivered', async (_name, over, status) => {
    expect((await prompt(over)).status).toBe(status)
    expect(audit()).toEqual([]); expect(agent.steer).not.toHaveBeenCalled(); expect(agent.followup).not.toHaveBeenCalled()
  })
  it('an audit that cannot be written is 503 and nothing is delivered', async () => {
    const store = join(dir, 'delegates.json')
    configureOwnerDelegates(new OwnerDelegates(store, join(dir, 'missing', 'audit.jsonl')))
    expect(await prompt()).toMatchObject({ status: 503, json: { code: 'audit' } })
    expect(agent.steer).not.toHaveBeenCalled()
    expect((await call('GET', '/__dsh_a2a/user/sessions')).status).toBe(503)
    // a read is not served either when its line cannot be written
    const read = await call('GET', `/__dsh_a2a/user/session?id=${LIVE}`)
    expect(read.status).toBe(503); expect(read.json.entries).toBeUndefined()
  })
  it('a delivery that throws is 500 with a second delivery-failed line; the request id can be retried', async () => {
    agent.steer.mockImplementationOnce(() => { throw new Error('host refused') })
    expect(await prompt({ request_id: 'r-1' })).toMatchObject({ status: 500, json: { code: 'deliver-failed' } })
    expect(audit().map(l => l.phase)).toEqual(['accepted', 'delivery-failed'])
    expect((await prompt({ request_id: 'r-1' })).status).toBe(200)
  })
  it('a repeated request id is a replay with no second delivery or audit line; other content under it is 409 with none either', async () => {
    expect((await prompt({ request_id: 'r-2' })).json.replayed).toBeUndefined()
    expect(await prompt({ request_id: 'r-2' })).toMatchObject({ status: 200, json: { replayed: true } })
    expect((await prompt({ request_id: 'r-2', text: '别的' })).status).toBe(409)
    expect(agent.steer).toHaveBeenCalledTimes(1); expect(audit()).toHaveLength(1)
  })
  it('the body limit lets a full 8000-character text through in any JSON spelling and refuses a larger body with 413', async () => {
    expect(maxBytesSeen).toEqual([]); await prompt()
    expect(maxBytesSeen).toEqual([OWNER_PROMPT_BODY_MAX_BYTES])
    const escapedCjk = JSON.stringify({ id: LIVE, mode: 'steer', text: '中'.repeat(8000) }).replace(/[\u0080-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
    const escapedEmoji = JSON.stringify({ id: LIVE, mode: 'steer', text: '😀'.repeat(8000) }).replace(/[\u0080-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
    expect(Buffer.byteLength(escapedCjk)).toBeGreaterThan(40_000); expect(Buffer.byteLength(escapedEmoji)).toBeLessThan(OWNER_PROMPT_BODY_MAX_BYTES)
    for (const raw of [escapedCjk, escapedEmoji, JSON.stringify({ id: LIVE, mode: 'steer', text: '中'.repeat(8000) })]) expect((await call('POST', '/__dsh_a2a/user/session/prompt', owner(), raw)).status).toBe(200)
    expect((await call('POST', '/__dsh_a2a/user/session/prompt', owner(), JSON.stringify({ id: LIVE, mode: 'steer', text: 'a'.repeat(OWNER_PROMPT_BODY_MAX_BYTES) }))).status).toBe(413)
  })
  it('a prompt is audited before it is delivered', async () => {
    agent.steer.mockImplementationOnce(() => { expect(audit().map(l => l.phase)).toEqual(['accepted']) })
    expect((await prompt()).status).toBe(200)
  })
})
