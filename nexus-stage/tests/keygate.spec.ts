// @vitest-environment jsdom
/**
 * gh#40: a REMOTE face serves the nexus shell keyless by design (the M3 fix
 * keeps the credential out of network-reachable page bodies). The panel
 * still has to be usable there: one typed key (verified against the
 * control plane, stored in sessionStorage — browser-local) unlocks the
 * session; the header stamp reads storage when the host injected nothing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

describe('gh#40 key entry', () => {
  beforeEach(() => {
    vi.resetModules()
    window.sessionStorage.clear()
  })

  it('a keyless shell with a 401 control plane mounts the gate; a correct key reloads with the header stamp', async () => {
    window.__DSH_A2A_KEY__ = undefined
    const probe = vi.fn(async () => new Response('{"error":"api key required"}', { status: 401 }))
    const verify = vi.fn(async (_path: string, init?: RequestInit) => {
      const key = (init?.headers as Record<string, string> | undefined)?.['X-API-Key']
      return key === 'test-3081-key' ? new Response('{"ok":true}', { status: 200 }) : new Response('{"error":"api key required"}', { status: 401 })
    })
    const calls: Array<string | undefined> = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const key = (init?.headers as Record<string, string> | undefined)?.['X-API-Key']
      calls.push(key)
      return path.includes('owner-settings') && init !== undefined ? verify(path, init) : probe()
    }))
    document.body.innerHTML = '<div id="app"></div>'
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, reload }, writable: true })
    await import('../src/main.ts')
    await vi.waitFor(() => expect(document.querySelector('.nexus-keygate')).not.toBeNull())
    const input = document.querySelector<HTMLInputElement>('.nexus-keygate input')!
    const submit = [...document.querySelectorAll<HTMLButtonElement>('.nexus-keygate button')].find(b => b.textContent === '进入面板')!
    input.value = 'wrong'
    submit.click()
    await vi.waitFor(() => expect(document.querySelector('.nexus-keygate')?.textContent).toContain('密钥不对'))
    input.value = 'test-3081-key'
    submit.click()
    await vi.waitFor(() => {
      expect(window.sessionStorage.getItem('dsh_a2a_key')).toBe('test-3081-key')
      expect(reload).toHaveBeenCalled()
    })
    // The reload path: on the next load, storage stamps the header.
    expect(calls).toContain('test-3081-key')
  }, 15_000)
})
