// @vitest-environment jsdom
/** Exercise the production boot/HTTP adapter, never a real membership service. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); window.localStorage.clear(); window.sessionStorage.clear(); document.body.innerHTML = '<div id="app"></div>' })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren() })
const session = { id: 'session-member', label: 'member', name: '候选成员', team: 'dsh/member', joined: true, live: true }
const state = { sessions: [session], canvas: { teams: [{ name: 'test-team', team: 'dsh/canvas/test-team', members: [] }] }, peers: [], remote: [], tasks: [], tasksDead: [], activity: [] }

describe('membership HTTP adapter: confirmed outcomes and visible failures', () => {
  it.each(['denied', 'non-json', 'missing-ok', 'null-body', 'network', 'confirmed'] as const)('handles %s without assuming a successful add', async kind => {
    const writes: Record<string, unknown>[] = []
    const api = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input)
      if (path === '/__dsh_a2a/canvas' && init?.method === 'POST') {
        writes.push(JSON.parse(String(init.body)))
        if (kind === 'network') throw Error('synthetic network offline')
        if (kind === 'non-json') return new Response('not json', { status: 200 })
        if (kind === 'null-body') return new Response('null', { status: 200 })
        if (kind === 'missing-ok') return Response.json({ members: [] })
        return Response.json(kind === 'confirmed' ? { ok: true } : { ok: false, error: 'test source denied <b>text only</b>' }, { status: kind === 'denied' ? 403 : 200 })
      }
      if (path === '/__dsh_a2a/state') return Response.json(state)
      if (path === '/__dsh_a2a/canvas-layout') return Response.json({ layout: { version: 1, nodes: {}, frames: { 'test-team': { x: 0, y: 0, w: 400, h: 300 } } } })
      if (path === '/__dsh_a2a/session-log') return Response.json({ ok: true, sessions: [], count: 0 })
      if (path === '/__dsh_a2a/nodes') return Response.json({ bindings: [] })
      if (path === '/__dsh_a2a/superagent/teams') return Response.json({ teams: [] })
      if (path.startsWith('/__dsh_a2a/superagent')) return new Response('{}', { status: 404 })
      if (path === '/__dsh_a2a/owner-settings') return Response.json({ ok: true })
      throw Error('Unexpected test request ' + path)
    })
    vi.stubGlobal('fetch', api)
    await import('../src/main')
    await vi.waitFor(() => expect(document.querySelector('.wb-dir-group')).not.toBeNull())
    ;[...document.querySelectorAll<HTMLElement>('.wb-item-label')].find(item => item.textContent === 'test-team')!.click()
    const form = document.querySelector<HTMLFormElement>('.wb-inspector .wb-member-add')!
    const manual = form.querySelector<HTMLInputElement>('input')!
    manual.value = 'remote/seat'
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false))
    expect(writes).toEqual([{ action: 'add-member', name: 'test-team', id: 'remote/seat' }])
    if (kind === 'confirmed') {
      expect(form.querySelector('[role=status]')?.textContent).toContain('添加请求已确认')
      expect(manual.value).toBe('')
    } else {
      const expected = kind === 'denied' ? 'test source denied <b>text only</b>' : kind === 'network' ? 'synthetic network offline' : '主机未确认'
      expect(form.querySelector('[role=alert]')?.textContent).toContain(expected)
      expect(manual.value).toBe('remote/seat')
      expect(form.querySelector('b')).toBeNull()
      await vi.advanceTimersByTimeAsync(3100)
      expect(document.querySelector('.wb-inspector [role=alert]')?.textContent).toContain(expected)
      expect(writes).toHaveLength(1)
    }
  })
})
