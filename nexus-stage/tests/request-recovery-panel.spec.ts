import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReceiverRecovery, createSenderRecovery, recoveryOwnerResponse, type RecoveryJson, type RecoveryOutbound } from '../src/request-recovery-panel'
import { createSuperagentPane, type SaState } from '../src/wb-superagent'
import { createWorkbench } from '../src/workbench'

const workbenches: ReturnType<typeof createWorkbench>[] = []
// jsdom here has no localStorage (opaque origin): every test gets an empty in-memory one, so `localStorage.length === 0`
// still proves the recovery panel persists nothing.
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size }, clear: () => { m.clear() }, getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => { m.delete(k) }, setItem: (k, v) => { m.set(k, String(v)) },
  }
}
beforeEach(() => { Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true }) })
afterEach(() => { for (const wb of workbenches.splice(0)) wb.dispose(); document.body.replaceChildren(); localStorage.clear(); vi.restoreAllMocks() })
const row: RecoveryOutbound = { card: 'card-one', task: 'direct-old', ticketId: 'ticket-one', address: 'beta/aaaaaaaa', text: 'exact original text', state: 'failed' }
function proposal() { return { signature: 'sender-signature', binding: { version: 1, requestId: 'rr-request-one', ticketId: row.ticketId, originalCards: [row.card, 'card-two'], originalTasks: [row.task, 'direct-two'], taskId: 'recover-one', contextId: 'context-one', caller: 'superagent-team/0123456789abcdef', senderHome: 'https://sender.test', senderKey: 'sender-public', cliKey: 'cli-public', receiverHome: 'https://receiver.test', receiverKey: 'receiver-public', receiverSession: 'session-aaaaaaaa-full', target: row.address, message: '[original header]\n' + row.text, approvalAt: '2026-11-15T00:00:00Z', approvalDigest: 'a'.repeat(64), senderReconciliation: 'sender original chain checked' } } }
function permit(p = proposal()) { return { proposal: p, signature: 'receiver-signature', issuedAt: Date.now() - 1000, expiresAt: Date.now() + 300000, reconciliation: 'receiver original evidence checked' } }
const field = (root: HTMLElement, text: string) => root.querySelector<HTMLTextAreaElement>('[aria-label="' + text + '"]')!
const btn = (root: HTMLElement, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)!
const tick = (root: HTMLElement, text: string) => root.querySelector<HTMLInputElement>('[aria-label="' + text + '"]')!
function setText(root: HTMLElement, name: string, value: string) { const box = field(root, name); box.value = value; box.dispatchEvent(new Event('input', { bubbles: true })) }
const senderChecked = '我已核实原批准、原身份、全部旧尝试和停止事实'
const receiverChecked = '我已核实全部原尝试未被接纳及原身份延续'
function sender(over: { act?: (body: RecoveryJson) => Promise<RecoveryJson>; existing?: RecoveryOutbound; current?: () => boolean } = {}) {
  const p = proposal(), act = vi.fn(over.act ?? (async (body: RecoveryJson) => body.action === 'outbound-narrow-prepare' ? { ok: true, proposal: p } : { ok: true, state: 'prepared', phase: 'prepared', query: 'ready', task: p.binding.taskId }))
  const refresh = vi.fn(), view = createSenderRecovery({ row: over.existing ?? row, teamId: 'team-one', act, current: over.current ?? (() => true), refresh })
  document.body.append(view.root)
  return { view, act, refresh, p }
}
function fillSender(root: HTMLElement) {
  setText(root, '固定接收主机 origin', 'https://receiver.test'); setText(root, '固定接收主机完整公钥', 'receiver-public'); setText(root, '固定接收完整 SessionId', 'session-aaaaaaaa-full'); setText(root, '发送端原链核对说明（单行，≤2000字符）', 'original decisions identity and old attempts checked')
}
function preparedSender() { const p = proposal(); return sender({ existing: { ...row, narrowRecovery: { proposal: p, phase: 'prepared' } } }) }
async function queryPermit(f: ReturnType<typeof sender>) {
  setText(f.view.root, '接收端返回的原许可 JSON', JSON.stringify(permit(f.p))); btn(f.view.root, '核对固定续接（不发送）').click()
  await vi.waitFor(() => expect(f.act).toHaveBeenCalledWith(expect.objectContaining({ action: 'outbound-narrow-reconcile' })))
  await vi.waitFor(() => expect(btn(f.view.root, '核对固定续接（不发送）').disabled).toBe(false))
}

describe('original-card owner continuation form', () => {
  it('prepares only after an unchecked attestation is explicitly confirmed and never sends', async () => {
    const f = sender(); fillSender(f.view.root); expect(tick(f.view.root, senderChecked).checked).toBe(false)
    btn(f.view.root, '准备原请求草案（不发送）').click(); expect(f.act).not.toHaveBeenCalled()
    tick(f.view.root, senderChecked).checked = true; btn(f.view.root, '准备原请求草案（不发送）').click()
    await vi.waitFor(() => expect(field(f.view.root, '原签名草案（交接至接收端主人页面）').value).toContain('sender-signature'))
    expect(f.act).toHaveBeenCalledTimes(1); expect(f.act.mock.calls[0][0]).toEqual({ action: 'outbound-narrow-prepare', teamId: 'team-one', card_id: row.card, task_id: row.task, receiver: { home: 'https://receiver.test', key: 'receiver-public', session: 'session-aaaaaaaa-full' }, checked_original_chain: true, reconciliation: 'original decisions identity and old attempts checked' })
    expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(true)
  })
  it('does not infer attestation from a checkbox without an audit statement', () => {
    const f = sender(); fillSender(f.view.root); tick(f.view.root, senderChecked).checked = true; setText(f.view.root, '发送端原链核对说明（单行，≤2000字符）', '')
    btn(f.view.root, '准备原请求草案（不发送）').click(); expect(f.act).not.toHaveBeenCalled()
  })
  it('reuses the original durable proposal after refresh without another preparation', () => {
    const f = preparedSender(); expect(field(f.view.root, '原签名草案（交接至接收端主人页面）').value).toContain('recover-one'); expect(btn(f.view.root, '准备原请求草案（不发送）').disabled).toBe(true); expect(f.act).not.toHaveBeenCalled()
  })
  it('pins exact proposal and invalidates send readiness when pasted permit changes', async () => {
    const f = preparedSender(); await queryPermit(f); expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(false)
    const bad = permit(f.p); bad.proposal.binding.target = 'other/bbbbbbbb'; setText(f.view.root, '接收端返回的原许可 JSON', JSON.stringify(bad)); expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(true)
    btn(f.view.root, '核对固定续接（不发送）').click(); expect(f.act).toHaveBeenCalledTimes(1)
  })
  it('queries first, confirms once, then an uncertain send stays query-only', async () => {
    const f = preparedSender(); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true); await queryPermit(f)
    f.act.mockImplementationOnce(async () => { throw Error('lost send reply') })
    btn(f.view.root, '按原许可单次续接').click(); btn(f.view.root, '按原许可单次续接').click()
    await vi.waitFor(() => expect(f.view.root.textContent).toContain('单次发送结果未知'))
    expect(confirm).toHaveBeenCalledTimes(1); expect(f.act.mock.calls.filter(([b]) => b.action === 'outbound-narrow-send')).toHaveLength(1)
    expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(true); await queryPermit(f); expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(true)
  })
  it('does not send when the explicit one-shot confirmation is cancelled', async () => {
    const f = preparedSender(); vi.spyOn(window, 'confirm').mockReturnValue(false); await queryPermit(f); btn(f.view.root, '按原许可单次续接').click(); expect(f.act.mock.calls.filter(([b]) => b.action === 'outbound-narrow-send')).toHaveLength(0)
  })
  it('acceptance only disables sending and never claims business completion', async () => {
    const f = preparedSender(); f.act.mockResolvedValue({ ok: true, state: 'accepted', task: 'recover-one' }); await queryPermit(f)
    expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(true); expect(f.view.root.textContent).toContain('仍需原正式业务回执')
  })
  it.each(['dispatching', 'unknown', 'accepted', 'answered'])('phase %s cannot authorize a new send', async phase => {
    const f = sender({ existing: { ...row, narrowRecovery: { proposal: proposal(), phase } } }); await queryPermit(f); expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(true)
  })
  it('an owner-auth failure on query never enables sending', async () => {
    const f = preparedSender(); f.act.mockResolvedValue({ ok: false, code: 'owner-proof' }); await queryPermit(f); expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(true); expect(f.view.root.textContent).toContain('owner-proof')
  })
  it('an unknown preparation cannot be blindly repeated but a durable result can be recovered', async () => {
    const f = sender({ act: async () => { throw Error('reply lost') } }); fillSender(f.view.root); tick(f.view.root, senderChecked).checked = true; btn(f.view.root, '准备原请求草案（不发送）').click()
    await vi.waitFor(() => expect(f.view.root.textContent).toContain('准备结果未知')); expect(btn(f.view.root, '准备原请求草案（不发送）').disabled).toBe(true)
    f.view.sync({ ...row, narrowRecovery: { proposal: f.p, phase: 'prepared' } }); expect(btn(f.view.root, '核对固定续接（不发送）').disabled).toBe(false); expect(f.act).toHaveBeenCalledTimes(1)
  })
  it('a team switch or changed original text stops all actions', async () => {
    let current = true; const f = sender({ existing: { ...row, narrowRecovery: { proposal: proposal(), phase: 'prepared' } }, current: () => current }); await queryPermit(f); current = false; btn(f.view.root, '按原许可单次续接').click(); expect(f.act).toHaveBeenCalledTimes(1)
    current = true; f.view.sync({ ...row, text: 'changed', narrowRecovery: { proposal: f.p, phase: 'prepared' } }); expect(btn(f.view.root, '核对固定续接（不发送）').disabled).toBe(true)
  })
})

describe('receiver owner consent form', () => {
  function receiver() { const act = vi.fn(async (b: RecoveryJson) => b.action === 'grant' ? { ok: true, permit: permit(b.proposal as ReturnType<typeof proposal>) } : { ok: true }), view = createReceiverRecovery(act); document.body.append(view.root); return { root: view.root, view, act } }
  function inspect(f: ReturnType<typeof receiver>, p = proposal()) { setText(f.root, '发送端原签名草案 JSON', JSON.stringify(p)); btn(f.root, '预览固定原请求').click() }
  it('renders untrusted data as text and resets attestation on every preview', () => {
    const f = receiver(), p = proposal(); p.binding.message = '<img src=x onerror=alert(1)>'; inspect(f, p)
    expect(f.root.querySelector('img')).toBeNull(); expect(f.root.textContent).toContain('<img'); expect(tick(f.root, receiverChecked).checked).toBe(false)
    tick(f.root, receiverChecked).checked = true; btn(f.root, '预览固定原请求').click(); expect(tick(f.root, receiverChecked).checked).toBe(false); expect(f.act).not.toHaveBeenCalled()
  })
  it('does not grant without original evidence attestation and exact confirmed preview', async () => {
    const f = receiver(); inspect(f); setText(f.root, '接收端未接纳核对说明（单行，≤2000字符）', 'receiver checked original admission evidence'); btn(f.root, '为这一个原请求签发临时许可').click(); expect(f.act).not.toHaveBeenCalled()
    tick(f.root, receiverChecked).checked = true; vi.spyOn(window, 'confirm').mockReturnValue(true); btn(f.root, '为这一个原请求签发临时许可').click()
    await vi.waitFor(() => expect(field(f.root, '返回许可（交回发送端原卡）').value).toContain('receiver-signature'))
    expect(f.act).toHaveBeenCalledWith({ action: 'grant', proposal: proposal(), reconciliation: 'receiver checked original admission evidence', checked_not_admitted: true })
    expect(localStorage.length).toBe(0)
  })
  it('a lost grant reply is not repeated by pasting the same request again', async () => {
    const f = receiver(); f.act.mockRejectedValue(Error('lost')); inspect(f); tick(f.root, receiverChecked).checked = true; setText(f.root, '接收端未接纳核对说明（单行，≤2000字符）', 'checked'); vi.spyOn(window, 'confirm').mockReturnValue(true); btn(f.root, '为这一个原请求签发临时许可').click()
    await vi.waitFor(() => expect(f.root.textContent).toContain('许可结果未知')); inspect(f); expect(btn(f.root, '为这一个原请求签发临时许可').disabled).toBe(true); expect(f.act).toHaveBeenCalledTimes(1)
  })
  it('revocation carries only the original requestId and preserves accepted fact wording', async () => {
    const f = receiver(); inspect(f); vi.spyOn(window, 'confirm').mockReturnValue(true); btn(f.root, '撤销这个原请求许可').click(); await vi.waitFor(() => expect(f.root.textContent).toContain('不抹去已接纳事实'))
    expect(f.act).toHaveBeenCalledWith({ action: 'revoke', request_id: 'rr-request-one' })
  })
  it('the workbench owner panel exposes receiver consent without requiring a local team', () => {
    const v = createWorkbench({ now: () => Date.now(), abandon: async () => false, canvasOp: async () => false, copy: () => {}, requestRecovery: async () => ({ ok: false, code: 'owner-proof' }) }); document.body.append(v.root); v.update({ version: 'candidate' }); v.root.querySelector<HTMLElement>('[data-testid="wb-owner-btn"]')!.click(); expect(v.root.querySelector('[data-testid="request-recovery-owner"]')).not.toBeNull()
  })
  it('old detached sender controls cannot act after switching teams', () => {
    const act = vi.fn(async () => ({ ok: true })); const p = createSuperagentPane({ act, refresh: () => {}, selectTeam: () => {} }); document.body.append(p.root)
    const state: SaState = { settings: { canvas: 'one', members: [], remoteMembers: [], acceptMode: 'observe', paused: false, sources: { workbench: true, a2a: true } }, policyVersion: 'one', selectedTeam: 'team-one', teams: [{ id: 'team-one' }, { id: 'team-two' }], a2a: { enabled: true, address: 'sender', health: {} }, executor: { bindings: [] }, threads: [], outbound: [row], tickets: [{ id: row.ticketId, title: 'original', createdAt: '2026-11-15', updatedAt: '2026-11-15', mandate: { scope: 's', strength: 'explicit', basis: { via: 'owner' }, actor: { source: 'workbench', id: 'owner' } }, channels: [], inputs: [], assignments: [], stage: { stage: 'person', action: 'blocked' } }] }
    p.update(state, [], Date.now()); const form = p.root.querySelector<HTMLElement>('[data-recovery="card-one"]')!; expect(form).not.toBeNull(); fillSender(form); tick(form, senderChecked).checked = true
    const select = p.root.querySelector<HTMLSelectElement>('[aria-label="当前团队"]') ?? p.root.querySelector<HTMLSelectElement>('select')!; select.value = 'team-two'; select.dispatchEvent(new Event('change')); btn(form, '准备原请求草案（不发送）').click(); expect(act).not.toHaveBeenCalled()
  })
})


describe('owner response and async lifecycle fences', () => {
  it.each([401, 403, 500, 503])('HTTP %s cannot be overridden by ok:true in a body', async status => {
    expect(await recoveryOwnerResponse({ ok: false, status, json: async () => ({ ok: true, permit: permit() }) } as Response)).toMatchObject({ ok: false, status })
  })
  it('invalid JSON and 200 ok:false remain failures', async () => {
    expect(await recoveryOwnerResponse({ ok: true, status: 200, json: async () => { throw Error('not JSON') } } as unknown as Response)).toMatchObject({ ok: false })
    expect(await recoveryOwnerResponse({ ok: true, status: 200, json: async () => ({ ok: false, code: 'owner-proof' }) } as Response)).toEqual({ ok: false, code: 'owner-proof' })
  })
  it.each(['unknown', 'unavailable'])('query %s never enables first sending even while local phase is prepared', async query => {
    const f = preparedSender(); f.act.mockResolvedValue({ ok: false, state: 'unknown', phase: 'prepared', query, task: 'recover-one' }); await queryPermit(f); expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(true)
  })
  it('late prepared response after A-B-A invalidation neither fills proposal nor refreshes another view', async () => {
    let resolve!: (v: RecoveryJson) => void; const waiting = new Promise<RecoveryJson>(r => { resolve = r })
    const f = sender({ act: async () => waiting }); fillSender(f.view.root); tick(f.view.root, senderChecked).checked = true; btn(f.view.root, '准备原请求草案（不发送）').click()
    f.view.invalidate(); resolve({ ok: true, proposal: f.p }); await waiting; await Promise.resolve();
    expect(field(f.view.root, '原签名草案（交接至接收端主人页面）').value).toBe(''); expect(f.refresh).not.toHaveBeenCalled(); expect(btn(f.view.root, '核对固定续接（不发送）').disabled).toBe(true)
  })
  it('changing permit while query is delayed invalidates its ready response', async () => {
    let resolve!: (v: RecoveryJson) => void; const waiting = new Promise<RecoveryJson>(r => { resolve = r }); const f = preparedSender(); f.act.mockImplementationOnce(async () => waiting)
    setText(f.view.root, '接收端返回的原许可 JSON', JSON.stringify(permit(f.p))); btn(f.view.root, '核对固定续接（不发送）').click(); setText(f.view.root, '接收端返回的原许可 JSON', '{}');
    resolve({ ok: true, state: 'prepared', phase: 'prepared', query: 'ready', task: 'recover-one' }); await waiting; await Promise.resolve(); expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(true)
  })
  it('closing receiver owner panel invalidates a delayed grant but retains a revoke input', async () => {
    let resolve!: (v: RecoveryJson) => void; const waiting = new Promise<RecoveryJson>(r => { resolve = r }); const act = vi.fn(async () => waiting)
    let current = true; const view = createReceiverRecovery(act, () => current); document.body.append(view.root)
    setText(view.root, '发送端原签名草案 JSON', JSON.stringify(proposal())); btn(view.root, '预览固定原请求').click(); tick(view.root, receiverChecked).checked = true; setText(view.root, '接收端未接纳核对说明（单行，≤2000字符）', 'checked'); vi.spyOn(window, 'confirm').mockReturnValue(true)
    btn(view.root, '为这一个原请求签发临时许可').click(); current = false; view.invalidate(); current = true; resolve({ ok: true, permit: permit() }); await waiting; await Promise.resolve()
    expect(field(view.root, '返回许可（交回发送端原卡）').value).toBe(''); expect(field(view.root, '待撤销的原 requestId').value).toBe('rr-request-one'); expect(tick(view.root, receiverChecked).checked).toBe(false)
  })
})


describe('recovery owner explicit close and expiry', () => {
  it('expired exact permit never sends even after a ready query', async () => {
    const f = preparedSender(); const expired = { ...permit(f.p), issuedAt: Date.now() - 5000, expiresAt: Date.now() - 1000 }
    setText(f.view.root, '接收端返回的原许可 JSON', JSON.stringify(expired)); btn(f.view.root, '核对固定续接（不发送）').click(); await vi.waitFor(() => expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(false))
    vi.spyOn(window, 'confirm').mockReturnValue(true); btn(f.view.root, '按原许可单次续接').click(); expect(f.act.mock.calls.filter(([b]) => b.action === 'outbound-narrow-send')).toHaveLength(0); expect(f.view.root.textContent).toContain('已过期')
  })
  it('sender details close clears permit and makes detached old form inert', async () => {
    const f = preparedSender(); f.view.root.open = true; f.view.root.dispatchEvent(new Event('toggle')); await queryPermit(f)
    f.view.root.open = false; f.view.root.dispatchEvent(new Event('toggle')); expect(field(f.view.root, '接收端返回的原许可 JSON').value).toBe(''); expect(btn(f.view.root, '按原许可单次续接').disabled).toBe(true)
  })
  it('receiver reload can revoke a pasted exact request without a new grant', async () => {
    const act = vi.fn(async () => ({ ok: true })), view = createReceiverRecovery(act); document.body.append(view.root); setText(view.root, '待撤销的原 requestId', 'rr-from-old-page'); vi.spyOn(window, 'confirm').mockReturnValue(true)
    btn(view.root, '撤销这个原请求许可').click(); await vi.waitFor(() => expect(act).toHaveBeenCalledWith({ action: 'revoke', request_id: 'rr-from-old-page' }))
  })
  it('receiver rejects a successful-looking response that has no permit signature/time', async () => {
    const act = vi.fn(async () => ({ ok: true, permit: { proposal: proposal() } })), view = createReceiverRecovery(act); document.body.append(view.root)
    setText(view.root, '发送端原签名草案 JSON', JSON.stringify(proposal())); btn(view.root, '预览固定原请求').click(); tick(view.root, receiverChecked).checked = true; setText(view.root, '接收端未接纳核对说明（单行，≤2000字符）', 'checked'); vi.spyOn(window, 'confirm').mockReturnValue(true)
    btn(view.root, '为这一个原请求签发临时许可').click(); await vi.waitFor(() => expect(act).toHaveBeenCalled()); await Promise.resolve(); expect(field(view.root, '返回许可（交回发送端原卡）').value).toBe('')
  })
})


describe('review R1 real outer workbench navigation', () => {
  function integrated(action: (body: RecoveryJson) => Promise<RecoveryJson>, prepared = true) {
    const act = vi.fn(action), refresh = vi.fn(); let canvasUp = true
    const wb = createWorkbench({ now: () => Date.now(), abandon: async () => false, canvasOp: async () => false, copy: () => {}, superagent: { act, refresh }, board: { root: document.createElement('div'), available: () => canvasUp, activate: () => {}, deactivate: () => {} } })
    workbenches.push(wb)
    document.body.append(wb.root)
    const selectedRow = prepared ? { ...row, narrowRecovery: { proposal: proposal(), phase: 'prepared' } } : row
    const state: SaState = { settings: { canvas: 'one', members: [], remoteMembers: [], acceptMode: 'observe', paused: false, sources: { workbench: true, a2a: true } }, policyVersion: 'one', selectedTeam: 'team-one', a2a: { enabled: true, address: 'sender', health: {} }, executor: { bindings: [] }, threads: [], outbound: [selectedRow], tickets: [{ id: row.ticketId, title: 'original', createdAt: '2026-11-15', updatedAt: '2026-11-15', mandate: { scope: 's', strength: 'explicit', basis: { via: 'owner' }, actor: { source: 'workbench', id: 'owner' } }, channels: [], inputs: [], assignments: [], stage: { stage: 'person', action: 'blocked' } }] }
    wb.update({ version: 'candidate', tasks: [{ taskId: 'pending-old', team: 'beta/aaaaaaaa', startedAt: 1, status: 'pending', direction: 'outbound' }] }); wb.updateSuperagent(state); wb.selectTab('team')
    const form = () => wb.root.querySelector<HTMLElement>('[data-recovery="card-one"]')!
    const tab = (key: string) => wb.root.querySelector<HTMLButtonElement>('.wb-tabs [data-sec="' + key + '"]')!
    return { wb, act, refresh, form, tab, mode: () => { canvasUp = !canvasUp; wb.update({ version: 'candidate' }) } }
  }
  const ready: RecoveryJson = { ok: true, state: 'prepared', phase: 'prepared', query: 'ready', task: 'recover-one' }
  it.each(['click', 'keyboard', 'selectTab', 'alert', 'mode', 'collapse'])('outer %s transition invalidates a late ready query and requires a new query', async route => {
    let complete!: (v: RecoveryJson) => void; const delay = new Promise<RecoveryJson>(r => { complete = r })
    let queries = 0; const f = integrated(async () => ++queries === 1 ? delay : ready), old = f.form()
    setText(old, '接收端返回的原许可 JSON', JSON.stringify(permit())); btn(old, '核对固定续接（不发送）').click()
    if (route === 'click') { f.tab('ledger').click(); f.tab('team').click() }
    else if (route === 'keyboard') { f.tab('team').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); f.tab('team').click() }
    else if (route === 'selectTab') { f.wb.selectTab('ledger'); f.wb.selectTab('team') }
    else if (route === 'collapse') { const toggle = f.wb.root.querySelector<HTMLButtonElement>('[data-testid="wb-rail-toggle"]')!; toggle.click(); toggle.click() }
    else if (route === 'alert') { const alert = f.wb.root.querySelector<HTMLButtonElement>('.wb-alert')!; expect(alert).not.toBeNull(); alert.click(); f.wb.selectTab('team') }
    else { f.mode(); f.mode(); f.wb.selectTab('team') }
    complete(ready); await delay; await Promise.resolve()
    const fresh = f.form(); expect(fresh).not.toBe(old); expect(field(fresh, '接收端返回的原许可 JSON').value).toBe(''); expect(btn(fresh, '按原许可单次续接').disabled).toBe(true); expect(f.refresh).not.toHaveBeenCalled()
    btn(old, '按原许可单次续接').click(); expect(f.act).toHaveBeenCalledTimes(1)
    setText(fresh, '接收端返回的原许可 JSON', JSON.stringify(permit())); btn(fresh, '核对固定续接（不发送）').click(); await vi.waitFor(() => expect(btn(fresh, '按原许可单次续接').disabled).toBe(false)); expect(f.act.mock.calls.every(([b]) => b.teamId === 'team-one')).toBe(true)
  })
  function resize(width: number): void { vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(width); window.dispatchEvent(new Event('resize')) }
  it.each(['delayed', 'ready'])('responsive width roundtrip invalidates %s readiness without a poll', async phase => {
    resize(1280)
    let complete!: (v: RecoveryJson) => void; const delayed = new Promise<RecoveryJson>(r => { complete = r })
    let count = 0; const f = integrated(async () => ++count === 1 && phase === 'delayed' ? delayed : ready), old = f.form()
    setText(old, '接收端返回的原许可 JSON', JSON.stringify(permit())); btn(old, '核对固定续接（不发送）').click()
    if (phase === 'ready') await vi.waitFor(() => expect(btn(old, '按原许可单次续接').disabled).toBe(false))
    resize(1023); expect(btn(old, '按原许可单次续接').disabled).toBe(true); resize(1280)
    if (phase === 'delayed') { complete(ready); await delayed; await Promise.resolve() }
    const fresh = f.form(); expect(fresh).not.toBe(old); expect(field(fresh, '接收端返回的原许可 JSON').value).toBe(''); expect(btn(fresh, '按原许可单次续接').disabled).toBe(true)
    expect(f.refresh).toHaveBeenCalledTimes(phase === 'ready' ? 1 : 0); btn(old, '按原许可单次续接').click(); expect(f.act).toHaveBeenCalledTimes(1)
    setText(fresh, '接收端返回的原许可 JSON', JSON.stringify(permit())); btn(fresh, '核对固定续接（不发送）').click(); await vi.waitFor(() => expect(btn(fresh, '按原许可单次续接').disabled).toBe(false))
    expect(f.act.mock.calls.filter(([body]) => body.action !== 'outbound-narrow-reconcile')).toHaveLength(0)
  })
  it.each(['open drawer', 'data stage'])('responsive change keeps a genuinely visible %s recovery form', async view => {
    resize(1280); const f = integrated(async () => ready)
    if (view === 'open drawer') f.wb.root.querySelector<HTMLButtonElement>('[data-testid="wb-menu"]')!.click(); else f.mode()
    const original = f.form(); setText(original, '接收端返回的原许可 JSON', JSON.stringify(permit())); btn(original, '核对固定续接（不发送）').click(); await vi.waitFor(() => expect(btn(original, '按原许可单次续接').disabled).toBe(false))
    resize(1023); resize(1280); expect(f.form()).toBe(original); expect(btn(original, '按原许可单次续接').disabled).toBe(false)
    expect(f.act).toHaveBeenCalledTimes(1)
  })
  it('dispose unregisters the owned resize callback and leaves old recovery controls inert', async () => {
    resize(1280); const remove = vi.spyOn(window, 'removeEventListener'), f = integrated(async () => ready), old = f.form()
    setText(old, '接收端返回的原许可 JSON', JSON.stringify(permit())); btn(old, '核对固定续接（不发送）').click(); await vi.waitFor(() => expect(btn(old, '按原许可单次续接').disabled).toBe(false))
    f.wb.dispose(); expect(remove.mock.calls.some(([name]) => name === 'resize')).toBe(true); resize(1023); resize(1280)
    expect(btn(old, '按原许可单次续接').disabled).toBe(true); expect(field(old, '接收端返回的原许可 JSON').value).toBe(''); btn(old, '按原许可单次续接').click(); expect(f.act).toHaveBeenCalledTimes(1)
  })
  it('late prepare response cannot populate a new outer navigation lifetime', async () => {
    let complete!: (v: RecoveryJson) => void; const delay = new Promise<RecoveryJson>(r => { complete = r }), f = integrated(async () => delay, false), old = f.form()
    fillSender(old); tick(old, senderChecked).checked = true; btn(old, '准备原请求草案（不发送）').click(); f.wb.selectTab('ledger'); f.wb.selectTab('team'); complete({ ok: true, proposal: proposal() }); await delay; await Promise.resolve()
    expect(field(f.form(), '原签名草案（交接至接收端主人页面）').value).toBe(''); expect(f.act).toHaveBeenCalledTimes(1); expect(f.refresh).not.toHaveBeenCalled()
  })
  it('late send response cannot alter a new outer lifetime or issue a second send', async () => {
    let complete!: (v: RecoveryJson) => void; const delay = new Promise<RecoveryJson>(r => { complete = r }), f = integrated(async b => b.action === 'outbound-narrow-send' ? delay : ready), old = f.form()
    setText(old, '接收端返回的原许可 JSON', JSON.stringify(permit())); btn(old, '核对固定续接（不发送）').click(); await vi.waitFor(() => expect(btn(old, '按原许可单次续接').disabled).toBe(false)); vi.spyOn(window, 'confirm').mockReturnValue(true); btn(old, '按原许可单次续接').click()
    f.wb.selectTab('ledger'); f.wb.selectTab('team'); complete({ ok: true, state: 'accepted', task: 'recover-one' }); await delay; await Promise.resolve()
    expect(btn(f.form(), '按原许可单次续接').disabled).toBe(true); expect(field(f.form(), '接收端返回的原许可 JSON').value).toBe(''); expect(f.act.mock.calls.filter(([b]) => b.action === 'outbound-narrow-send')).toHaveLength(1)
  })
})

describe('review R2 exact request revoke feedback', () => {
  it.each(['ready', 'accepted'])('revoking A preserves displayed B even when its phase is %s', async phase => {
    const b = proposal(); b.binding.requestId = 'rr-request-B'
    const act = vi.fn(async (body: RecoveryJson) => body.action === 'grant' ? { ok: true, permit: { ...permit(body.proposal as ReturnType<typeof proposal>), phase } } : { ok: true }), view = createReceiverRecovery(act); document.body.append(view.root)
    setText(view.root, '发送端原签名草案 JSON', JSON.stringify(b)); btn(view.root, '预览固定原请求').click(); tick(view.root, receiverChecked).checked = true; setText(view.root, '接收端未接纳核对说明（单行，≤2000字符）', 'checked'); const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true); btn(view.root, '为这一个原请求签发临时许可').click()
    await vi.waitFor(() => expect(field(view.root, '返回许可（交回发送端原卡）').value).toContain('rr-request-B')); const original = field(view.root, '返回许可（交回发送端原卡）').value
    setText(view.root, '待撤销的原 requestId', 'rr-request-A'); btn(view.root, '撤销这个原请求许可').click(); await vi.waitFor(() => expect(view.root.textContent).toContain('已撤销 requestId rr-request-A'))
    expect(view.root.textContent).toContain('当前展示 requestId rr-request-B 未撤销'); expect(field(view.root, '返回许可（交回发送端原卡）').value).toBe(original); expect(confirm.mock.calls.at(-1)?.[0]).toContain('rr-request-A'); expect(act.mock.calls.filter(([body]) => body.action === 'revoke')).toEqual([[{ action: 'revoke', request_id: 'rr-request-A' }]])
  })
  it('editing revoke ID invalidates an in-flight A response instead of reporting B revoked', async () => {
    let complete!: (v: RecoveryJson) => void; const delay = new Promise<RecoveryJson>(r => { complete = r }), act = vi.fn(async () => delay), view = createReceiverRecovery(act); document.body.append(view.root)
    setText(view.root, '待撤销的原 requestId', 'rr-request-A'); vi.spyOn(window, 'confirm').mockReturnValue(true); btn(view.root, '撤销这个原请求许可').click(); expect(field(view.root, '待撤销的原 requestId').disabled).toBe(true)
    setText(view.root, '待撤销的原 requestId', 'rr-request-B'); complete({ ok: true }); await delay; await Promise.resolve(); expect(view.root.textContent).not.toContain('已撤销 requestId rr-request-B'); expect(view.root.textContent).not.toContain('已撤销 requestId rr-request-A'); expect(act).toHaveBeenCalledWith({ action: 'revoke', request_id: 'rr-request-A' })
  })
})
