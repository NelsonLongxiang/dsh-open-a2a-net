// @vitest-environment node
/** #951 S1 hardening: the gaps the code review of PR #954 listed (N1 a-h), and the two small fixes (N2 the `before` bound, N3 the cut inside an emoji). */
import { mkdtempSync } from '../temp-dirs.ts'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerUserSessionFaces } from '../../src/faces/user-sessions.ts'
import { OWNER_DELEGATE_HEADER, OwnerDelegates, issueOwnerDelegate } from '../../src/superagent/host/owner-delegate.ts'
import { configureOwnerDelegates } from '../../src/superagent/host/owner-proof.ts'
import { listUserSessions, OWNER_PROMPT_IDEM_MAX, PromptIdempotency, prepareOwnerPrompt, USER_SESSIONS_MAX, type OwnerPromptInput, type UserSessionsDeps } from '../../src/user-sessions.ts'
import { pageTranscript, TRANSCRIPT_MAX_FILE_BYTES, TRANSCRIPT_MAX_LIMIT, TRANSCRIPT_PAGE_CHARS_MAX } from '../../src/session-transcript.ts'

const LIVE = 'session-0123456789abcdef'
const who = { id: 'd-1', name: '带教' }

describe('the read route refuses ids that only look like sessions (N1 a)', () => {
  let server: Server, base = '', dir = '', token = ''
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
  const audit = (): string => { try { return readFileSync(join(dir, 'audit.jsonl'), 'utf8') } catch { return '' } }
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'user-sessions-hard-'))
    const store = join(dir, 'delegates.json')
    token = issueOwnerDelegate(store, '带教', 30, { read: () => undefined, write: (p, t) => writeFileSync(p, t), random: () => ({ token: 'dshod_fixture-token', id: 'd-1' }), now: () => new Date() }).token
    configureOwnerDelegates(new OwnerDelegates(store, join(dir, 'audit.jsonl')))
    mkdirSync(join(dir, 'sessions', 'b1', LIVE), { recursive: true })
    const log = join(dir, 'sessions', 'b1', LIVE, 'session.jsonl')
    writeFileSync(log, JSON.stringify({ type: 'user/message', time: 1, data: { content: [{ type: 'text', text: '问' }] } }) + '\n')
    // a file a loose id would reach: a log outside the session roots
    mkdirSync(join(dir, 'outside'), { recursive: true }); writeFileSync(join(dir, 'outside', 'session.jsonl'), 'secret\n')
    routes.clear()
    const agent = { steer: vi.fn(), followup: vi.fn(), status: 'idle', inbox: { nextTurn: [], nextStep: [] } }
    registerUserSessionFaces({ register: (r: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => { routes.set(r.path, r.handler); return () => undefined } } as never, {
      ctx: { effect: (fn: () => unknown) => fn(), get: () => ({ browserPeer: { id: 'o' }, admit: () => ({ rejection: 401 as const }) }) } as never,
      controlRoute: handler => handler,
      readJsonBody: () => undefined,
      liveSessions: { has: id => id === LIVE, get: id => (id === LIVE ? agent : undefined), keys: () => [LIVE] },
      joinedSessions: { has: id => id === LIVE, list: () => [LIVE] },
      archived: () => false, sessionLogRoots: () => [join(dir, 'sessions')], scanSessionLogList: () => [],
      nameOf: () => 'x', teamOf: () => 'ops', roleOf: () => 'member', taint: () => undefined,
    })
    server = createServer((req, res) => { const h = routes.get(new URL(req.url ?? '/', 'http://x').pathname); if (h === undefined) { res.writeHead(404); res.end(); return } h(req, res) })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    base = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`
  })
  afterEach(async () => { configureOwnerDelegates(undefined); await new Promise<void>(resolve => server.close(() => resolve())) })
  const call = async (method: string, path: string) => { const res = await fetch(base + path, { method, headers: { [OWNER_DELEGATE_HEADER]: token } }); const text = await res.text(); return { status: res.status, json: text === '' ? {} : JSON.parse(text) as Record<string, any> } }

  it.each([['a dot-dot after the prefix', 'session-../outside'], ['an encoded slash', 'session-..%2F..%2Foutside'], ['a path after a real id', `${LIVE}/../../outside`], ['a backslash', 'session-..\\\\outside'], ['a trailing newline', `${LIVE}%0A`], ['too short', 'session-0123456'], ['65 characters after the prefix', 'session-' + 'a'.repeat(65)]])('%s is a 400 with no audit line', async (_n, id) => {
    expect((await call('GET', `/__dsh_a2a/user/session?id=${id}`)).status).toBe(400)
    expect(audit()).toBe('')
  })
  it('the longest id the shape allows (64 after the prefix) is looked up and is a 404, not a 400', async () => {
    expect((await call('GET', '/__dsh_a2a/user/session?id=session-' + 'a'.repeat(64))).status).toBe(404)
  })
  it('the read route takes GET only; POST is 405 and writes nothing (N1 f)', async () => {
    expect((await call('POST', `/__dsh_a2a/user/session?id=${LIVE}`)).status).toBe(405)
    expect(audit()).toBe('')
  })
  it('a session log over the size cap is a 413 and no audit line (N1 g)', async () => {
    truncateSync(join(dir, 'sessions', 'b1', LIVE, 'session.jsonl'), TRANSCRIPT_MAX_FILE_BYTES + 1)
    const res = await call('GET', `/__dsh_a2a/user/session?id=${LIVE}`)
    expect(res.status).toBe(413); expect(res.json.code).toBe('too-large'); expect(audit()).toBe('')
  })
  it('before accepts 999999999 and refuses a tenth digit, as the documented bound says (N2)', async () => {
    expect((await call('GET', `/__dsh_a2a/user/session?id=${LIVE}&before=999999999`)).status).toBe(200)
    expect((await call('GET', `/__dsh_a2a/user/session?id=${LIVE}&before=1000000000`)).status).toBe(400)
  })
})

describe('prompt bounds (N1 b c d e)', () => {
  const ask = (over: Partial<OwnerPromptInput> = {}): OwnerPromptInput => ({ id: LIVE, mode: 'steer', text: 'x', callerTaint: '', delegate: who, ...over })
  const deps = (over: Partial<UserSessionsDeps> = {}): UserSessionsDeps => {
    const agent = { steer: vi.fn(), followup: vi.fn(), status: 'idle', inbox: { nextTurn: [], nextStep: [] } }
    return { live: () => true, joined: () => true, archived: () => false, agent: () => agent, role: () => 'member', taint: () => undefined, idem: new PromptIdempotency(), ...over }
  }
  it('a request id of 64 characters passes and 65 is a 400 request-id', () => {
    expect(prepareOwnerPrompt(deps(), ask({ requestId: 'r'.repeat(64) }))).toMatchObject({ ok: true })
    expect(prepareOwnerPrompt(deps(), ask({ requestId: 'r'.repeat(65) }))).toMatchObject({ ok: false, status: 400, code: 'request-id' })
  })
  it.each(['a b', '', 'ä', 'x/y', 'x\\n'])('the request id %j is refused', requestId => {
    expect(prepareOwnerPrompt(deps(), ask({ requestId }))).toMatchObject({ ok: false, status: 400, code: 'request-id' })
  })
  it('a seat that stopped between the check and the delivery is a 409 not-live, nothing delivered, and the request id stays free', () => {
    let calls = 0
    const agent = { steer: vi.fn(), followup: vi.fn(), status: 'idle', inbox: { nextTurn: [], nextStep: [] } }
    const d = deps({ agent: () => (++calls === 1 ? agent : undefined) })
    const prepared = prepareOwnerPrompt(d, ask({ requestId: 'r-1' }))
    if (!prepared.ok || prepared.replay !== undefined) throw new Error('prepared')
    expect(prepared.deliver()).toMatchObject({ ok: false, status: 409, code: 'not-live' })
    expect(agent.steer).not.toHaveBeenCalled(); expect(d.idem.lookup('r-1')).toBeUndefined()
  })
  it('the request-id memory holds exactly 256 ids: the 257th pushes out the oldest only', () => {
    const fill = (n: number): PromptIdempotency => { const idem = new PromptIdempotency(); for (let i = 0; i < n; i++) idem.register(`id-${String(i)}`, 'k', { ok: true }); return idem }
    expect(OWNER_PROMPT_IDEM_MAX).toBe(256)
    const full = fill(256)
    expect(full.lookup('id-0')).toBeDefined(); expect(full.lookup('id-255')).toBeDefined()
    const over = fill(257)
    expect(over.lookup('id-0')).toBeUndefined(); expect(over.lookup('id-1')).toBeDefined(); expect(over.lookup('id-256')).toBeDefined()
  })
  it('the session list holds 200 rows; 200 sessions are not cut, 201 are, and the cut is flagged', () => {
    const list = (n: number) => listUserSessions({ ...deps(), ids: () => Array.from({ length: n }, (_, i) => `session-${String(i).padStart(8, '0')}`), name: id => id, team: () => 'ops', mtimeMs: () => undefined })
    expect(USER_SESSIONS_MAX).toBe(200)
    expect(list(200)).toMatchObject({ truncated: false }); expect(list(200).sessions).toHaveLength(200)
    expect(list(201)).toMatchObject({ truncated: true }); expect(list(201).sessions).toHaveLength(200)
  })
})

describe('pageTranscript clamps on its own (N1 h) and cuts by whole characters (N3)', () => {
  const entries = Array.from({ length: 150 }, (_, i) => ({ role: 'user' as const, text: 'x'.repeat(5000), time: i }))
  it('a limit below 1 is 1, above the maximum is the maximum, a fraction is floored, and a missing one is the default', () => {
    expect(pageTranscript(entries, { limit: 0 }).entries).toHaveLength(1)
    expect(pageTranscript(entries, { limit: -5 }).entries).toHaveLength(1)
    expect(pageTranscript(entries, { limit: 100000 }).entries).toHaveLength(TRANSCRIPT_MAX_LIMIT)
    expect(pageTranscript(entries, { limit: 2.9 }).entries).toHaveLength(2)
  })
  it('an entry cap below 1 is 1 and above the page maximum is the maximum', () => {
    expect(pageTranscript(entries, { limit: 1, entryCap: 0 }).entries[0]!.text).toBe('x…')
    expect(pageTranscript(entries, { limit: 1, entryCap: 99999 }).entries[0]!.text).toBe('x'.repeat(TRANSCRIPT_PAGE_CHARS_MAX) + '…')
  })
  it('a cut that would fall in the middle of an emoji drops the whole emoji, never a lone half', () => {
    const emoji = [{ role: 'assistant' as const, text: '😀'.repeat(300), time: 1 }]
    for (const cap of [49, 50, 51, 99, 100]) {
      const text = pageTranscript(emoji, { entryCap: cap }).entries[0]!.text
      expect(text.endsWith('…')).toBe(true)
      expect(/[\ud800-\udbff]…$/.test(text)).toBe(false); expect(/(^|[^\ud800-\udbff])[\udc00-\udfff]/.test(text)).toBe(false)
    }
  })
})
