// @vitest-environment node
/**
 * #91 file channel F1b on a real host (docs/design/file-channel.md §3.2, §3.4, §5): the control
 * stage face and the pull face. The pulling identity here is a deposited CLI handle (it signs its
 * own envelope — the narrow cli derivation); host-to-host pulls with the audience-bound form are
 * pinned by F2's two-node test. Every refusal is visible and none says whether the blob exists.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHash, generateKeyPairSync, sign as edSign } from 'node:crypto'
import { readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { bootNode, reservePort, tmpHome, type MeshNode } from './harness.ts'
import { signCard } from '../../src/card.ts'
import { signOriginClaim } from '../../src/origin-claim.ts'
import { BLOB_FILE_MAX } from '../../src/blob-store.ts'
import { BLOB_PULLS_PER_MINUTE, grantAdmits } from '../../src/faces/files.ts'

const HANDLE = 'ops-cli/a1b2c3d4e5f60718'
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex')

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const sign = (key: Parameters<typeof edSign>[2], caller: string, url: string): Record<string, string> => {
  const ts = Date.now()
  return { 'X-A2A-Caller': caller, 'X-A2A-Caller-Url': url, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': edSign(undefined, Buffer.from(JSON.stringify([caller, url, ts])), key).toString('base64') }
}

async function hostWithCli(extra: Record<string, unknown> = {}): Promise<{ a: MeshNode; key: ReturnType<typeof generateKeyPairSync>['privateKey']; face: string }> {
  const a = await bootNode({ name: 'A', session: 'mesh-files', team: 'dsh', sessionNodes: true, port: await reservePort(), home: tmpHome(), ...extra })
  const { privateKey } = generateKeyPairSync('ed25519')
  const card = signCard({ name: 'ops-cli', session: 'cli-ops-cli', team: HANDLE, capabilities: { route: true, async: true }, expiresAt: Date.now() + 172_800_000 }, privateKey)
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(typeof extra.apiKey === 'string' ? { 'X-API-Key': extra.apiKey } : {}) }
  const deposited = await (await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/cli-deposit`, { method: 'POST', headers, body: JSON.stringify({ action: 'publish', card: JSON.stringify(card) }) })).json() as { ok: boolean }
  expect(deposited.ok).toBe(true)
  return { a, key: privateKey, face: `${a.baseUrl}/a2a/cli/${encodeURIComponent(HANDLE)}` }
}

const stage = async (a: MeshNode, bytes: Uint8Array | string, to: string, name = '月报.xlsx', headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, any> }> => {
  const r = await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/blob?to=${encodeURIComponent(to)}&name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body: typeof bytes === 'string' ? bytes : Buffer.from(bytes) })
  return { status: r.status, body: await r.json() as Record<string, any> }
}
const pull = async (a: MeshNode, hash: string, caller: string, headers: Record<string, string>): Promise<Response> =>
  await globalThis.fetch(`${a.baseUrl}/a2a/blob?sha256=${hash}&caller_session=${encodeURIComponent(caller)}`, { headers })

describe('#91 F1b — stage face and pull face', () => {
  it('a granted, signed caller pulls the exact bytes; the grant names it', async () => {
    const { a, key, face } = await hostWithCli()
    try {
      const staged = await stage(a, '一月数据', HANDLE)
      expect(staged.status).toBe(200)
      expect(staged.body).toEqual(expect.objectContaining({ ok: true, sha256: sha('一月数据'), name: '月报.xlsx' }))
      const r = await pull(a, sha('一月数据'), HANDLE, sign(key, 'ops-cli', face))
      expect(r.status).toBe(200)
      expect(r.headers.get('x-a2a-blob-sha256')).toBe(sha('一月数据'))
      expect(decodeURIComponent(r.headers.get('x-a2a-blob-name') ?? '')).toBe('月报.xlsx')
      expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('一月数据')
    } finally { await a.dispose() }
  }, 60_000)

  it('refuses: no caller, no envelope, an envelope that does not prove the caller, a caller the grant does not name, an unknown blob — the last two with one answer', async () => {
    const { a, key, face } = await hostWithCli()
    try {
      await stage(a, 'x', 'dsh/aaaa1111') // granted to someone else
      const h = sha('x')
      const code = async (r: Response): Promise<[number, unknown]> => [r.status, ((await r.json()) as { code?: unknown }).code]
      const why = async (r: Response): Promise<string> => String(((await r.json()) as { error?: unknown }).error)
      expect(await why(await pull(a, h, '', sign(key, 'ops-cli', face)))).toBe('caller_session is required')
      expect(await why(await pull(a, h, HANDLE, {}))).toMatch(/^OriginClaim verification failed \(absent\)/)
      expect(await code(await pull(a, h, HANDLE, {}))).toEqual([403, 'untrusted-origin'])
      // Signed by the CLI, but naming another caller: not proven.
      expect(await code(await pull(a, h, 'dsh/aaaa1111', sign(key, 'ops-cli', face)))).toEqual([403, 'untrusted-origin'])
      // Proven, but not the grant's target; and a blob that does not exist: the same refusal.
      expect(await code(await pull(a, h, HANDLE, sign(key, 'ops-cli', face)))).toEqual([403, 'not-granted'])
      expect(await code(await pull(a, sha('never staged'), HANDLE, sign(key, 'ops-cli', face)))).toEqual([403, 'not-granted'])
      // Another key over the CLI face: the signature fails.
      const other = generateKeyPairSync('ed25519').privateKey
      await stage(a, 'mine', HANDLE)
      expect(await code(await pull(a, sha('mine'), HANDLE, sign(other, 'ops-cli', face)))).toEqual([403, 'untrusted-origin'])
    } finally { await a.dispose() }
  }, 60_000)

  it(`the ${String(BLOB_PULLS_PER_MINUTE + 1)}th pull in a minute is rate-limited`, async () => {
    const { a, key, face } = await hostWithCli()
    try {
      await stage(a, 'often', HANDLE)
      for (let i = 0; i < BLOB_PULLS_PER_MINUTE; i++) expect((await pull(a, sha('often'), HANDLE, sign(key, 'ops-cli', face))).status).toBe(200)
      const over = await pull(a, sha('often'), HANDLE, sign(key, 'ops-cli', face))
      expect(over.status).toBe(429)
      expect(((await over.json()) as { code?: unknown }).code).toBe('rate-limited')
    } finally { await a.dispose() }
  }, 60_000)

  it('a blob whose bytes changed on disk is gone (410), never served', async () => {
    const { a, key, face } = await hostWithCli()
    try {
      await stage(a, '原件', HANDLE)
      expect(readdirSync(join(a.home, 'a2a', 'blobs'))).toContain(sha('原件'))
      writeFileSync(join(a.home, 'a2a', 'blobs', sha('原件')), '篡改')
      const r = await pull(a, sha('原件'), HANDLE, sign(key, 'ops-cli', face))
      expect(r.status).toBe(410)
      expect(((await r.json()) as { code?: unknown }).code).toBe('gone')
    } finally { await a.dispose() }
  }, 60_000)

  it('the stage face is control-gated, POST-only and size-capped', async () => {
    const { a } = await hostWithCli({ apiKey: 'k-files' })
    try {
      expect((await stage(a, 'x', HANDLE)).status).toBe(401)
      expect((await stage(a, 'x', HANDLE, 'a', { 'X-API-Key': 'k-files' })).status).toBe(200)
      expect((await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/blob?to=x`, { headers: { 'X-API-Key': 'k-files' } })).status).toBe(405)
      expect((await stage(a, 'x', '', 'a', { 'X-API-Key': 'k-files' })).status).toBe(400)
      const big = await stage(a, new Uint8Array(BLOB_FILE_MAX + 1), HANDLE, 'big', { 'X-API-Key': 'k-files' })
      expect(big.status).toBe(413)
      // The pull face rides the same apiKey as delivery.
      expect((await pull(a, sha('x'), HANDLE, {})).status).toBe(401)
    } finally { await a.dispose() }
  }, 60_000)
})

describe('#91 F1b — a peer HOST pulls with the audience-bound envelope only', () => {
  it('bound v2 from a root card URL: pulls its own grant and a canvas grant naming a member on its host; the unbound form alone, or a path card URL, does not prove it', async () => {
    const { a } = await hostWithCli()
    const marketKey = generateKeyPairSync('ed25519').privateKey
    const marketCard = signCard({ name: 'market', session: 'market-s', team: 'market', capabilities: { route: true }, expiresAt: Date.now() + 3_600_000 }, marketKey)
    const srv = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(marketCard)) })
    await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', () => resolve()))
    const marketUrl = `http://127.0.0.1:${String((srv.address() as { port: number }).port)}`
    try {
      const envelope = (opts: { unbound?: boolean; bound?: boolean; callerUrl?: string } = {}): Record<string, string> => {
        const h = signOriginClaim({ url: `${a.baseUrl}/a2a/blob`, method: 'GET' }, { caller: 'market', callerUrl: opts.callerUrl ?? marketUrl, privateKey: marketKey, unbound: opts.unbound ?? false, now: Date.now() })
        if (opts.bound === false) { delete h['X-A2A-Caller-Aud']; delete h['X-A2A-Caller-Sig2'] }
        return h
      }
      await stage(a, '交付件', 'market/aaaaaaaa')
      const ok = await pull(a, sha('交付件'), 'market/aaaaaaaa', envelope())
      expect(ok.status, await ok.clone().text()).toBe(200)
      expect(Buffer.from(await ok.arrayBuffer()).toString()).toBe('交付件')
      // The legacy unbound form verifies, but it does not prove a pull.
      const unbound = await pull(a, sha('交付件'), 'market/aaaaaaaa', envelope({ unbound: true, bound: false }))
      expect(unbound.status).toBe(403)
      expect(((await unbound.json()) as { code?: unknown }).code).toBe('untrusted-origin')
      // A card served under a path is that path's publisher, not the origin's host.
      const pathed = await pull(a, sha('交付件'), 'market/aaaaaaaa', envelope({ callerUrl: `${marketUrl}/a2a/cli/x` }))
      expect(pathed.status).toBe(403)
      // The market's signature cannot speak for another zone's session, even one a grant names.
      await stage(a, '别人的', 'dsh/aaaa1111')
      const spoofed = await pull(a, sha('别人的'), 'dsh/aaaa1111', envelope())
      expect(spoofed.status).toBe(403)
      expect(((await spoofed.json()) as { code?: unknown }).code).toBe('untrusted-origin')
      // A canvas team of this host with a member on the market host: another market session may pull.
      const post = async (body: unknown): Promise<unknown> => (await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/canvas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
      expect(((await post({ action: 'create', name: 'ops' })) as { ok?: boolean }).ok).toBe(true)
      expect(((await post({ action: 'add-member', name: 'ops', id: 'market/aaaaaaaa' })) as { ok?: boolean }).ok).toBe(true)
      await stage(a, '队内件', 'dsh/canvas/ops')
      expect((await pull(a, sha('队内件'), 'market/bbbbbbbb', envelope())).status).toBe(200)
    } finally {
      srv.close()
      await a.dispose()
    }
  }, 60_000)
})

describe('grantAdmits (design §3.2)', () => {
  const none = (): readonly string[] => []
  it('the same label; a target the signer zone covers; a canvas team of THIS zone with a member on the signer host — nothing else', () => {
    expect(grantAdmits('peer/aaaa1111', 'peer/aaaa1111', 'peer', 'dsh', none)).toBe(true)
    expect(grantAdmits('peer/canvas/x', 'peer/bbbb2222', 'peer', 'dsh', none)).toBe(true) // the peer's own canvas team: that host answers for it
    expect(grantAdmits('peer', 'peer/bbbb2222', 'peer', 'dsh', none)).toBe(true)
    expect(grantAdmits('other/aaaa1111', 'peer/aaaa1111', 'peer', 'dsh', none)).toBe(false)
    expect(grantAdmits('peerx/aaaa1111', 'peer/aaaa1111', 'peer', 'dsh', none)).toBe(false) // a prefix is not a zone
    const members = (name: string): readonly string[] => (name === 'delivery' ? ['session-local-1', 'peer/aaaa1111'] : [])
    expect(grantAdmits('dsh/canvas/delivery', 'peer/cccc3333', 'peer', 'dsh', members)).toBe(true)
    expect(grantAdmits('dsh/canvas/delivery', 'third/aaaa1111', 'third', 'dsh', members)).toBe(false)
    // Another host's same-named canvas team is a different team: this host's members do not count.
    expect(grantAdmits('zz/canvas/delivery', 'peer/cccc3333', 'peer', 'dsh', members)).toBe(false)
    expect(grantAdmits('dsh/canvas/', 'peer/cccc3333', 'peer', 'dsh', () => ['peer/aaaa1111'])).toBe(false)
  })
})
