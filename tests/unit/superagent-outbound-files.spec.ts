// @vitest-environment node
/** #952: files on an outbound card are granted only when the card is approved, and revoked when it is declined. */
import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from '../temp-dirs.ts'
import { fileCardLines, OutboundRequests, withFileRefs, type OutboundDeps } from '../../src/superagent/host/outbound.ts'
import type { DecisionFile } from '../../src/superagent/host/decisions.ts'

const now = () => '2026-11-28T10:00:00.000Z'
const sha = 'a'.repeat(64)
const file: DecisionFile = { sha256: sha, size: 12, name: 'report.txt', ref: `[A2A file] v1 sha256=${sha} size=12 name=report.txt from=http://127.0.0.1:1` }

function fixture(over: Partial<OutboundDeps> = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'sa-out-files-')), 'outbound.json')
  const ask = vi.fn(async (_address: string, _text: string, task?: string) => task)
  const grantFiles = vi.fn(() => ({ ok: true as const }))
  const revokeFiles = vi.fn()
  const note = vi.fn()
  const out = new OutboundRequests({ path, ask, note, logger: { warn() {} }, now, sender: async () => 'superagent-team/0123456789abcdef', grantFiles, revokeFiles, ...over })
  out.waiting('card', 'ticket', 'dsh/canvas/other@abcdef12', 'please review', 'member', [file])
  return { out, ask, grantFiles, revokeFiles, note }
}

describe('outbound request files', () => {
  it('lists each file by name, byte count and sha256 on the card', () => {
    expect(fileCardLines([file])).toContain('report.txt（12 字节，sha256 ' + sha + '）')
    expect(fileCardLines([])).toBe('')
  })

  it('grants the held files only after approval and sends their references with the approved text', async () => {
    const f = fixture()
    expect(f.grantFiles).not.toHaveBeenCalled()
    await f.out.decided('card', true, 'finance', () => 'cost')
    expect(f.grantFiles).toHaveBeenCalledTimes(1)
    expect(f.ask).toHaveBeenCalledTimes(1)
    expect(f.ask.mock.calls[0]![1]).toBe(withFileRefs('[来自 superagent 团队 finance 的请求 · 工单「cost」]\nplease review', [file]))
    expect(f.ask.mock.calls[0]![1]).toContain(file.ref)
    expect(f.out.list()[0]).toMatchObject({ state: 'sent', files: [{ sha256: sha }] })
  })

  it('sends nothing when the grant is refused, and says why on the ticket', async () => {
    const f = fixture({ grantFiles: () => ({ ok: false, error: 'report.txt is no longer held' }) })
    await f.out.decided('card', true, 'finance', () => 'cost')
    expect(f.ask).not.toHaveBeenCalled()
    expect(f.out.list()[0]).toMatchObject({ state: 'failed' })
    expect(f.note).toHaveBeenCalledWith('ticket', expect.stringContaining('附件未能授权'))
  })

  it('a host that cannot grant files sends nothing', async () => {
    const f = fixture({ grantFiles: undefined })
    await f.out.decided('card', true, 'finance', () => 'cost')
    expect(f.ask).not.toHaveBeenCalled()
    expect(f.out.list()[0]).toMatchObject({ state: 'failed' })
  })

  it('revokes the held files and grants nothing when the card is declined', async () => {
    const f = fixture()
    await f.out.decided('card', false, 'finance', () => 'cost')
    expect(f.revokeFiles).toHaveBeenCalledTimes(1)
    expect(f.grantFiles).not.toHaveBeenCalled()
    expect(f.ask).not.toHaveBeenCalled()
    expect(f.out.list()[0]).toMatchObject({ state: 'declined' })
  })

  it('a request without files behaves as before', async () => {
    const f = fixture()
    const plain = new OutboundRequests({ path: join(mkdtempSync(join(tmpdir(), 'sa-out-files-')), 'o.json'), ask: f.ask, note: f.note, logger: { warn() {} }, now, sender: async () => 'superagent-team/0123456789abcdef', grantFiles: f.grantFiles })
    plain.waiting('c2', 'ticket', 'dsh/aaaaaaaa', 'text', 'member')
    await plain.decided('c2', true, 'finance', () => 'cost')
    expect(f.grantFiles).not.toHaveBeenCalled()
    expect(f.ask).toHaveBeenLastCalledWith('dsh/aaaaaaaa', '[来自 superagent 团队 finance 的请求 · 工单「cost」]\ntext', expect.any(String), expect.any(String))
  })
})
