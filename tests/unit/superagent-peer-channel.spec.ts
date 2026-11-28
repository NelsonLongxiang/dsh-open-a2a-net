// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs'
import { generateKeyPairSync } from 'node:crypto'
import { encodePublicKey } from '../../src/card.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from '../temp-dirs.ts'
import { SuperagentHost } from '../../src/superagent/host/index.ts'
import { routeItem } from '../../src/superagent/host/tools.ts'
import type { SuperagentHostDeps } from '../../src/superagent/host/deps.ts'
import { PEER_CHANNEL_LIFETIME, readPeerStatusQuery, signPeerStatus } from '../../src/superagent/host/peer-channel.ts'

const router = 'session-router', sender = 'session-sender', peer = 'session-peer', observer = 'session-observer'
const start = Date.parse('2026-11-26T10:00:00Z')

type RemoteDeps = Pick<SuperagentHostDeps, 'peerHostMatches' | 'signedPost'>
const remotePeer = { ref: 'remote/01234567@abcdef12', url: 'https://peer.example.test', key: 'fixture-host-key' }

async function fixture(remote?: RemoteDeps & { key?: string }) {
  const home = mkdtempSync(join(tmpdir(), 'peer-channel-'))
  let members = [router, sender, peer, observer]
  const clock = { now: start }
  const deliver = vi.fn<NonNullable<SuperagentHostDeps['deliverPeerMessage']>>(() => 'queued')
  const deps = { home, logger: { info() {}, warn() {} }, deliverToSession: () => true,
    interval: () => () => {},
    canvasTeam: () => ({ local: members, remote: remote === undefined ? [] : [{ ...remotePeer, key: remote.key ?? remotePeer.key }] }),
    peerHostMatches: remote?.peerHostMatches, signedPost: remote?.signedPost,
    peerTeamAddress: () => 'fixture/canvas/team@abcdef12', deliverPeerMessage: deliver,
    now: () => new Date(clock.now).toISOString(),
    presetOf: (id: string) => id === observer || id === peer ? 'superagent-observer' : id === router ? 'superagent-router' : 'superagent-member',
  } as unknown as SuperagentHostDeps
  const open = () => new SuperagentHost(deps)
  const host = open()
  expect(host.saveSettings({ canvas: 'team', router, observerDecides: { maxLevel: 'P1', perHour: 1 } }, () => true)).toMatchObject({ ok: true })
  host.start()
  const request = host.request('Coordinate a held ticket') as { triggerId: string }
  host.pass()
  const accepted = routeItem(host, { trigger_id: request.triggerId, kind: 'accept', title: 'Peer fixture', scope: 'fixture', reason: 'fixture', member: sender })
  const ticket = accepted.ticket_id as string
  await vi.waitFor(() => expect(host.executor.bindingFor(sender, ticket)).toBeDefined())
  clock.now++
  const recipient = remote === undefined ? peer : remotePeer.ref
  const propose = () => host.proposePeerChannel(sender, ticket, recipient, 'Discuss the current ticket')
  const send = (h = host, id = 'known-message') => h.teamMessage(sender, { to: recipient, message_id: id, text: 'A message' })
  return { host, home, clock, ticket, propose, send, open, deliver, members: (next: string[]) => { members = next; host.poolChanged() } }
}

function cardId(result: Record<string, unknown>): string {
  expect(result).toMatchObject({ ok: true, id: expect.any(String) })
  return result.id as string
}

function generation(host: SuperagentHost, id: string): string {
  const cards = host.observerDecisionCards(observer).cards as Array<{ cardId: string; generation: string }>
  return cards.find(card => card.cardId === id)!.generation
}

describe('#931 B grant lifetime and decision boundaries', () => {
  it('requires the actual observer generation and never applies an owner correction as a new grant', async () => {
    const f = await fixture()
    try {
      expect(await f.host.proposePeerChannel(peer, f.ticket, sender, 'Unheld ticket')).toMatchObject({ ok: false, code: 'not-granted' })
      const id = cardId(await f.propose())
      const version = generation(f.host, id)
      expect(f.host.decide(id, 'choose', 'o1')).toMatchObject({ ok: false, code: 'not-owner' })
      expect(f.host.observerOrApproverDecide(peer, id, version, 'o1', 'Self approval')).toMatchObject({ ok: false, code: 'own' })
      expect(f.host.observerOrApproverDecide(observer, id, 'wrong-version', 'o1', 'Stale approval')).toMatchObject({ ok: false, code: 'stale' })
      expect(f.host.observerOrApproverDecide(observer, id, version, 'o1', 'Approved fixture')).toMatchObject({ ok: true, state: 'applied' })
      expect(f.host.ownerObserverDecision(id, 'observer-correct', version, 'o2', 'Correct the record')).toMatchObject({ ok: true, corrected: true })
      expect(f.host.peerGrantViews(sender)).toMatchObject([{ expiresAt: f.clock.now + PEER_CHANNEL_LIFETIME }])
      expect(await f.send()).toMatchObject({ ok: true, status: 'queued' })
      expect(await f.send()).toMatchObject({ ok: true, replayed: true })
      expect(f.deliver).toHaveBeenCalledTimes(1)
    } finally { await f.host.stop() }
  })

  it('persists revocation and expires from the original approval time across restarts', async () => {
    const f = await fixture()
    let restarted: SuperagentHost | undefined
    try {
      const id = cardId(await f.propose())
      const approved = f.clock.now
      expect(f.host.decide(id, 'choose', 'o1', undefined, undefined, true)).toMatchObject({ ok: true, granted: true })
      const original = f.host.peerGrantViews(sender)[0]!
      f.clock.now += 5_000
      expect(f.host.decide(id, 'choose', 'o1', undefined, undefined, true)).toMatchObject({ ok: true, replayed: true })
      expect(f.host.peerGrantViews(sender)).toEqual([original])
      restarted = f.open()
      f.clock.now = approved + PEER_CHANNEL_LIFETIME - 1
      expect(restarted.peerGrantViews(sender)).toEqual([original])
      f.clock.now++
      expect(restarted.peerGrantViews(sender)).toEqual([])
      expect(await f.send(restarted)).toMatchObject({ ok: false, code: 'not-granted' })
      const renewal = cardId(await restarted.proposePeerChannel(sender, f.ticket, peer, 'Request a new approval'))
      expect(restarted.decide(renewal, 'choose', 'o1', undefined, undefined, true)).toMatchObject({ ok: true, granted: true })
      const grant = restarted.peerGrantViews(sender)[0]!
      expect(restarted.peerChannelAdmin(observer, 'revoke', grant.id)).toMatchObject({ ok: true })
      expect(await f.send(restarted)).toMatchObject({ ok: false, code: 'not-granted' })
      const afterRevoke = f.open()
      try { expect(afterRevoke.peerGrantViews(sender)).toEqual([]) } finally { await afterRevoke.stop() }
    } finally { await restarted?.stop(); await f.host.stop() }
  })

  it('keeps an uncertain delivery unchanged when the approved host key cannot be confirmed', async () => {
    const check = vi.fn<NonNullable<RemoteDeps['peerHostMatches']>>(async () => true)
    const post = vi.fn<NonNullable<RemoteDeps['signedPost']>>(async (_url, _path, body) =>
      body.op === 'peer-channel-binding' ? { ok: true, binding: 'fixture-binding' } : { ok: true, status: 'unknown' })
    const f = await fixture({ peerHostMatches: check, signedPost: post })
    try {
      const id = cardId(await f.propose())
      expect(f.host.decide(id, 'choose', 'o1', undefined, undefined, true)).toMatchObject({ ok: true, granted: true })
      expect(await f.send()).toMatchObject({ ok: true, status: 'unknown' })
      post.mockClear()
      check.mockClear()
      check.mockResolvedValue(false)
      const query = { to: remotePeer.ref, ticket_id: f.ticket, message_id: 'known-message' }
      expect(await f.host.teamMessage(sender, query, true)).toMatchObject({ ok: true, status: 'unknown' })
      expect(post).not.toHaveBeenCalled()
      expect(check).toHaveBeenCalledWith(remotePeer.url, remotePeer.key)
      expect(f.host.peerChannelAdmin(observer, 'audit', f.ticket)).toMatchObject({ messages: [{ status: 'unknown' }] })
    } finally { await f.host.stop() }
  })

  it.each(['before request', 'before commit'])('keeps an uncertain outcome when the grant changes %s', async when => {
    const key = generateKeyPairSync('ed25519')
    const check = vi.fn<NonNullable<RemoteDeps['peerHostMatches']>>(async () => true)
    const post = vi.fn<NonNullable<RemoteDeps['signedPost']>>(async (_url, _path, body) =>
      body.op === 'peer-channel-binding' ? { ok: true, binding: 'fixture-binding' } : { ok: true, status: 'unknown' })
    const f = await fixture({ peerHostMatches: check, signedPost: post, key: encodePublicKey(key.publicKey) })
    try {
      const id = cardId(await f.propose())
      expect(f.host.decide(id, 'choose', 'o1', undefined, undefined, true)).toMatchObject({ ok: true, granted: true })
      expect(await f.send()).toMatchObject({ ok: true, status: 'unknown' })
      const revoke = () => f.host.peerChannelAdmin(observer, 'revoke', f.host.peerGrantViews(sender)[0]!.id)
      post.mockClear()
      if (when === 'before request') check.mockImplementationOnce(async () => { revoke(); return true })
      else post.mockImplementationOnce(async (_url, _path, body) => {
        revoke()
        const query = readPeerStatusQuery(body.message)!
        return { ok: true, status: 'queued', proof: signPeerStatus(String(body.team), String(body.member), query, 'queued', key.privateKey) }
      })
      const query = { to: remotePeer.ref, ticket_id: f.ticket, message_id: 'known-message' }
      expect(await f.host.teamMessage(sender, query, true)).toMatchObject({ ok: true, status: 'unknown' })
      expect(post).toHaveBeenCalledTimes(when === 'before request' ? 0 : 1)
      expect(f.host.peerChannelAdmin(observer, 'audit', f.ticket)).toMatchObject({ messages: [{ status: 'unknown' }] })
    } finally { await f.host.stop() }
  })

  it('advances the existing attempt only for a fresh status proof from the pinned host', async () => {
    const key = generateKeyPairSync('ed25519')
    const check = vi.fn<NonNullable<RemoteDeps['peerHostMatches']>>(async () => true)
    const post = vi.fn<NonNullable<RemoteDeps['signedPost']>>(async (_url, _path, body) =>
      body.op === 'peer-channel-binding' ? { ok: true, binding: 'fixture-binding' } : { ok: true, status: 'unknown' })
    const f = await fixture({ peerHostMatches: check, signedPost: post, key: encodePublicKey(key.publicKey) })
    try {
      const id = cardId(await f.propose())
      expect(f.host.decide(id, 'choose', 'o1', undefined, undefined, true)).toMatchObject({ ok: true, granted: true })
      expect(await f.send()).toMatchObject({ ok: true, status: 'unknown' })
      const query = { to: remotePeer.ref, ticket_id: f.ticket, message_id: 'known-message' }
      const reply = (body: Record<string, unknown>) => {
        expect(body.op).toBe('peer-channel-status')
        const query = readPeerStatusQuery(body.message)!
        expect(body.message).toEqual(query)
        return { ok: true, status: 'queued', proof: signPeerStatus(String(body.team), String(body.member), query, 'queued', key.privateKey) }
      }
      let previous: Record<string, unknown> | undefined
      post.mockImplementationOnce(async (_url, _path, body) => {
        previous = reply(body)
        return { ok: true, status: 'unknown' }
      })
      expect(await f.host.teamMessage(sender, query, true)).toMatchObject({ status: 'unknown' })
      post.mockResolvedValueOnce(previous!)
      expect(await f.host.teamMessage(sender, query, true)).toMatchObject({ status: 'unknown' })
      post.mockResolvedValueOnce({ ok: true, status: 'queued' })
      expect(await f.host.teamMessage(sender, query, true)).toMatchObject({ status: 'unknown' })
      post.mockImplementationOnce(async (_url, _path, body) => reply(body))
      expect(await f.host.teamMessage(sender, query, true)).toMatchObject({ status: 'queued' })
      expect(f.host.peerChannelAdmin(observer, 'audit', f.ticket)).toMatchObject({ messages: [{ status: 'queued' }] })
      expect(post.mock.calls.filter(([, , body]) => body.op === 'peer-channel-message')).toHaveLength(1)
    } finally { await f.host.stop() }
  })

  it('does not redeliver an unknown attempt after restart', async () => {
    const f = await fixture()
    let reopened: SuperagentHost | undefined
    try {
      const id = cardId(await f.propose())
      const version = generation(f.host, id)
      expect(f.host.decide(id, 'choose', 'o1', undefined, undefined, true)).toMatchObject({ ok: true, granted: true })
      expect(f.host.observerOrApproverDecide(observer, id, version, 'o1', 'Racing approval')).toMatchObject({ ok: false })
      f.deliver.mockImplementationOnce(() => { throw Error('lost acceptance') })
      expect(await f.send()).toMatchObject({ ok: true, status: 'unknown' })
      reopened = f.open()
      expect(await f.send(reopened)).toMatchObject({ ok: true, status: 'unknown', replayed: true })
      const query = { to: peer, ticket_id: f.ticket, message_id: 'known-message' }
      expect(await reopened.teamMessage(sender, query, true)).toEqual({ ok: true, messageId: 'known-message', status: 'unknown' })
      expect(await reopened.teamMessage(observer, query, true)).toMatchObject({ ok: false, code: 'not-granted' })
      expect(f.deliver).toHaveBeenCalledTimes(1)
    } finally { await reopened?.stop(); await f.host.stop() }
  })

  it('invalidates a removed and re-added recipient, and refuses an unreadable authorization journal', async () => {
    const f = await fixture()
    try {
      const id = cardId(await f.propose())
      expect(f.host.decide(id, 'choose', 'o1', undefined, undefined, true)).toMatchObject({ ok: true, granted: true })
      f.members([router, sender, observer])
      f.members([router, sender, observer, peer])
      expect(await f.send()).toMatchObject({ ok: false, code: 'not-granted' })
      const path = join(f.home, 'superagent', 'peer-channels.json')
      const journal = JSON.parse(readFileSync(path, 'utf8'))
      journal.grants[0].approvedAt = 'invalid'
      writeFileSync(path, JSON.stringify(journal))
      const reopened = f.open()
      try { expect(await f.send(reopened)).toMatchObject({ ok: false, code: 'not-granted' }) } finally { await reopened.stop() }
      expect(f.deliver).not.toHaveBeenCalled()
    } finally { await f.host.stop() }
  })
})
