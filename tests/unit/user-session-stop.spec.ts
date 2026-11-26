import { describe, expect, it, vi } from 'vitest'
import { stopOwnerSession, bindOwnerCancel } from '../../src/user-session-stop.ts'
import { PromptIdempotency } from '../../src/user-sessions.ts'

const id = 'session-0123456789abcdef'
const input = { id, requestId: 'stop-1', delegateId: 'delegate-1' }
function fixture() {
  const agent = { status: 'running', inbox: { nextTurn: ['pending'], nextStep: ['steer'] }, steer: vi.fn(), followup: vi.fn() }
  const deps = { live: (target: string) => target === id, joined: (target: string) => target === id, archived: () => false, agent: () => agent, idem: new PromptIdempotency() }
  const verify = vi.fn(() => true)
  return { agent, deps, verify }
}

describe('owner stop', () => {
  it('audits before requesting cancellation and retains inbox work', () => {
    const f = fixture()
    const controller = { cancel: vi.fn((request: { sessionId: string }) => {
      expect(request).toEqual({ sessionId: id })
      expect(f.verify).toHaveBeenCalledBefore(controller.cancel)
      f.agent.status = 'idle'
      return { accepted: true }
    }) }
    const cancel = bindOwnerCancel(controller)
    expect(stopOwnerSession(f.deps, input, cancel, f.verify)).toEqual({ status: 200, response: { ok: true, id, stopped: true } })
    expect(f.agent.inbox).toEqual({ nextTurn: ['pending'], nextStep: ['steer'] })
    f.agent.status = 'running'
    expect(stopOwnerSession(f.deps, input, cancel, f.verify).response).toMatchObject({ stopped: true, replayed: true })
    expect(controller.cancel).toHaveBeenCalledOnce()
    expect(f.verify).toHaveBeenCalledOnce()
  })

  it('treats idle as a successful no-op and fails closed when the active interface is missing', () => {
    const f = fixture()
    f.agent.status = 'idle'
    expect(stopOwnerSession(f.deps, input, undefined, f.verify).response).toMatchObject({ stopped: false })
    f.agent.status = 'running'
    expect(stopOwnerSession(f.deps, { ...input, requestId: 'other' }, undefined, f.verify).status).toBe(501)
    expect(f.verify).toHaveBeenCalledOnce()
  })

  it('rejects invalid input or unwritable audit and never repeats an unconfirmed stop', () => {
    const f = fixture()
    const uncertain = vi.fn(() => { throw new Error('unconfirmed') })
    expect(stopOwnerSession(f.deps, { ...input, requestId: '%' }, uncertain, f.verify).status).toBe(400)
    expect(stopOwnerSession(f.deps, input, uncertain, () => false).response.code).toBe('audit')
    expect(uncertain).not.toHaveBeenCalled()
    expect(stopOwnerSession(f.deps, input, uncertain, f.verify).response.code).toBe('stop-unconfirmed')
    expect(stopOwnerSession(f.deps, input, uncertain, f.verify).response).toMatchObject({ code: 'stop-unconfirmed', replayed: true })
    expect(uncertain).toHaveBeenCalledOnce()
  })
})
