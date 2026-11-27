// @vitest-environment node
/** #933: the pairing routes — a terminal starts and polls openly; only the browser owner allows or refuses. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerOwnerDelegateFaces } from '../../src/faces/superagent.ts'
import { OWNER_DELEGATE_HEADER, parseOwnerDelegates } from '../../src/superagent/host/owner-delegate.ts'

type Handler = (req: unknown, res: unknown) => void
let dir = '', store = ''
let routes: Record<string, Handler> = {}
const OWNER = 'x-test-browser-owner'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pair-face-'))
  store = join(dir, 'owner-delegates.json')
  routes = {}
  const connection = { browserPeer: { id: 'owner' }, admit: (req: { headers: Record<string, string> }) => (req.headers[OWNER] === '1' ? { peer: { id: 'owner' } } : { rejection: 401 }) }
  registerOwnerDelegateFaces({ register: (row: { path: string; handler: Handler }) => { routes[row.path] = row.handler; return () => {} } } as never, {
    ctx: { effect: (fn: () => unknown) => fn(), get: () => connection } as never,
    controlRoute: fn => fn,
    readJsonBody: (req, _res, use) => use((req as unknown as { body: never }).body),
    ownerDelegatesPath: store,
  })
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const call = (path: string, method: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) => new Promise<{ status: number; body: Record<string, unknown>; text: string; headers: Record<string, unknown> }>((resolve) => {
  let status = 0, sent: Record<string, unknown> = {}
  routes[path]!({ method, url: path, headers, body, socket: { remoteAddress: 'client-a', localPort: 3080 } }, {
    writeHead: (s: number, h: Record<string, unknown>) => { status = s; sent = h ?? {} },
    end: (text: string) => { resolve({ status, body: JSON.parse(text) as Record<string, unknown>, text, headers: sent }) },
  })
})
const PAIR = '/__dsh_a2a/owner-delegates/pair', DELEGATES = '/__dsh_a2a/owner-delegates'
const owner = { [OWNER]: '1' }

describe('#933 pairing routes', () => {
  it('start → owner lists and allows → the terminal collects the token once; the store holds its digest only', async () => {
    const started = await call(PAIR, 'POST', { action: 'start', name: 'laptop', days: 7 })
    expect(started.status).toBe(200)
    const { id, code, secret } = started.body as { id: string; code: string; secret: string }
    expect(started.headers['Cache-Control']).toBe('no-store')
    const listed = await call(DELEGATES, 'GET', undefined, owner)
    expect(listed.body.pairings).toEqual([expect.objectContaining({ id, code, name: 'laptop', days: 7, state: 'waiting' })])
    expect(listed.text).not.toContain(secret)
    expect((await call(PAIR, 'POST', { action: 'poll', id, secret })).body).toMatchObject({ state: 'waiting' })
    const approved = await call(DELEGATES, 'POST', { action: 'pair-approve', id }, owner)
    expect(approved).toMatchObject({ status: 200, body: { ok: true } })
    expect(approved.text).not.toContain('dshod_')
    // Nothing is issued on allow: the store is written only when the terminal collects.
    expect(() => readFileSync(store, 'utf8')).toThrow()
    const collected = await call(PAIR, 'POST', { action: 'poll', id, secret })
    expect(collected.body).toMatchObject({ state: 'approved', token: expect.stringMatching(/^dshod_/) })
    expect(collected.headers['Cache-Control']).toBe('no-store')
    const token = collected.body.token as string
    const rows = parseOwnerDelegates(readFileSync(store, 'utf8'))
    expect(rows).toEqual([expect.objectContaining({ name: 'laptop', revokedAt: null })])
    expect(readFileSync(store, 'utf8')).not.toContain(token)
    expect((await call(PAIR, 'POST', { action: 'poll', id, secret })).body).toEqual({ state: 'not-found' })
  })
  it('preserves scope in issuance, pairing approval UI data and token collection', async () => {
    const scope = ['session.read', 'session.list', 'session.read']
    expect((await call(DELEGATES, 'POST', { action: 'issue', name: 'market', scope: null }, owner)).status).toBe(400)
    expect((await call(PAIR, 'POST', { action: 'start', name: 'market', scope: ['session.*'] })).status).toBe(400)
    const issued = await call(DELEGATES, 'POST', { action: 'issue', name: 'market', scope: [] }, owner)
    expect(issued.body.delegate).toMatchObject({ scope: [] })
    const started = await call(PAIR, 'POST', { action: 'start', name: 'market', scope })
    expect(started.body.scope).toEqual(scope)
    const { id, secret } = started.body
    expect((await call(DELEGATES, 'GET', undefined, owner)).body.pairings).toEqual([expect.objectContaining({ id, scope })])
    await call(DELEGATES, 'POST', { action: 'pair-approve', id }, owner)
    expect((await call(PAIR, 'POST', { action: 'poll', id, secret })).body).toMatchObject({ state: 'approved', scope })
    expect(parseOwnerDelegates(readFileSync(store, 'utf8')).map(row => row.scope)).toEqual([[], scope])
  })
  it('allowing needs the browser owner: no login is refused, and an owner delegate cannot stand in', async () => {
    const { id } = (await call(PAIR, 'POST', { action: 'start', name: 'x', days: 1 })).body as { id: string }
    expect((await call(DELEGATES, 'POST', { action: 'pair-approve', id })).status).toBe(401)
    expect((await call(DELEGATES, 'POST', { action: 'pair-approve', id }, { [OWNER_DELEGATE_HEADER]: 'dshod_anything-xxxxxxxxxxxxxxxxxxxxxxxx' })).status).toBe(401)
    expect(() => readFileSync(store, 'utf8')).toThrow()
  })
  it('refusal is told to the terminal; a wrong secret learns nothing', async () => {
    const { id, secret } = (await call(PAIR, 'POST', { action: 'start', name: 'x', days: 1 })).body as { id: string; secret: string }
    expect((await call(PAIR, 'POST', { action: 'poll', id, secret: 'guess' })).body).toEqual({ state: 'not-found' })
    expect((await call(DELEGATES, 'POST', { action: 'pair-deny', id }, owner)).body).toEqual({ ok: true })
    expect((await call(PAIR, 'POST', { action: 'poll', id, secret })).body).toEqual({ state: 'denied' })
  })
  it('the open route takes only POST start or poll, and refuses bad input', async () => {
    expect((await call(PAIR, 'GET')).status).toBe(405)
    expect((await call(PAIR, 'POST', { action: 'approve', id: 'x' })).status).toBe(400)
    expect((await call(PAIR, 'POST', { action: 'start', name: '', days: 1 })).status).toBe(400)
  })
})
