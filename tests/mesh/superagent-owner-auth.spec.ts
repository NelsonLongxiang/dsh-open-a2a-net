// @vitest-environment node
/** Real HTTP + the actual superagent face adapter, with an explicit Host Connection admission-contract fixture. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerSuperagentFaces, type SuperagentFaceDeps } from '../../src/faces/superagent.ts'
import { MockGuiConnection } from './harness.ts'

const ORIGIN = 'https://dsh.example.test:18443'
const bytes = Buffer.from('fixture decision file')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function fixture(withConnection = true) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  if (withConnection) await ctx.plugin(MockGuiConnection, { origin: ORIGIN })
  const calls = { decide: vi.fn(() => ({ ok: true })), settings: vi.fn(() => ({ ok: true })), sync: vi.fn(async () => ({ ok: true, logins: [] })),
    file: vi.fn(() => ({ name: 'fixture.txt', sha256, size: bytes.length })), staffing: vi.fn(async () => ({ ok: true })) }
  const team = { decide: calls.decide, saveSettings: calls.settings, githubCollaborators: calls.sync, settings: { allowed: { github: [] } }, decisionFile: calls.file }
  const outer = vi.fn((req: IncomingMessage) => req.headers['x-fixture-control-denied'] !== '1')
  const deps = { ctx, config: { team: 'dsh' }, superagentHost: team, superagentTeams: { get: () => team, decisionCards: () => [], health: () => [] },
    controlRoute: (handler: (req: IncomingMessage, res: ServerResponse) => void) => (req: IncomingMessage, res: ServerResponse) => {
      if (!outer(req)) { res.writeHead(403, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, code: 'control-refused' })); return }
      handler(req, res)
    },
    readJsonBody: (req: IncomingMessage, _res: ServerResponse, use: (body: Record<string, unknown>) => void) => {
      let body = ''; req.on('data', part => { body += String(part) }); req.on('end', () => use(JSON.parse(body)))
    },
    staffing: { list: () => [], agree: calls.staffing },
    blobStore: { list: () => [{ sha256 }], read: () => bytes },
  } as unknown as SuperagentFaceDeps
  registerSuperagentFaces(ctx.webServer, deps)
  const send = (path: string, body?: Record<string, unknown>, headers: Record<string, string> = {}) => new Promise<{ status: number; text: string; data: any }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: ctx.webServer.port, path, method: body === undefined ? 'GET' : 'POST',
      headers: { host: new URL(ORIGIN).host, origin: ORIGIN, 'content-type': 'application/json', cookie: 'dsh-auth-test=1', ...headers } }, res => {
      let text = ''; res.on('data', part => { text += String(part) }); res.on('end', () => { let data: unknown; try { data = JSON.parse(text) } catch { data = text }; resolve({ status: res.statusCode!, text, data }) })
    })
    req.once('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body))
  })
  return { ctx, calls, send, outer, connection: withConnection ? ctx.get('connection') as unknown as MockGuiConnection : undefined }
}

const operations = [
  { label: 'decision', path: '/__dsh_a2a/superagent/decisions', body: { id: 'fixture-card', how: 'choose', option: 'A' }, effect: 'decide' },
  { label: 'decision file', path: `/__dsh_a2a/superagent/decisions/file?card=fixture-card&sha256=${sha256}`, body: undefined, effect: 'file' },
  { label: 'rule settings', path: '/__dsh_a2a/superagent', body: { action: 'settings', settings: { rules: [] } }, effect: 'settings' },
  { label: 'GitHub allowlist sync', path: '/__dsh_a2a/superagent', body: { action: 'sync-github-allowed' }, effect: 'sync' },
  { label: 'staffing agreement', path: '/__dsh_a2a/superagent/staffing', body: { action: 'agree', id: 'fixture-change' }, effect: 'staffing' },
] as const

describe('original-request browser-owner guarded HTTP faces', () => {
  it.each(operations)('accepts a domain + forwarded-port browser owner for $label without rewriting Host/Origin', async op => {
    const f = await fixture()
    const result = await f.send(op.path, op.body)
    expect(result.status).toBe(200)
    expect(f.calls[op.effect]).toHaveBeenCalledTimes(1)
    expect(f.connection!.requests).toHaveLength(1)
    expect(f.connection!.requests[0]!.headers).toMatchObject({ host: 'dsh.example.test:18443', origin: ORIGIN, cookie: 'dsh-auth-test=1' })
    expect(op.effect === 'file' ? result.text : result.data.ok).toBe(op.effect === 'file' ? bytes.toString() : true)
  })

  it.each(operations)('refuses $label before effects without a valid browser login', async op => {
    const f = await fixture()
    for (const cookie of ['', 'expired-fixture=1', 'fixture-api-operator=1']) {
      const result = await f.send(op.path, op.body, { cookie, 'x-api-key': 'fixture-key-does-not-prove-owner' })
      expect(result.status).toBe(cookie === 'fixture-api-operator=1' ? 403 : 401)
      expect(result.data).toMatchObject({ ok: false, code: 'owner-proof' })
    }
    expect(f.calls[op.effect]).not.toHaveBeenCalled()
  })

  it('keeps Host/Origin and control-route fences independent of browser-owner proof', async () => {
    const f = await fixture()
    const op = operations[0]
    expect((await f.send(op.path, op.body, { origin: 'https://untrusted.example', 'x-forwarded-host': 'dsh.example.test:18443' })).status).toBe(403)
    expect((await f.send(op.path, op.body, { host: 'another.example:18443' })).status).toBe(403)
    const before = f.connection!.requests.length
    expect((await f.send(op.path, op.body, { 'x-fixture-control-denied': '1' })).data.code).toBe('control-refused')
    expect(f.connection!.requests).toHaveLength(before)
    expect(f.calls.decide).not.toHaveBeenCalled()
  })

  it.each(operations)('fails closed and names unavailable host admission for $label', async op => {
    const f = await fixture(false)
    const result = await f.send(op.path, op.body)
    expect(result).toMatchObject({ status: 503, data: { ok: false, code: 'owner-auth-unavailable' } })
    expect(f.calls[op.effect]).not.toHaveBeenCalled()
  })

  it('fails closed without exposing exceptions when the optional service lookup throws', async () => {
    const f = await fixture()
    const get = f.ctx.get.bind(f.ctx)
    const lookup = vi.spyOn(f.ctx, 'get').mockImplementation(((name: string) => {
      if (name === 'connection') throw new Error('fixture-private-provider-error')
      return get(name)
    }) as typeof f.ctx.get)
    try {
      const result = await f.send(operations[0].path, operations[0].body)
      expect(result).toMatchObject({ status: 503, data: { ok: false, code: 'owner-auth-unavailable' } })
      expect(result.text).not.toContain('fixture-private-provider-error')
      expect(f.calls.decide).not.toHaveBeenCalled()
    } finally { lookup.mockRestore() }
  })

  it('does not narrow unrelated control-only non-rule settings', async () => {
    const f = await fixture(false)
    expect((await f.send('/__dsh_a2a/superagent', { action: 'settings', settings: { paused: true } }, { cookie: '' })).data.ok).toBe(true)
    expect(f.calls.settings).toHaveBeenCalledOnce()
  })
})
