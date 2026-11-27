// @vitest-environment node
/** #951 S1: the pieces under the routes: deferred owner proof and audit lines, the source's effect on node_update_self, transcript paging, the docs. */
import { mkdtempSync } from '../temp-dirs.ts'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { NodeStore } from '../../src/node-store.ts'
import { NEUTRAL_SOURCES, NodeReviewQueue, SessionTaint, selfUpdate, sessionSource } from '../../src/node-self.ts'
import { personMessageFrom } from '../../src/superagent/session-reads.ts'
import { TranscriptCache } from '../../src/session-log-page.ts'
import { pageTranscript, parseTranscriptEntries, extractTranscript, TRANSCRIPT_PAGE_CHARS_MAX } from '../../src/session-transcript.ts'
import { OWNER_DELEGATE_HEADER, OwnerDelegates } from '../../src/superagent/host/owner-delegate.ts'
import { browserOwnerProof, configureOwnerDelegates } from '../../src/superagent/host/owner-proof.ts'

function book() {
  const dir = mkdtempSync(join(tmpdir(), 'owner-deferred-'))
  const store = join(dir, 'd.json'), audit = join(dir, 'a.jsonl')
  writeFileSync(store, JSON.stringify({ delegates: [{ id: 'd-1', name: '带教', sha256: createHash('sha256').update('tok', 'utf8').digest('hex'), createdAt: new Date().toISOString(), expiresAt: null, revokedAt: null }] }))
  configureOwnerDelegates(new OwnerDelegates(store, audit))
  return { audit, lines: (): Array<Record<string, unknown>> => { try { return readFileSync(audit, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) } catch { return [] } } }
}
const login = { browserPeer: { id: 'o' }, admit: (req: { headers: Record<string, unknown> }) => (req.headers.cookie === 'ok' ? { peer: { id: 'o' } } : { rejection: 401 as const }) }
const req = (headers: Record<string, string>) => ({ headers, method: 'POST', url: '/__dsh_a2a/user/session/prompt?x=1' })

describe('browserOwnerProof deferAudit', () => {
  it('a valid delegate is verified and nothing is written until commit; commit writes the fixed fields then the extras, which cannot replace them', () => {
    const { lines } = book()
    const proof = browserOwnerProof(login, req({ [OWNER_DELEGATE_HEADER]: 'tok' }), { deferAudit: true })
    if (!proof.ok) throw new Error('refused')
    expect(proof.delegate).toEqual({ id: 'd-1', name: '带教' }); expect(lines()).toEqual([])
    expect(proof.commit({ action: 'read', target: 'session-x', id: 'forged', name: 'forged', path: '/forged' })).toBe(true)
    expect(lines()).toEqual([{ at: expect.any(String), id: 'd-1', name: '带教', method: 'POST', path: '/__dsh_a2a/user/session/prompt', action: 'read', target: 'session-x' }])
  })
  it('a bad delegate is 403 and a missing owner 401 with nothing written; a browser login commits as browser-owner with a null id', () => {
    const { lines } = book()
    expect(browserOwnerProof(login, req({ [OWNER_DELEGATE_HEADER]: 'nope' }), { deferAudit: true })).toMatchObject({ ok: false, status: 403, code: 'owner-delegate' })
    expect(browserOwnerProof(login, req({}), { deferAudit: true })).toMatchObject({ ok: false, status: 401 })
    expect(lines()).toEqual([])
    const proof = browserOwnerProof(login, req({ cookie: 'ok' }), { deferAudit: true })
    if (!proof.ok) throw new Error('refused')
    expect(proof.delegate).toBeUndefined(); expect(proof.commit({ action: 'sessions' })).toBe(true)
    expect(lines()[0]).toMatchObject({ id: null, name: 'browser-owner', action: 'sessions' })
  })
  it('commit is false when the audit cannot be written or no book is configured', () => {
    book()
    configureOwnerDelegates(new OwnerDelegates(join(tmpdir(), 'nonexistent-dir-x', 'd.json'), join(tmpdir(), 'nonexistent-dir-x', 'a.jsonl')))
    const proof = browserOwnerProof(login, req({ cookie: 'ok' }), { deferAudit: true })
    if (!proof.ok) throw new Error('refused')
    expect(proof.commit({})).toBe(false)
    configureOwnerDelegates(undefined)
    const none = browserOwnerProof(login, req({ cookie: 'ok' }), { deferAudit: true })
    if (!none.ok) throw new Error('refused'); expect(none.commit({})).toBe(false)
  })
  it('without the option nothing changes: the delegate line is written at proof time with exactly the old five fields, the answer is { ok: true }', () => {
    const { lines } = book()
    expect(browserOwnerProof(login, req({ [OWNER_DELEGATE_HEADER]: 'tok' }))).toEqual({ ok: true })
    expect(Object.keys(lines()[0]!)).toEqual(['at', 'id', 'name', 'method', 'path'])
    expect(browserOwnerProof(login, req({ cookie: 'ok' }))).toEqual({ ok: true }); expect(lines()).toHaveLength(1)
  })
})

describe('what an owner-proxy line does to its session (design B1, M1)', () => {
  const person = { type: 'user/message', data: { source: { kind: 'user' } } }
  const proxy = { type: 'user/message', data: { source: { kind: 'a2a-owner-proxy', delegateName: '带教', mode: 'steer' } } }
  it('the kind is in no source set: the log read says not local, no evidence; it is not a person message either', () => {
    expect(NEUTRAL_SOURCES.has('a2a-owner-proxy')).toBe(false)
    expect(sessionSource([person, proxy])).toEqual({ local: false, via: 'a2a-owner-proxy', evidence: false })
    expect(sessionSource([person])).toEqual({ local: true })
    const asText = { type: 'user/message', time: 5, data: { id: 'm', source: { kind: 'a2a-owner-proxy' }, content: [{ type: 'text', text: '[属主代输入 · x · steer]\n问' }] } }
    expect(personMessageFrom([{ type: 'user/message', time: 1, data: { id: 'p', source: { kind: 'user' }, content: [{ type: 'text', text: '我说' }] } }, asText])).toBeUndefined()
  })
  it('node_update_self in such a session is queued for review, not applied, and leaves no persistent taint mark', () => {
    const store = new NodeStore('', () => '2026-11-26T10:00:00.000Z')
    expect(store.create({ name: 'chief' }, 'human:owner').ok).toBe(true)
    const queue = new NodeReviewQueue(''), taint = new SessionTaint('')
    const written = vi.fn()
    const run = (events: unknown[]) => selfUpdate({ store, queue, taint, events: () => events, onWritten: written }, 'chief', 's-1', {}, { section: '当前状态', text: 't', reason: 'r', expected_sha256: store.get('chief')?.prompt.mutable_sha256 ?? '' })
    expect(run([person, proxy])).toMatchObject({ ok: false, code: 'queued' })
    expect(queue.list()).toHaveLength(1); expect(taint.of('s-1')).toBe(''); expect(written).not.toHaveBeenCalled()
    // a person's later input does not undo it: the way out is the review queue
    expect(run([person, proxy, person])).toMatchObject({ ok: false, code: 'queued' })
    // control: a person alone is applied
    expect(run([person])).toMatchObject({ ok: true })
  })
})

describe('transcript paging', () => {
  const log = Array.from({ length: 12 }, (_, i) => JSON.stringify({ type: i % 2 ? 'assistant/message' : 'user/message', time: i, data: i % 2 ? { message: { content: [{ type: 'text', text: 'a  ' + String(i) + '\n' + 'x'.repeat(600) }] } } : { content: [{ type: 'text', text: 'u ' + String(i) }] } })).join('\n')
  it('pages tile the transcript from the newest back, indices stay put, the cut applies per page, the old extract is unchanged', () => {
    const entries = parseTranscriptEntries(log)
    expect(entries).toHaveLength(12)
    const p1 = pageTranscript(entries, { limit: 5 }), p2 = pageTranscript(entries, { limit: 5, before: p1.from }), p3 = pageTranscript(entries, { limit: 5, before: p2.from })
    expect([p1, p2, p3].map(p => [p.from, p.to])).toEqual([[7, 12], [2, 7], [0, 2]])
    expect([...p3.entries, ...p2.entries, ...p1.entries].map(e => e.i)).toEqual([...Array(12).keys()])
    expect(p1.entries.find(e => e.role === 'assistant')!.text.length).toBe(501)
    expect(pageTranscript(entries, { limit: 5, entryCap: 20 }).entries.find(e => e.role === 'assistant')!.text.length).toBe(21)
    expect(pageTranscript(entries, { entryCap: 99999 }).entries.find(e => e.role === 'assistant')!.text.length).toBeLessThanOrEqual(TRANSCRIPT_PAGE_CHARS_MAX + 1)
    expect(pageTranscript(entries, { before: 99 })).toMatchObject({ stale: true, to: 12 }); expect(pageTranscript(entries, { before: 0 }).entries).toEqual([])
    expect(extractTranscript(log, 3)).toHaveLength(3)
    expect(extractTranscript(log, 12).find(e => e.role === 'assistant')!.text.length).toBe(501)
  })
  it('the cache parses once per file state and again when size or mtime changes; at most four files', () => {
    const cache = new TranscriptCache()
    const parse = vi.fn(() => ({ entries: [{ role: 'user' as const, text: '中文' }], decodedBytes: 100 }))
    expect(cache.parsedBytesEstimate()).toBe(0)
    cache.entries('/a', 1, 1, parse); cache.entries('/a', 1, 1, parse); expect(parse).toHaveBeenCalledTimes(1)
    expect(cache.parsedBytesEstimate()).toBe(6)
    cache.entries('/a', 2, 1, parse); cache.entries('/a', 2, 2, parse); expect(parse).toHaveBeenCalledTimes(3)
    expect(cache.parsedBytesEstimate()).toBe(6)
    for (const f of ['/b', '/c', '/d', '/e', '/f']) cache.entries(f, 1, 1, parse)
    expect(cache.parsedBytesEstimate()).toBe(24)
    const before = parse.mock.calls.length; cache.entries('/b', 1, 1, parse); expect(parse.mock.calls.length).toBe(before + 1)
    cache.entries('/large', 1, 1, () => ({ entries: [], decodedBytes: 17 * 1024 * 1024 }))
    expect(cache.parsedBytesEstimate()).toBe(24)
  })
})

describe('the skill text', () => {
  it('cli.md documents the three commands, the audit and source rules', () => {
    const cli = readFileSync(join(process.cwd(), 'src/skill/references/cli.md'), 'utf8')
    for (const clause of ['user sessions [--team T]', 'user session read <id> [--before N] [--limit N] [--chars N]', 'user session prompt <id> (--steer | --queue)', '[属主代输入 · <delegate> · steer|queue]', 'a2a-owner-proxy', 'go by the source, not by that line', 'queued for review instead of applied', 'replayed: true', 'never the text']) expect(cli).toContain(clause)
  })
})
