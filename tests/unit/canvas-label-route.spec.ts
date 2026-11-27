// @vitest-environment node
/** #953 P1: the set-label action of /__dsh_a2a/canvas over real HTTP: owner proof, validation, the state projection. */
import { mkdtempSync } from '../temp-dirs.ts'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAdminFaces, type AdminFaceDeps } from '../../src/faces/admin.ts'
import { CANVAS_NOTIFY_DEBOUNCE_MS } from '../../src/faces/canvas-notify.ts'
import { CanvasStore } from '../../src/canvas-store.ts'
import { PeerStore } from '../../src/peer-store.ts'
import { OWNER_DELEGATE_HEADER, OwnerDelegates, issueOwnerDelegate } from '../../src/superagent/host/owner-delegate.ts'
import { configureOwnerDelegates } from '../../src/superagent/host/owner-proof.ts'

let server: Server, base = '', dir = '', auditPath = '', token = '', store: CanvasStore
const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()
const disposers: Array<() => void> = []
let peerStore: PeerStore
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'canvas-label-route-'))
  auditPath = join(dir, 'audit.jsonl')
  const delegates = join(dir, 'delegates.json')
  token = issueOwnerDelegate(delegates, '带教', 30, { read: () => undefined, write: (p, t) => writeFileSync(p, t), random: () => ({ token: 'dshod_fixture-token', id: 'd-1' }), now: () => new Date() }).token
  configureOwnerDelegates(new OwnerDelegates(delegates, auditPath))
  store = new CanvasStore(join(dir, 'a2a', 'canvas.json'))
  store.create('alpha'); store.create('beta')
  peerStore = new PeerStore([], '')
  routes.clear(); logger.info.mockClear()
  const connection = { browserPeer: { id: 'owner' }, admit: (req: Pick<IncomingMessage, 'headers'>) => (req.headers.cookie === 'login=ok' ? { peer: { id: 'owner' } } : { rejection: 401 as const }) }
  const ctx = new Proxy({ effect: (fn: () => unknown) => {
    const dispose = fn()
    if (typeof dispose === 'function') disposers.push(() => { dispose() })
  }, get: () => connection } as Record<string, unknown>, { get: (target, key) => (key in target ? target[key as string] : () => undefined) })
  const webServer = { register: (r: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) => { routes.set(r.path, r.handler); return () => undefined } }
  const readJsonBody = (req: IncomingMessage, _res: ServerResponse, use: (body: unknown) => void) => { let text = ''; req.on('data', c => { text += String(c) }); req.on('end', () => use(JSON.parse(text))) }
  const d = new Proxy({ ctx, config: { team: 'dsh' }, canvasStore: store, peerStore, logger, controlRoute: (h: unknown) => h, readJsonBody, ownCanvasFingerprint: 'abcd1234' } as Record<string, unknown>, { get: (target, key) => (key in target ? target[key as string] : undefined) }) as unknown as AdminFaceDeps
  registerAdminFaces(webServer as never, d)
  server = createServer((req, res) => { const handler = routes.get(new URL(req.url ?? '/', 'http://x').pathname); if (handler === undefined) { res.writeHead(404); res.end(); return } handler(req, res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`
})
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  configureOwnerDelegates(undefined)
  await new Promise<void>(resolve => server.close(() => resolve()))
})

const post = async (body: unknown, headers: Record<string, string> = { [OWNER_DELEGATE_HEADER]: token }): Promise<{ status: number; json: Record<string, any> }> => {
  const res = await fetch(base + '/__dsh_a2a/canvas', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json() as Record<string, any> }
}
const audit = (): Array<Record<string, any>> => { try { return readFileSync(auditPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } }

describe('set-label', () => {
  it('flushes a real debounced canvas notification when there are no peers', async () => {
    const list = vi.spyOn(peerStore, 'list')
    const response = await post({ action: 'set-label', name: 'alpha', label: 'Updated' })
    expect(response).toMatchObject({ status: 200, json: { ok: true, label: 'Updated' } })
    await delay(CANVAS_NOTIFY_DEBOUNCE_MS)
    expect(list).toHaveBeenCalled()
    expect(store.labelOf('alpha')).toBe('Updated')
  })
  it('needs the owner: nothing is 401, a bad delegate 403, a delegate or the browser login sets it; a refusal changes nothing', async () => {
    expect((await post({ action: 'set-label', name: 'alpha', label: '采集队' }, {})).status).toBe(401)
    expect((await post({ action: 'set-label', name: 'alpha', label: '采集队' }, { [OWNER_DELEGATE_HEADER]: 'dshod_wrong' })).status).toBe(403)
    expect(store.labelOf('alpha')).toBeUndefined(); expect(audit()).toEqual([])
    const ok = await post({ action: 'set-label', name: 'alpha', label: ' 采集队 ' })
    expect(ok).toMatchObject({ status: 200, json: { ok: true, name: 'alpha', label: '采集队', teams: ['alpha', 'beta'] } })
    expect(audit()).toEqual([expect.objectContaining({ id: 'd-1', name: '带教', method: 'POST', path: '/__dsh_a2a/canvas' })])
    expect(store.labelOf('alpha')).toBe('采集队')
    expect((await post({ action: 'set-label', name: 'beta', label: '乙队' }, { cookie: 'login=ok' })).json).toMatchObject({ ok: true, label: '乙队' })
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('set-label'), 'alpha', false, true)
  })
  it('refuses an address-shaped, overlong or control-character label, an unknown team and a missing label, keeping the old one', async () => {
    await post({ action: 'set-label', name: 'alpha', label: '好' })
    for (const label of ['dsh/66abc2cf', 'x'.repeat(65), 'a\nb', 7, '   ', '', null, undefined]) expect((await post({ action: 'set-label', name: 'alpha', ...(label === undefined ? {} : { label }) })).json).toMatchObject({ ok: false, code: 'label' })
    expect((await post({ action: 'set-label', name: 'ghost', label: 'x' })).json).toMatchObject({ ok: false, code: 'no-team' })
    expect(store.labelOf('alpha')).toBe('好')
  })
  it('clear removes it; the team name, the team list and the members are untouched', async () => {
    store.create('gamma')
    await post({ action: 'set-label', name: 'gamma', label: '丙' })
    expect((await post({ action: 'set-label', name: 'gamma', clear: true })).json).toMatchObject({ ok: true, label: null, teams: ['alpha', 'beta', 'gamma'] })
    expect(store.labelOf('gamma')).toBeUndefined(); expect(store.list()).toEqual(['alpha', 'beta', 'gamma'])
  })
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])('returns a string when setting and null when clearing a label for %s', async (name) => {
    expect(store.create(name)).toBe(name)
    const set = await post({ action: 'set-label', name, label: 'Display team' })
    expect(set).toMatchObject({ status: 200, json: { ok: true, name, label: 'Display team' } })
    const cleared = await post({ action: 'set-label', name, clear: true })
    expect(cleared).toMatchObject({ status: 200, json: { ok: true, name, label: null } })
  })
  it('the other canvas actions are not owner-gated by this change: remove still works with only the control key', async () => {
    expect((await post({ action: 'remove', name: 'beta' }, {})).json).toMatchObject({ ok: true })
    expect(store.hasTeam('beta')).toBe(false)
  })
})
