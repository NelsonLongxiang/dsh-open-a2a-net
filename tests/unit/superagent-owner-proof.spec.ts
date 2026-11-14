// @vitest-environment node
/** Original-request owner authentication: no cookie-only loopback probes, API-owner or missing-service fallback. */
import type { IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { browserOwnerProof, type BrowserOwnerConnection } from '../../src/superagent/host/owner-proof.ts'

const request = (origin: string, cookie = 'fixture-browser=valid'): Pick<IncomingMessage, 'headers'> => {
  const url = new URL(origin)
  return { headers: { host: url.host, origin: url.origin, cookie } }
}

describe('original request browser-owner proof', () => {
  it.each(['http://127.0.0.1:3080', 'http://localhost:3080', 'http://dsh.example.test:13080', 'https://dsh.example.test:8443'])('preserves %s and delegates all trust facts to Host Connection', origin => {
    const req = request(origin)
    const before = { ...req.headers }
    const owner = { id: 'browser-owner' }
    const host: BrowserOwnerConnection = { browserPeer: owner, admit: vi.fn(incoming => {
      expect(incoming).toBe(req)
      expect(incoming.headers).toBe(req.headers)
      expect(incoming.headers).toEqual(before)
      return { peer: owner }
    }) }
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network proof must not be attempted'))
    try {
      expect(browserOwnerProof(host, req)).toEqual({ ok: true })
      expect(host.admit).toHaveBeenCalledExactlyOnceWith(req)
      expect(fetch).not.toHaveBeenCalled()
      expect(req.headers).toEqual(before)
    } finally { fetch.mockRestore() }
  })

  it.each([401, 403] as const)('preserves Host Connection rejection %s even with a cookie and an API key', status => {
    const req = request('https://dsh.example.test:8443')
    req.headers['x-api-key'] = 'fixture-control-key'
    req.headers['x-forwarded-host'] = '127.0.0.1:3080'
    const host: BrowserOwnerConnection = { browserPeer: { id: 'browser-owner' }, admit: vi.fn(() => ({ rejection: status })) }
    expect(browserOwnerProof(host, req)).toMatchObject({ ok: false, status, code: 'owner-proof' })
    expect(host.admit).toHaveBeenCalledExactlyOnceWith(req)
  })

  it('rejects an admitted API Peer even if it is an owner API operator', () => {
    const host = { browserPeer: { id: 'browser-owner' }, admit: () => ({ peer: { id: 'api-owner', principal: { kind: 'owner' } } }) }
    expect(browserOwnerProof(host, request('https://dsh.example.test'))).toMatchObject({ ok: false, status: 403, code: 'owner-proof' })
  })

  it('compares stable Peer identity, not wrapper object reference', () => {
    const host: BrowserOwnerConnection = { browserPeer: { id: 'browser-owner' }, admit: () => ({ peer: { id: 'browser-owner' } }) }
    expect(browserOwnerProof(host, request('https://dsh.example.test'))).toEqual({ ok: true })
  })

  it.each([undefined, null, {}, { browserPeer: { id: 'owner' } }, { admit: () => ({ peer: { id: 'owner' } }) },
    { browserPeer: { id: '' }, admit: () => ({ peer: { id: '' } }) },
    { browserPeer: { id: 'owner' }, admit: () => undefined },
    { browserPeer: { id: 'owner' }, admit: () => ({ rejection: 500 }) },
    { browserPeer: { id: 'owner' }, admit: () => ({ peer: {} }) }])('fails closed for unavailable or malformed Host Connection: %#', host => {
    expect(browserOwnerProof(host, request('http://127.0.0.1:3080'))).toMatchObject({ ok: false, status: 503, code: 'owner-auth-unavailable' })
  })

  it('does not disclose provider exceptions or attempt legacy login probing', () => {
    const host = { browserPeer: { id: 'owner' }, admit: () => { throw new Error('sensitive-cookie-value') } }
    const result = browserOwnerProof(host, request('https://dsh.example.test'))
    expect(result).toMatchObject({ ok: false, status: 503, code: 'owner-auth-unavailable' })
    expect(JSON.stringify(result)).not.toContain('sensitive-cookie-value')
  })
})
