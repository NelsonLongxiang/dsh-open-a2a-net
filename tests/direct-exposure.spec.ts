/**
 * F4 slice (defect card docs/defect-cards-2026-08-30.md): the boot exposure
 * audit for unauthenticated direct deliveries — pure logic over the config,
 * so the matrix is testable without mounting the node.
 */
import { describe, expect, it } from 'vitest'
import { directDeliveryExposure } from '../src/index.ts'

describe('directDeliveryExposure', () => {
  it('loopback-only peers with an empty key are not an exposure', () => {
    const { nonLoopbackPeers, warning } = directDeliveryExposure(['http://127.0.0.1:3081', 'http://localhost:13080'], '')
    expect(nonLoopbackPeers).toEqual([])
    expect(warning).toBeUndefined()
  })

  it('a non-loopback peer with an empty key warns with the actionable fix', () => {
    const { nonLoopbackPeers, warning } = directDeliveryExposure(['http://192.168.3.157:13080'], '')
    expect(nonLoopbackPeers).toEqual(['http://192.168.3.157:13080'])
    expect(warning).toContain('apiKey')
    expect(warning).toContain('unauthenticated direct deliveries')
  })

  it('a non-loopback peer with a configured key is deliberate, not an exposure', () => {
    const { warning } = directDeliveryExposure(['http://192.168.3.157:13080'], 'secret-key')
    expect(warning).toBeUndefined()
  })

  it('every IPv6/bracketed and localhost-suffix spelling counts as loopback', () => {
    const { nonLoopbackPeers } = directDeliveryExposure(
      ['http://[::1]:3081', 'http://[::ffff:127.0.0.1]:3081', 'http://api.localhost:13080', 'http://LOCALHOST:80'],
      '',
    )
    // [::ffff:127.0.0.1] is a loopback in disguise, but host-string matching
    // cannot see it — it stays flagged rather than silently trusted.
    expect(nonLoopbackPeers).toEqual(['http://[::ffff:127.0.0.1]:3081'])
  })

  it('malformed seed URLs say nothing about exposure and never throw', () => {
    const { nonLoopbackPeers, warning } = directDeliveryExposure(['not a url', 'http://192.168.3.157:13080'], '')
    expect(nonLoopbackPeers).toEqual(['http://192.168.3.157:13080'])
    expect(warning).toBeDefined()
  })
})
