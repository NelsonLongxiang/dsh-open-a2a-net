/**
 * #187: a claim vouches for its signing key always, and for its ORIGIN only when the claim URL is
 * that origin's root — a card fetched from a path under an origin must not let its publisher settle
 * as that origin's host (the compat / host-face settlement roles compare claimOrigin).
 */
import { describe, expect, it } from 'vitest'
import { settlerClaimFields } from '../../src/faces/wire.ts'

const originOf = (url: string): string => new URL(url).origin
const card = { publicKey: 'k-pub' }

describe('settlerClaimFields (#187)', () => {
  it('a root claim URL vouches for origin and key', () => {
    expect(settlerClaimFields({ ok: true, callerUrl: 'https://peer.example', card }, originOf)).toEqual({ claimOrigin: 'https://peer.example', claimKey: 'k-pub' })
    expect(settlerClaimFields({ ok: true, callerUrl: 'https://peer.example/', card }, originOf)).toEqual({ claimOrigin: 'https://peer.example', claimKey: 'k-pub' })
  })

  it('a path-prefixed claim URL vouches for the key only', () => {
    for (const url of ['https://peer.example/apps/slug', 'https://peer.example/a2a/cli/x', 'https://peer.example/?q=1', 'https://user@peer.example']) {
      expect(settlerClaimFields({ ok: true, callerUrl: url, card }, originOf)).toEqual({ claimKey: 'k-pub' })
    }
  })

  it('no claim, or a CLI identity, vouches for nothing', () => {
    expect(settlerClaimFields({ ok: false }, originOf)).toEqual({})
    expect(settlerClaimFields({ ok: true, cli: true, callerUrl: 'https://peer.example', card }, originOf)).toEqual({})
  })
})
