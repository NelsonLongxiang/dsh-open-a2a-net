// @vitest-environment node
/**
 * #91 file channel F2 across two real hosts (docs/design/file-channel.md §3.2, §3.5, §3.6): host B's
 * session pulls a file host A staged for it, over A's pull face, signed with B's own card key (the
 * audience-bound envelope), and lands it in its workspace inbox; the fetch taints B's session. A
 * grant for someone else, a reference that lies about the size, and an isolated host all fail visibly.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bootNode, reservePort, tmpHome, type MeshNode } from './harness.ts'
import { formatFileRef } from '../../src/blob-store.ts'

const sha = (b: string): string => createHash('sha256').update(b).digest('hex')
const B_HANDLE = 'bb/01234567' // the harness agent's session-0123456789abcdef on team bb

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const post = async (url: string, body: unknown): Promise<Record<string, any>> =>
  await (await globalThis.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Record<string, any>
const stage = async (a: MeshNode, text: string, to: string, name: string): Promise<Record<string, any>> =>
  await (await globalThis.fetch(`${a.baseUrl}/__dsh_a2a/blob?to=${encodeURIComponent(to)}&name=${encodeURIComponent(name)}`, { method: 'POST', body: text })).json() as Record<string, any>

async function pair(bExtra: Record<string, unknown> = {}): Promise<{ a: MeshNode; b: MeshNode; ws: string; fetchFile: (ref: string) => Promise<Record<string, any>>; dispose: () => Promise<void> }> {
  const a = await bootNode({ name: 'A', session: 'mesh-f2-a', team: 'aa', announce: true, sessionNodes: true, port: await reservePort(), home: tmpHome() })
  const b = await bootNode({ name: 'B', session: 'mesh-f2-b', team: 'bb', announce: true, sessionNodes: true, port: await reservePort(), home: tmpHome(), ...bExtra })
  const ws = mkdtempSync(join(tmpdir(), 'f2-ws-'))
  const agent = b.agents.agent as unknown as { id: unknown; session: { header?: { cwd: string } } }
  agent.session.header = { cwd: ws }
  expect((await post(`${b.baseUrl}/__dsh_a2a/join`, { id: String(agent.id) })).ok).not.toBe(false)
  const tools = b.ctx.get('tools') as unknown as { execute: (input: unknown) => Promise<{ isError: boolean; value?: Record<string, any> }> }
  let n = 0
  const fetchFile = async (ref: string): Promise<Record<string, any>> =>
    (await tools.execute({ name: 'a2a_file_fetch', arguments: { ref }, agent, signal: new AbortController().signal, callId: `call-f2-${String(++n)}` } as never)).value ?? {}
  return { a, b, ws, fetchFile, dispose: async () => { await b.dispose(); await a.dispose() } }
}

describe('#91 F2 — a2a_file_fetch across two hosts', () => {
  it('B pulls the bytes A staged for its session, signed with its own card; they land in the inbox; the fetch taints B', async () => {
    const { a, b, ws, fetchFile, dispose } = await pair()
    try {
      const staged = await stage(a, '跨主机交付件', B_HANDLE, '交付.xlsx')
      expect(staged.ok).toBe(true)
      const ref = formatFileRef({ sha256: sha('跨主机交付件'), size: Buffer.byteLength('跨主机交付件'), name: '交付.xlsx', from: a.baseUrl })
      const out = await fetchFile(ref)
      expect(out, JSON.stringify(out)).toEqual(expect.objectContaining({ ok: true, sha256: sha('跨主机交付件'), name: '交付.xlsx' }))
      expect(out.path).toBe(join(ws, 'a2a-inbox', `${sha('跨主机交付件').slice(0, 12)}-交付.xlsx`))
      expect(readFileSync(out.path as string, 'utf8')).toBe('跨主机交付件')
      const marks = JSON.parse(readFileSync(join(b.home, 'a2a', 'node-taint.json'), 'utf8')) as { sessions: Array<{ session: string; via: string }> }
      expect(marks.sessions).toContainEqual(expect.objectContaining({ via: 'a2a-file_fetch' }))
    } finally { await dispose() }
  }, 90_000)

  it('fails visibly: a grant for another session, a reference that lies about the size, nothing saved', async () => {
    const { a, ws, fetchFile, dispose } = await pair()
    try {
      await stage(a, '别人的件', 'bb/99999999', 'x.txt')
      const theirs = await fetchFile(formatFileRef({ sha256: sha('别人的件'), size: Buffer.byteLength('别人的件'), name: 'x.txt', from: a.baseUrl }))
      // A grant to another session of the same host is not this session's (#91 F2: per-session on the wire).
      expect(theirs).toEqual(expect.objectContaining({ ok: false, code: 'not-granted' }))
      await stage(a, '真大小', B_HANDLE, 'y.txt')
      const lying = await fetchFile(formatFileRef({ sha256: sha('真大小'), size: 3, name: 'y.txt', from: a.baseUrl }))
      expect(lying).toEqual(expect.objectContaining({ ok: false, code: 'size-mismatch' }))
      expect(existsSync(join(ws, 'a2a-inbox', `${sha('真大小').slice(0, 12)}-y.txt`))).toBe(false)
      const unknown = await fetchFile(formatFileRef({ sha256: sha('never'), size: 5, name: 'z', from: a.baseUrl }))
      expect(unknown).toEqual(expect.objectContaining({ ok: false, code: 'not-granted' }))
    } finally { await dispose() }
  }, 90_000)

  it('an isolated host refuses to pull at all', async () => {
    const { a, fetchFile, dispose } = await pair({ isolated: true })
    try {
      await stage(a, '隔离', B_HANDLE, 'i.txt')
      const out = await fetchFile(formatFileRef({ sha256: sha('隔离'), size: Buffer.byteLength('隔离'), name: 'i.txt', from: a.baseUrl }))
      expect(out).toEqual(expect.objectContaining({ ok: false, code: 'isolated' }))
    } finally { await dispose() }
  }, 90_000)
})
