// @vitest-environment node
/**
 * Boundary-hardening wave (0.6.25) — W2 wire pin + W3 card-face pin
 * (cross-host shapes on the real mesh harness).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPrivateKey, sign as edSign } from 'node:crypto'
import { bootNode, reservePort, type MeshNode } from './harness.ts'

beforeEach(() => {
  vi.stubGlobal('WebSocket', function throwOnSocket() { throw new Error('no socket') })
})
afterEach(() => { vi.unstubAllGlobals() })

/** Craft a raw four-header envelope signed with `node`'s own card key. */
function rawEnvelope(node: MeshNode, caller: string): Record<string, string> {
  const key = createPrivateKey(readFileSync(join(node.home, 'a2a', 'node-key.pem'), 'utf8'))
  const callerUrl = `http://127.0.0.1:${String(node.port)}`
  const ts = Date.now()
  const sig = edSign(undefined, Buffer.from(JSON.stringify([caller, callerUrl, ts]), 'utf8'), key).toString('base64')
  return { 'X-A2A-Caller': caller, 'X-A2A-Caller-Url': callerUrl, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': sig }
}

/** Add one member (local or remote-ref) to a canvas via the workbench seam. */
async function canvasAddMember(node: MeshNode, canvas: string, id: string): Promise<void> {
  const res = await globalThis.fetch(`http://127.0.0.1:${String(node.port)}/__dsh_a2a/canvas`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add-member', name: canvas, id }),
  })
  if (!res.ok) throw new Error(`canvas add-member ${res.status}: ${await res.text()}`)
  const body = await res.json() as { ok?: boolean }
  if (body.ok !== true) throw new Error(`canvas add-member rejected: ${JSON.stringify(body)}`)
}

async function joinSession(node: MeshNode, id: string): Promise<void> {
  const res = await globalThis.fetch(`http://127.0.0.1:${String(node.port)}/__dsh_a2a/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
  })
  if (res.status !== 200) throw new Error(`join ${res.status}: ${await res.text()}`)
}

async function directDelivery(node: MeshNode, callerSession: string, message: string): Promise<{ error?: string; routed?: boolean }> {
  return await (await globalThis.fetch(`http://127.0.0.1:${String(node.port)}/a2a/direct`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ team: 'dsh', message, caller_session: callerSession }),
  })).json() as { error?: string; routed?: boolean }
}

describe('W2: cross-host canvas link on the wire face', () => {
  it('a foreign-zone caller with no link is refused; the canvas remote ref links it', async () => {
    const target = await bootNode({ name: 'w2t', session: 'mesh-w2t', team: 'dsh', sessionNodes: true, teamScopeRouting: true })
    try {
      // Before any link: a foreign-zone delivery is refused (N3/N4 pinned
      // so the W2 basis change cannot regress it).
      const bare = await directDelivery(target, 'cargo/aaaabbbb', 'no link yet')
      expect(String(bare.error)).toContain('no operator-established link')
      // The operator adds the canvas remote ref — the cross-host link.
      await canvasAddMember(target, 'fleet', 'cargo/aaaabbbb')
      const linked = await directDelivery(target, 'cargo/aaaabbbb', 'linked now')
      expect(linked.routed).toBe(true)
    } finally {
      await target.dispose()
    }
  })
})

describe('W3: full card = verify ∧ link (#18 X1)', () => {
  it('a verified stranger gets the minimal card; one-sided seeding does NOT link; bilateral seeding links; a canvas ref links', async () => {
    const target = await bootNode({ name: 'w3t', session: 'mesh-w3t', team: 'target-zone', sessionNodes: true })
    const stranger = await bootNode({ name: 'stranger', session: 'mesh-stranger', team: 'stranger-zone' })
    // Review M1 adversarial probe, pinned: the one-sided seeder lists the
    // TARGET in its own config.peers (one line, zero commitment from the
    // target) — card shadows alone are self-description, not links.
    const oneSided = await bootNode({ name: 'oneside', session: 'mesh-one', team: 'one-zone', peers: [target.baseUrl] })
    // Bilateral: a twin target and a caller that seed EACH OTHER — both
    // operators made the gesture. Ports are reserved up front because the
    // two configs cross-reference each other's URLs.
    const biPort = await reservePort()
    const twinPort = await reservePort()
    const targetSeeded = await bootNode({ name: 'w3t2', session: 'mesh-w3t', team: 'target-zone', sessionNodes: true, port: twinPort, peers: [`http://127.0.0.1:${String(biPort)}`] })
    const bilateral = await bootNode({ name: 'bilateral', session: 'mesh-bi', team: 'bi-zone', port: biPort, peers: [`http://127.0.0.1:${String(twinPort)}`] })
    try {
      // target's operator joins the live session so the full card carries
      // sessionTeams — the field the X1 probe checks for.
      await joinSession(target, 'session-0123456789abcdef')
      await joinSession(targetSeeded, 'session-0123456789abcdef')
      // X1: stranger's envelope VERIFIES (fresh node, own key, real card)
      // but no link exists — canvas empty, not same-host, no seeding at
      // all. Minimal card.
      const strangerCard = await (await globalThis.fetch(`http://127.0.0.1:${String(target.port)}/.well-known/agent-card.json`, { headers: rawEnvelope(stranger, 'stranger-zone') })).json() as { sessionTeams?: unknown }
      expect(strangerCard.sessionTeams).toBeUndefined()
      // Adversarial probe pin: the one-sided seeder STILL gets the minimal
      // card from a target that does not seed it back.
      const oneCard = await (await globalThis.fetch(`http://127.0.0.1:${String(target.port)}/.well-known/agent-card.json`, { headers: rawEnvelope(oneSided, 'one-zone') })).json() as { sessionTeams?: unknown }
      expect(oneCard.sessionTeams).toBeUndefined()
      // Bilateral pin: the target-seeded twin serves the full card to the
      // caller whose own card reciprocates.
      const biCard = await (await globalThis.fetch(`http://127.0.0.1:${String(targetSeeded.port)}/.well-known/agent-card.json`, { headers: rawEnvelope(bilateral, 'bi-zone') })).json() as { sessionTeams?: Array<{ team: string }> }
      expect(Array.isArray(biCard.sessionTeams)).toBe(true)
      expect(biCard.sessionTeams?.some(entry => entry.team === 'target-zone/01234567')).toBe(true)
      // And a canvas remote ref links too (the operator-side basis): a
      // node whose ZONE the ref names gets the full card — the ref proves
      // the zone, the envelope signature proves the key.
      await canvasAddMember(target, 'fleet', 'ref-zone/11112222')
      const refNode = await bootNode({ name: 'refnode', session: 'mesh-ref', team: 'ref-zone' })
      try {
        const refCard = await (await globalThis.fetch(`http://127.0.0.1:${String(target.port)}/.well-known/agent-card.json`, { headers: rawEnvelope(refNode, 'ref-zone') })).json() as { sessionTeams?: unknown }
        expect(Array.isArray(refCard.sessionTeams)).toBe(true)
      } finally {
        await refNode.dispose()
      }
    } finally {
      await targetSeeded.dispose()
      await bilateral.dispose()
      await oneSided.dispose()
      await stranger.dispose()
      await target.dispose()
    }
  }, 30_000)
})

