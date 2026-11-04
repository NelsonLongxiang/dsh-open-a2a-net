import { describe, expect, it, vi } from 'vitest'
import { createSeatNameEditor } from '../src/seat-name-editor'
const ID = 'session-0123456789abcdef'
describe('human seat name editor', () => {
  it('requires explicit save, preserves other sessions, can clear, and uses text not markup', async () => {
    const save = vi.fn(async () => ({ ok: true }))
    const el = createSeatNameEditor([{ id: ID, label: 'default' }], { [ID]: 'old', 'session-1111222233334444': 'other' }, save)
    const input = el.querySelector('input')!, form = el.querySelector('form')!
    input.value = '<img src=x onerror=alert(1)>'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(save).not.toHaveBeenCalled()
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(el.textContent).toContain('已保存'))
    expect(save).toHaveBeenCalledWith({ [ID]: '<img src=x onerror=alert(1)>', 'session-1111222233334444': 'other' })
    expect(el.querySelector('img')).toBeNull()
    const savedNames = save.mock.calls[0]![0]
    const redrawn = createSeatNameEditor([{ id: ID }], savedNames, save)
    expect(redrawn.querySelector('option')!.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(redrawn.querySelector('option')!.children).toHaveLength(0)
    expect(redrawn.querySelector('img')).toBeNull()
    input.value = ''
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1]?.[0]).toEqual({ 'session-1111222233334444': 'other' })
  })
  it('failed save is visible and never reports success or loses the existing name', async () => {
    const save = vi.fn(async () => ({ ok: false, error: '<img src=x onerror=alert(2)> owner write denied' }))
    const el = createSeatNameEditor([{ id: ID }], { [ID]: 'old' }, save)
    el.querySelector('input')!.value = 'new'
    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(el.textContent).toContain('owner write denied'))
    expect(el.textContent).not.toContain('已保存')
    expect(el.querySelector('[role=status]')!.textContent).toContain('<img src=x onerror=alert(2)>')
    expect(el.querySelector('[role=status]')!.children).toHaveLength(0)
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('button')!.disabled).toBe(false)
  })
})
