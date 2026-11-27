// @vitest-environment node
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from '../temp-dirs.ts'
import { SuperagentHost } from '../../src/superagent/host/index.ts'
import { DecisionBook, type DecisionSpec } from '../../src/superagent/host/decisions.ts'
import { DEFAULT_SETTINGS, parseSettings, parseStoredSettings } from '../../src/superagent/host/policy.ts'
import { touchesRules } from '../../src/superagent/host/owner-proof.ts'

const router = 'session-router', worker = 'session-member', observer = 'session-observer'
const T0 = Date.parse('2026-11-26T10:00:00Z')
const spec: DecisionSpec = { level: 'P1', options: ['甲', '乙'], recommended: '甲' }

function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'observer-decision-'))
  const clock = { now: T0 }
  const wake = vi.fn(() => true)
  function open() {
    return new SuperagentHost({ home, canvasTeam: (name: string) => name === 'team' ? { local: [router, worker, observer], remote: [] } : undefined,
      logger: { info: () => undefined, warn: () => undefined }, deliverToSession: wake,
      interval: () => () => undefined, memberTurn: () => ({ quiet: true, text: '' }), sessionName: (id: string) => id,
      now: () => new Date(clock.now).toISOString(),
      presetOf: (id: string) => id === observer ? 'superagent-observer' : id === router ? 'superagent-router' : 'superagent-member',
    } as never)
  }
  const host = open()
  const saved = host.saveSettings({ canvas: 'team', router, observerDecides: { maxLevel: 'P1', perHour: 1 } }, () => true)
  if (!saved.ok) throw new Error(saved.error)
  clock.now++
  const propose = (question: string) => host.proposeDecision('router', router, question, spec).id as string
  const cards = (owner = host) => owner.observerDecisionCards(observer).cards as Array<{ cardId: string; generation?: string; eligible: boolean; why?: string }>
  return { host, home, wake, clock, open, propose, cards }
}

const bookOf = (host: SuperagentHost) => (host as unknown as { decisions: DecisionBook }).decisions
const choose = (host: SuperagentHost, id: string, generation: string | undefined, option: string = 'o1') => host.observerOrApproverDecide(observer, id, generation, option, 'fixture reason')

describe('observer decision policy', () => {
  it('sets rules through the owner guard and restores only a valid host stamp', () => {
    expect(touchesRules({ observerDecides: null })).toBe(true)
    expect(parseSettings({ observerDecides: { maxLevel: 'P0' } }, DEFAULT_SETTINGS).ok).toBe(false)
    expect(parseSettings({ observerDecides: { maxLevel: 'P1', armedAt: 'forged' } }, DEFAULT_SETTINGS)).toMatchObject({ ok: true, settings: { observerDecides: { maxLevel: 'P1', perHour: 10 } } })
    const restored = parseStoredSettings({ observerDecides: { maxLevel: 'P1', armedAt: 'bad' } })
    expect(restored.ok && restored.settings.observerDecides).toBeUndefined()
  })

  it('requires the viewed generation and records a router receipt without creating an owner request', async () => {
    const f = fixture()
    try {
      const id = f.propose('router question')
      const row = f.cards().find(c => c.cardId === id)!
      expect(row).toMatchObject({ eligible: true, generation: expect.any(String) })
      expect(choose(f.host, id, 'unrelated')).toMatchObject({ ok: false, code: 'stale' })
      expect(f.host.observerDecisionCards(worker)).toMatchObject({ ok: false })
      const request = vi.spyOn(f.host, 'request')
      const push = vi.spyOn(f.host.decisionPush, 'noted')
      expect(choose(f.host, id, row.generation)).toMatchObject({ ok: true, state: 'applied' })
      expect(choose(f.host, id, row.generation)).toMatchObject({ ok: true, replayed: true })
      expect(choose(f.host, id, row.generation, 'o2')).toMatchObject({ ok: false, code: 'stale' })
      expect(request).not.toHaveBeenCalled()
      expect(f.host.store.tickets.list()).toEqual([])
      expect(f.host.observerDecisionReceipts(router)).toMatchObject({ receipts: [{ human: false, option: '甲', optionIndex: 0 }] })
      expect(f.host.observerDecisionReceipts(worker)).toMatchObject({ ok: false })
      expect(f.wake).toHaveBeenCalledExactlyOnceWith(router, expect.stringContaining('grants no authority'))
      expect(f.host.ownerObserverDecision(id, 'observer-correct', row.generation, 'o2', 'correction')).toMatchObject({ ok: true, corrected: true })
      expect(f.host.ownerObserverDecision(id, 'observer-correct', row.generation, 'o2', '')).toMatchObject({ ok: false, code: 'stale' })
      expect(f.host.observerDecisionBoard()).toMatchObject([{ observerResult: { option: '甲', correction: '乙', state: 'applied' } }])
      expect(push).toHaveBeenCalledExactlyOnceWith('decided', expect.objectContaining({ source: 'router', decided: expect.objectContaining({ option: 0 }) }))
      const next = f.propose('second question')
      expect(f.cards().find(c => c.cardId === next)).toMatchObject({ eligible: false, why: 'cap' })
    } finally { await f.host.stop() }
  })

  it('recovery rechecks a pending grant and never resends a persisted attempt', async () => {
    const f = fixture()
    try {
      const id = f.propose('recovery question')
      const generation = f.cards().find(c => c.cardId === id)!.generation!
      const book = bookOf(f.host)
      const row = book.get(id)!
      const { target } = row.observerBinding!
      const record = { id: 'observer-' + generation, teamId: '', cardId: id, generation, session: observer, name: observer, human: false as const,
        at: new Date(f.clock.now).toISOString(), option: 0, level: 'P1' as const, reason: 'fixture', target, state: 'pending' as const }
      expect(book.commitObserverDecision(row, record)).toBe(true)
      f.host.saveSettings({ observerDecides: null }, () => true)
      const recovered = f.open()
      try { recovered.pass(); expect(bookOf(recovered).get(id)?.observerDecision?.state).toBe('failed') }
      finally { await recovered.stop() }
      expect(f.wake).not.toHaveBeenCalled()
      expect(book.updateObserverDecision(book.get(id)!, { ...record, state: 'attempting' })).toBe(true)
      const restarted = f.open()
      try { restarted.pass(); expect(bookOf(restarted).get(id)?.observerDecision?.state).toBe('unknown') }
      finally { await restarted.stop() }
      expect(f.wake).not.toHaveBeenCalled()
    } finally { await f.host.stop() }
  })

  it('keeps Owner credential controls available after the observer records an acknowledgment', async () => {
    const f = fixture()
    try {
      const book = bookOf(f.host)
      const stop = '停掉这个会话的工单'
      const block = '在团队设置里禁用这个工具'
      const create = (supervised: string) => book.propose({ source: 'health', by: 'credential:' + supervised, at: new Date(f.clock.now).toISOString(), question: 'audit receipt ' + supervised,
        spec: { level: 'P1', options: ['知道了', stop, block], recommended: '知道了' }, observerTarget: { kind: 'credential-ack', supervised, optionIndex: 0, preview: 'redacted preview' } })
      const self = create(observer), other = create(worker)
      if (!self.ok || !other.ok) throw new Error('audit fixtures failed')
      expect(f.cards().find(c => c.cardId === self.id)).toMatchObject({ eligible: false, why: 'own' })
      const row = f.cards().find(c => c.cardId === other.id)!
      expect(row).toMatchObject({ eligible: true, preview: 'redacted preview', options: [{ index: 0, text: '知道了' }] })
      expect(choose(f.host, other.id, row.generation, 'o2')).toMatchObject({ ok: false, code: 'choice' })
      const control = vi.spyOn(f.host as unknown as { credentialAction(...args: unknown[]): object }, 'credentialAction').mockReturnValue({ stopped: true })
      expect(choose(f.host, other.id, row.generation)).toMatchObject({ ok: true, state: 'applied' })
      expect(f.host.ownerObserverDecision(other.id, 'observer-correct', row.generation, 'o2', '')).toMatchObject({ ok: true })
      expect(control).not.toHaveBeenCalled()
      expect(f.host.observerDecisionBoard()).toMatchObject([{ observerResult: { controlOptions: [stop, block] } }])
      expect(f.host.ownerObserverDecision(other.id, 'credential-control', row.generation, 'o2', '')).toMatchObject({ ok: true })
      expect(control).toHaveBeenCalledExactlyOnceWith(other.id, worker, 'audit receipt ' + worker, stop)
      expect(f.host.ownerObserverDecision(other.id, 'credential-control', row.generation, 'o2', '')).toMatchObject({ ok: false })
    } finally { await f.host.stop() }
  })

  it('binds a ticket answer to the open question and saves a non-human receipt only there', async () => {
    const f = fixture()
    try {
      const ticketId = 'ticket-1'
      const question = 'a pending question'
      f.host.store.atomic(() => f.host.store.tickets.save({ id: ticketId, title: 'fixture', updatedAt: new Date(T0).toISOString(), attention: { id: 'current', question }, inputs: [] } as never))
      vi.spyOn(f.host.executor, 'memberOfTicket').mockReturnValue({ member: worker } as never)
      const book = bookOf(f.host)
      book.forTicket({ ticketId, question, questionVersion: 'current', by: worker, at: new Date(f.clock.now).toISOString(), spec })
      const first = f.cards().find(row => row.eligible)!
      book.forTicket({ ticketId, question, questionVersion: 'current', by: worker, at: new Date(f.clock.now).toISOString(), spec: { ...spec, options: ['丙', '丁'], recommended: '丙' } })
      expect(choose(f.host, first.cardId, first.generation)).toMatchObject({ ok: false, code: 'stale' })
      const same = f.cards().find(row => row.cardId === first.cardId)!
      expect(choose(f.host, same.cardId, same.generation)).toMatchObject({ ok: true, state: 'applied' })
      const result = f.host.store.tickets.get(ticketId)!
      expect(result.attention).toBeUndefined()
      expect(result.inputs).toEqual([expect.objectContaining({ kind: 'note', observerDecision: { teamId: '', human: false, cardId: same.cardId, generation: same.generation, questionVersion: 'current', option: 0, session: observer, level: 'P1' } })])
      expect(f.host.observerDecisionReceipts(worker, ticketId)).toMatchObject({ receipts: [{ option: '丙', human: false }] })
      expect(f.host.observerDecisionReceipts(observer, ticketId)).toMatchObject({ ok: false })
      expect(f.wake).toHaveBeenCalledExactlyOnceWith(worker, expect.stringContaining('grants no authority'))
    } finally { await f.host.stop() }
  })

  it('restores the archived decision after answering and opening the same question again', async () => {
    const f = fixture()
    const ticketId = 'ticket-archive'
    const question = 'a repeated question'
    const at = new Date(f.clock.now).toISOString()
    const book = bookOf(f.host)
    let original: ReturnType<DecisionBook['observerHistory']>[number]['observerDecision']
    try {
      f.host.store.atomic(() => f.host.store.tickets.save({ id: ticketId, title: 'fixture', updatedAt: at, attention: { id: 'q1', question }, inputs: [] } as never))
      vi.spyOn(f.host.executor, 'memberOfTicket').mockReturnValue({ member: worker })
      book.forTicket({ ticketId, question, questionVersion: 'q1', by: worker, at, spec })
      const first = f.cards().find(row => row.eligible)!
      expect(choose(f.host, first.cardId, first.generation)).toMatchObject({ ok: true, state: 'applied' })
      original = book.get(first.cardId)?.observerDecision
      if (original === undefined) throw new Error('missing applied decision')
      const ticket = f.host.store.tickets.get(ticketId)!
      f.host.store.atomic(() => f.host.store.tickets.save({ ...ticket, attention: { id: 'q2', question } }))
      book.forTicket({ ticketId, question, questionVersion: 'q2', newQuestion: true, by: worker, at, spec })
      expect(book.get(original.id)?.observerDecision).toEqual(original)
      expect(book.get(first.cardId)?.observerBinding?.generation).not.toBe(first.generation)
    } finally { await f.host.stop() }
    if (original === undefined) throw new Error('missing archive fixture')
    const recovered = f.open()
    try {
      vi.spyOn(recovered.executor, 'memberOfTicket').mockReturnValue({ member: worker })
      recovered.pass()
      expect(bookOf(recovered).observerStorageReady).toBe(true)
      expect(bookOf(recovered).observerHistory()).toMatchObject([{ id: original.id, observerDecision: original }])
      expect(recovered.observerDecisionReceipts(worker, ticketId)).toMatchObject({ receipts: [{ cardId: original.cardId, generation: original.generation }] })
      expect(f.cards(recovered).find(row => row.cardId === original.cardId)).toMatchObject({ eligible: false, why: 'cap' })
      expect(f.wake).toHaveBeenCalledTimes(1)
    } finally { await recovered.stop() }

    const path = join(f.home, 'superagent', 'decisions.json')
    const records = JSON.parse(readFileSync(path, 'utf8'))
    records.find((row: { id: string }) => row.id === original.id).observerDecision.cardId = 't-wrong-ticket'
    writeFileSync(path, JSON.stringify(records))
    const mismatched = f.open()
    try {
      expect(bookOf(mismatched).observerStorageReady).toBe(false)
      expect(mismatched.observerDecisionCards(observer)).toMatchObject({ ok: false, code: 'storage' })
      expect(f.wake).toHaveBeenCalledTimes(1)
    } finally { await mismatched.stop() }
  })

  it('does not expose excluded card text or a file reference', async () => {
    const f = fixture()
    try {
      const out = bookOf(f.host).propose({ source: 'outbound', by: worker, at: new Date(f.clock.now).toISOString(), question: 'secret outbound body', reason: 'secret reason', spec,
        files: [{ name: 'secret-name', sha256: 'a'.repeat(64), size: 1, ref: 'secret ref' }] })
      expect(out.ok).toBe(true)
      expect(JSON.stringify(f.cards())).not.toContain('secret')
    } finally { await f.host.stop() }
  })

  it('prevents an observer commit while the Owner path holds the same generation', async () => {
    const f = fixture()
    try {
      const id = f.propose('owner has selected')
      const { generation } = f.cards().find(c => c.cardId === id)!
      const request = vi.spyOn(f.host, 'request').mockImplementationOnce(() => {
        expect(choose(f.host, id, generation)).toMatchObject({ ok: false, code: 'stale' })
        expect(f.cards().find(c => c.cardId === id)).toBeUndefined()
        return { ok: true, triggerId: 'owner-trigger', thread: 'owner-thread', result: {} as never }
      })
      expect(f.host.decide(id, 'choose', '乙')).toMatchObject({ ok: true })
      expect(request).toHaveBeenCalledOnce()
      expect(bookOf(f.host).get(id)).toMatchObject({ decided: { option: 1, triggerId: 'owner-trigger' } })
      expect(f.host.observerDecisionBoard()).toEqual([])
    } finally { await f.host.stop() }
  })

  it('keeps an Owner card open when the request is rejected before intake', async () => {
    const f = fixture()
    try {
      const id = f.propose('owner request size')
      expect(f.host.decide(id, 'choose', '甲', 'x'.repeat(20_000))).toMatchObject({ ok: false, code: 'refused' })
      expect(bookOf(f.host).open().map(card => card.id)).toContain(id)
      expect(bookOf(f.host).get(id)?.ownerDecisionAttempt).toBeUndefined()
      expect(f.host.decide(id, 'choose', '甲', 'short note')).toMatchObject({ ok: true })
    } finally { await f.host.stop() }
  })

  it('stops observer decisions when the active policy has lost its saved book', async () => {
    const f = fixture()
    const id = f.propose('first decision')
    const generation = f.cards().find(card => card.cardId === id)!.generation
    expect(choose(f.host, id, generation)).toMatchObject({ ok: true, state: 'applied' })
    await f.host.stop()
    const bookPath = (bookOf(f.host) as unknown as { path: string }).path
    renameSync(bookPath, bookPath + '.backup')
    const recovered = f.open()
    try {
      expect(recovered.settings.observerDecides?.armedAt).toBe(f.host.settings.observerDecides?.armedAt)
      expect(bookOf(recovered).observerStorageReady).toBe(false)
      expect(choose(recovered, id, generation)).toMatchObject({ ok: false, code: 'storage' })
      expect(f.wake).toHaveBeenCalledTimes(1)
    } finally { await recovered.stop() }
  })

  it('does not reinitialize a lost book after the Owner disables the rule', async () => {
    const f = fixture()
    const path = (bookOf(f.host) as unknown as { path: string }).path
    expect(readFileSync(path, 'utf8')).toBe('[]')
    try {
      expect(f.host.saveSettings({ observerDecides: null }, () => true).ok).toBe(true)
    } finally { await f.host.stop() }
    renameSync(path, path + '.backup')
    const recovered = f.open()
    try {
      expect(bookOf(recovered).observerStorageReady).toBe(false)
      expect(recovered.saveSettings({ observerDecides: { maxLevel: 'P1', perHour: 1 } }, () => true)).toMatchObject({ ok: false })
    } finally { await recovered.stop() }
  })

  it('keeps the Owner reservation when intake does not confirm the outcome', async () => {
    const f = fixture()
    try {
      const id = f.propose('owner result uncertain')
      vi.spyOn(f.host, 'request').mockReturnValueOnce({ ok: false, error: 'intake outcome unavailable' })
      expect(f.host.decide(id, 'choose', '甲')).toMatchObject({ ok: false, code: 'refused' })
      expect(bookOf(f.host).get(id)?.ownerDecisionAttempt).toBeDefined()
      expect(f.host.decide(id, 'choose', '甲')).toMatchObject({ ok: false, code: 'stale' })
    } finally { await f.host.stop() }
  })

  it('refuses stored cards with malformed input requirements', () => {
    const home = mkdtempSync(join(tmpdir(), 'observer-invalid-inputs-'))
    const path = join(home, 'decisions.json')
    const book = new DecisionBook(path, () => true, () => T0)
    const out = book.propose({ source: 'router', by: router, question: 'requires input', at: new Date(T0).toISOString(),
      observerTarget: { kind: 'router-receipt', session: router }, spec: { ...spec, inputs: { 乙: { kind: 'text', prompt: 'Owner input' } } } })
    expect(out.ok).toBe(true)
    const records = JSON.parse(readFileSync(path, 'utf8'))
    expect(new DecisionBook(path).observerStorageReady).toBe(true)
    records[0].inputs = []
    writeFileSync(path, JSON.stringify(records))
    expect(new DecisionBook(path).observerStorageReady).toBe(false)
  })

  it('rolls back a failed observer decision commit without waking the recipient', async () => {
    const f = fixture()
    try {
      const id = f.propose('persist or refuse')
      const { generation } = f.cards().find(c => c.cardId === id)!
      const book = bookOf(f.host)
      const failure = vi.spyOn(book as unknown as { save(): void }, 'save').mockImplementationOnce(() => { throw new Error('write failed') })
      expect(choose(f.host, id, generation)).toMatchObject({ ok: false, code: 'storage' })
      expect(book.get(id)?.decided).toBeUndefined()
      expect(f.wake).not.toHaveBeenCalled()
      failure.mockRestore()
      expect(choose(f.host, id, generation)).toMatchObject({ ok: true, state: 'applied' })
    } finally { await f.host.stop() }
  })

  it('does not reuse a ticket question version when its options or question generation change', () => {
    const home = mkdtempSync(join(tmpdir(), 'observer-version-'))
    const path = join(home, 'book.json'), book = new DecisionBook(path)
    const input = { ticketId: 'ticket', question: 'same question', by: worker, at: new Date(T0).toISOString(), spec, questionVersion: 'a' }
    book.forTicket(input)
    const first = book.open()[0]!
    book.forTicket({ ...input, spec: { ...spec, options: ['丙', '丁'], recommended: '丙' } })
    const second = book.open()[0]!
    expect(second.id).toBe(first.id)
    expect(second.observerBinding?.generation).not.toBe(first.observerBinding?.generation)
    book.forTicket({ ...input, questionVersion: 'b' })
    expect(book.open()[0]?.observerBinding?.generation).not.toBe(second.observerBinding?.generation)
    expect(new DecisionBook(path).open()[0]?.observerBinding).toEqual(book.open()[0]?.observerBinding)
  })

  it('rejects an Owner decision before any intake when a different saved card is corrupt', async () => {
    const f = fixture()
    const broken = f.propose('corrupt bound card')
    const book = bookOf(f.host)
    const owner = book.propose({ source: 'observer', by: observer, question: 'Owner-only card', spec, at: new Date(f.clock.now).toISOString() })
    if (!owner.ok) throw new Error(owner.error)
    const path = join(f.home, 'superagent', 'decisions.json')
    await f.host.stop()
    const stored = JSON.parse(readFileSync(path, 'utf8'))
    stored.find((card: { id: string }) => card.id === broken).inputs = []
    writeFileSync(path, JSON.stringify(stored))
    const recovered = f.open()
    try {
      const request = vi.spyOn(recovered, 'request')
      expect(recovered.decisionCards().map(card => card.id)).toContain(owner.id)
      expect(recovered.decide(owner.id, 'choose', '甲')).toMatchObject({ ok: false, code: 'storage' })
      expect(request).not.toHaveBeenCalled()
      expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(stored))
    } finally { await recovered.stop() }
  })

  it.each([undefined, 'P2', 'invalid'])('refuses recovery when the saved decision level is %s', async level => {
    const f = fixture()
    const id = f.propose('pending decision with a damaged level')
    const book = bookOf(f.host)
    const card = book.get(id)!
    const { generation, target } = card.observerBinding!
    expect(book.commitObserverDecision(card, { id: 'observer-' + generation, teamId: '', cardId: id, generation, session: observer,
      name: observer, human: false, at: new Date(f.clock.now).toISOString(), option: 0, level: 'P1', reason: 'fixture', target, state: 'pending' })).toBe(true)
    const path = join(f.home, 'superagent', 'decisions.json')
    await f.host.stop()
    const stored = JSON.parse(readFileSync(path, 'utf8'))
    stored.find((row: { id: string }) => row.id === id).observerDecision.level = level
    writeFileSync(path, JSON.stringify(stored))
    const recovered = f.open()
    try {
      recovered.pass()
      expect(recovered.observerDecisionCards(observer)).toMatchObject({ ok: false, code: 'storage' })
      expect(f.wake).not.toHaveBeenCalled()
      expect(readFileSync(path, 'utf8')).toBe(JSON.stringify(stored))
    } finally { await recovered.stop() }
  })

  it('disables observer decisions when the stored book is malformed', () => {
    const home = mkdtempSync(join(tmpdir(), 'observer-broken-'))
    const path = join(home, 'state', 'decisions.json')
    mkdirSync(join(home, 'state'))
    writeFileSync(path, '{bad')
    expect(new DecisionBook(path).observerStorageReady).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('{bad')
  })
})
