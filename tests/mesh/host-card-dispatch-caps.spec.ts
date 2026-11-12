// @vitest-environment node
/**
 * docs/design/superagent-named-dispatch.md N1: a host running superagent declares on its own card that it reads a
 * request's [A2A dispatch] line (directedSeats, reworkReturns), so a requester writes one only to such a host.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from '../temp-dirs.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootNode, reservePort } from './harness.ts'

beforeEach(() => { vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') }) })
afterEach(() => { vi.unstubAllGlobals() })

const capabilities = async (base: string): Promise<Record<string, unknown>> =>
  ((await (await globalThis.fetch(`${base}/.well-known/agent-card.json`)).json()) as { capabilities: Record<string, unknown> }).capabilities

describe('the host card says whether the host reads dispatch lines', () => {
  it('a superagent host declares directedSeats and reworkReturns; a plain host does not', async () => {
    const sa = await bootNode({ name: 'S', session: 'card-sa', team: 'dsh', port: await reservePort(), home: mkdtempSync(join(tmpdir(), 'card-sa-')), sessionNodes: true, superagent: true } as never)
    const plain = await bootNode({ name: 'P', session: 'card-plain', team: 'dsh', port: await reservePort(), sessionNodes: true } as never)
    try {
      expect(await capabilities(sa.baseUrl)).toMatchObject({ directedSeats: true, reworkReturns: true })
      const other = await capabilities(plain.baseUrl)
      expect(other.directedSeats).toBeUndefined()
      expect(other.reworkReturns).toBeUndefined()
    } finally { await sa.dispose(); await plain.dispose() }
  })
})
