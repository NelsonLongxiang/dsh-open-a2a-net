/** Browser-owner UI for the existing exact-request recovery protocol. No credential or remote-host proxy. */
export type RecoveryJson = Record<string, unknown>
/** HTTP status is part of owner authorization; an error body cannot override it. */
export async function recoveryOwnerResponse(res: Response): Promise<RecoveryJson> {
  let value: unknown; try { value = await res.json() } catch { return { ok: false, status: res.status, error: 'HTTP ' + res.status + ': invalid JSON' } }
  if (!res.ok || !object(value)) return { ok: false, status: res.status, error: object(value) ? String(value.error ?? value.code ?? ('HTTP ' + res.status)) : 'Invalid owner response' }
  return value
}
export interface RecoveryOutbound {
  readonly card: string; readonly task: string; readonly ticketId: string; readonly address: string; readonly text: string
  readonly state: string
  readonly narrowRecovery?: { readonly proposal: unknown; readonly phase: string }
}
interface Proposal extends RecoveryJson { binding: RecoveryJson; signature: string }
function object(value: unknown): value is RecoveryJson { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function proposal(value: unknown): Proposal {
  if (!object(value) || !object(value.binding) || typeof value.signature !== 'string') throw Error('不是原签名草案；此处仅预览，仍须服务端核签')
  const b = value.binding
  for (const key of ['requestId', 'ticketId', 'target', 'message', 'taskId', 'contextId', 'caller', 'senderHome', 'senderKey', 'cliKey', 'receiverHome', 'receiverKey', 'receiverSession']) {
    if (typeof b[key] !== 'string' || b[key] === '') throw Error('草案缺少固定身份字段：' + key)
  }
  if (!Array.isArray(b.originalCards) || !Array.isArray(b.originalTasks)) throw Error('草案缺少原尝试组')
  return value as Proposal
}
function parse(text: string): unknown { if (!text || text.length > 60_000) throw Error('请输入原始 JSON（最多 60000 字符）'); return JSON.parse(text) }
function exactPermit(raw: unknown, original: Proposal): RecoveryJson {
  if (!object(raw) || stable(raw.proposal) !== stable(original) || typeof raw.signature !== 'string' || raw.signature === '' || typeof raw.reconciliation !== 'string' || raw.reconciliation === '') throw Error('许可不是本草案原件')
  if (!Number.isSafeInteger(raw.issuedAt) || !Number.isSafeInteger(raw.expiresAt) || Number(raw.expiresAt) <= Number(raw.issuedAt) || Number(raw.expiresAt) - Number(raw.issuedAt) > 3_600_000) throw Error('许可时段无效')
  return raw
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  if (object(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el
}
function area(root: HTMLElement, label: string, readOnly = false): HTMLTextAreaElement {
  const el = node('textarea'); el.className = 'wb-sa-input'; el.rows = 3; el.setAttribute('aria-label', label); el.readOnly = readOnly
  root.append(node('label', label), el); return el
}
function check(root: HTMLElement, text: string): HTMLInputElement {
  const wrap = node('label'), el = node('input'); el.type = 'checkbox'; el.setAttribute('aria-label', text); wrap.append(el, document.createTextNode(text)); root.append(wrap); return el
}
function button(root: HTMLElement, text: string): HTMLButtonElement { const el = node('button', text); el.type = 'button'; el.className = 'wb-btn'; root.append(el); return el }
function preview(root: HTMLElement, p: Proposal): void {
  const b = p.binding; root.replaceChildren(node('strong', '草案预览（服务端仍须核签）'))
  for (const key of ['requestId', 'ticketId', 'originalCards', 'originalTasks', 'taskId', 'contextId', 'caller', 'senderHome', 'senderKey', 'cliKey', 'receiverHome', 'receiverKey', 'receiverSession', 'target', 'approvalAt', 'approvalDigest', 'senderReconciliation']) {
    root.append(node('div', key + ': ' + (typeof b[key] === 'string' ? b[key] : JSON.stringify(b[key]))))
  }
  root.append(node('pre', String(b.message)))
}
const hasAudit = (text: string): boolean => text.trim().length > 0 && text.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(text)

/** Cached per original team/card/task. Every request includes the captured teamId, never the currently selected team. */
export function createSenderRecovery(input: {
  row: RecoveryOutbound; teamId: string; act(body: RecoveryJson): Promise<RecoveryJson>; current(): boolean; refresh(): void; closed?(): void
}): { root: HTMLElement; sync(row: RecoveryOutbound): void; invalidate(): void } {
  const root = node('details'); root.className = 'wb-sa-hint'; root.dataset.recovery = input.row.card
  root.append(node('summary', '旧失败原请求：主人窄恢复'))
  root.append(node('div', '准备会持久绑定原请求并生成提案，不发送；清空表单不会撤销已保存的绑定。先核原批准、身份、全部旧尝试及停止事实；空账本不等于未送达。不新卡、不改成员、不重批。'))
  const home = area(root, '固定接收主机 origin'), key = area(root, '固定接收主机完整公钥'), session = area(root, '固定接收完整 SessionId')
  const audit = area(root, '发送端原链核对说明（单行，≤2000字符）'), checked = check(root, '我已核实原批准、原身份、全部旧尝试和停止事实')
  const prepare = button(root, '准备原请求草案（不发送）'), shown = node('div'); root.append(shown)
  const output = area(root, '原签名草案（交接至接收端主人页面）', true)
  const pasted = area(root, '接收端返回的原许可 JSON'), query = button(root, '核对固定续接（不发送）')
  const send = button(root, '按原许可单次续接'), note = node('div'); note.setAttribute('role', 'status'); root.append(note)
  let p: Proposal | undefined, record = input.row, busy = false, preparationUnknown = false, maySend = false, sent = false, changed = false
  let epoch = 0
  const birthOrigin = window.location.origin
  const base = { teamId: input.teamId, card_id: input.row.card, task_id: input.row.task }
  const enabled = (): boolean => input.current() && window.location.origin === birthOrigin && !changed && record.task === input.row.task && record.state === 'failed'
  const freeze = (): void => {
    for (const el of [home, key, session, audit, checked]) el.disabled = busy || p !== undefined || preparationUnknown
    prepare.disabled = busy || !!p || preparationUnknown || !enabled()
    query.disabled = busy || !p || !enabled(); send.disabled = busy || !p || !maySend || sent || !enabled()
  }
  function setProposal(raw: unknown): void {
    const parsed = proposal(raw), b = parsed.binding
    if (b.ticketId !== input.row.ticketId || b.target !== input.row.address || !(b.originalCards as unknown[]).includes(input.row.card) || !(b.originalTasks as unknown[]).includes(input.row.task)) throw Error('草案不是这张原卡／task／目标')
    if (p && stable(parsed) !== stable(p)) throw Error('草案已改变；停止并按原链对账')
    p = parsed; home.value = String(b.receiverHome); key.value = String(b.receiverKey); session.value = String(b.receiverSession)
    output.value = JSON.stringify(parsed, null, 2); preview(shown, parsed)
    const phase = node('div', '固定续接状态：' + (record.narrowRecovery?.phase ?? 'prepared')); phase.dataset.recoveryPhase = 'true'; shown.append(phase)
  }
  function permit(): RecoveryJson {
    if (!p) throw Error('缺少原草案')
    return exactPermit(parse(pasted.value), p)
  }
  prepare.addEventListener('click', async () => {
    if (prepare.disabled || !enabled() || !root.isConnected) return
    if (!checked.checked || !hasAudit(audit.value)) { note.textContent = '必须先人工核对并填写核对说明；没有准备或发送'; return }
    let receiver: { home: string; key: string; session: string }
    try { const u = new URL(home.value); if (!['http:', 'https:'].includes(u.protocol) || u.origin !== home.value || u.username || u.password) throw Error(); receiver = { home: home.value, key: key.value, session: session.value }; if (!receiver.key || !receiver.session) throw Error() } catch { note.textContent = '固定接收主机／公钥／完整会话不完整'; return }
    const generation = epoch; busy = true; freeze()
    try {
      const out = await input.act({ ...base, action: 'outbound-narrow-prepare', receiver, checked_original_chain: true, reconciliation: audit.value })
      if (generation !== epoch || !enabled() || !root.isConnected) return
      if (out.ok !== true) { note.textContent = '未准备：' + String(out.error ?? out.code ?? '主人鉴权或原证不可用'); return }
      setProposal(out.proposal); note.textContent = '只准备了固定草案，没有发送。到固定接收主机的主人页面核对后签发许可。'; input.refresh()
    } catch (e) { preparationUnknown = true; if (generation !== epoch || !enabled() || !root.isConnected) return; note.textContent = '准备结果未知；刷新检查已保存的同一原链，不重新准备：' + String(e); input.refresh() }
    finally { busy = false; freeze() }
  })
  pasted.addEventListener('input', () => { epoch++; maySend = false; freeze() })
  query.addEventListener('click', async () => {
    if (query.disabled || !enabled() || !root.isConnected) return
    let raw: RecoveryJson; try { raw = permit() } catch (e) { note.textContent = String(e); return }
    const generation = epoch; busy = true; maySend = false; freeze()
    try {
      const out = await input.act({ ...base, action: 'outbound-narrow-reconcile', permit: raw })
      if (generation !== epoch || !enabled() || !root.isConnected) return
      if (out.task !== p?.binding.taskId) { note.textContent = '原链不匹配或鉴权失败；没有发送：' + String(out.error ?? out.code ?? 'task mismatch'); return }
      if (out.ok === true && ['accepted', 'answered'].includes(String(out.state))) { sent = true; note.textContent = '固定续接已接纳；仍需原正式业务回执，不再发送。' }
      else if (out.ok === true && out.state === 'prepared' && out.phase === 'prepared' && out.query === 'ready') { maySend = !sent; note.textContent = '接收端原许可仍未消耗，本地仍为prepared。仅可由主人明确确认首次续接；不是从空查询推断未投递。' }
      else if (out.state === 'unknown') note.textContent = '结果未知，只能继续核对固定task；不可再次发送。'
      else note.textContent = '核对未通过：' + String(out.error ?? out.code ?? out.state)
    } catch (e) { if (generation === epoch && enabled() && root.isConnected) note.textContent = '核对结果未知，没有发送：' + String(e) }
    finally { busy = false; freeze(); if (generation === epoch && enabled() && root.isConnected) input.refresh() }
  })
  send.addEventListener('click', async () => {
    if (send.disabled || !enabled() || !root.isConnected) return
    let raw: RecoveryJson; try { raw = permit(); if (Date.now() < Number(raw.issuedAt) || Date.now() >= Number(raw.expiresAt)) throw Error('许可已过期') } catch (e) { maySend = false; freeze(); note.textContent = String(e); return }
    if (!window.confirm('仅按已核对原文、原目标和固定许可续接一次。不新卡、不扩准入；结果未知只核对，不再POST。确认？')) return
    const generation = epoch; sent = true; maySend = false; busy = true; freeze()
    try {
      const out = await input.act({ ...base, action: 'outbound-narrow-send', permit: raw })
      if (generation !== epoch || !enabled() || !root.isConnected) return
      note.textContent = out.ok === true && out.task === p?.binding.taskId && ['accepted', 'answered'].includes(String(out.state)) ? '固定续接已接纳；等待正式业务回执，不等于业务完成。' : '未确认接纳，只核对固定task，不再发送：' + String(out.error ?? out.code ?? out.state)
    } catch (e) { if (generation === epoch && enabled() && root.isConnected) note.textContent = '单次发送结果未知；只核对同一task，不重发：' + String(e) }
    finally { busy = false; freeze(); if (generation === epoch && enabled() && root.isConnected) input.refresh() }
  })
  function sync(row: RecoveryOutbound): void {
    if (['card', 'task', 'ticketId', 'address', 'text'].some(k => row[k as keyof RecoveryOutbound] !== input.row[k as keyof RecoveryOutbound])) { changed = true; maySend = false; note.textContent = '原卡／目标／正文已改变；停止并重新核对。' }
    record = row
    if (row.narrowRecovery) {
      try { setProposal(row.narrowRecovery.proposal); if (row.narrowRecovery.phase !== 'prepared') { sent = true; maySend = false } } catch (e) { preparationUnknown = true; maySend = false; note.textContent = String(e) }
    }
    freeze()
  }
  function invalidate(): void { epoch++; changed = true; maySend = false; checked.checked = false; pasted.value = ''; output.value = ''; p = undefined; shown.replaceChildren(); freeze() }
  let opened = false
  root.addEventListener('toggle', () => { if (root.open) opened = true; else if (opened) { opened = false; invalidate(); input.closed?.() } })
  sync(record)
  return { root, sync, invalidate }
}

/** Local receiving owner only. Pasted values are data; they never choose a fetch URL. */
export function createReceiverRecovery(act: (body: RecoveryJson) => Promise<RecoveryJson>, current: () => boolean = () => true): { root: HTMLElement; invalidate(): void; refresh(): void } {
  const root = node('details'); root.className = 'wb-hint'; root.dataset.testid = 'request-recovery-owner'
  root.append(node('summary', '接收端：核对一个原请求的临时许可'), node('div', '仅当前已登录主人可签发。核验原未送达事实、原调用身份及完整接收会话；空账本或过期查询不是证明。不会改变成员、准入或转发其他请求。'))
  const raw = area(root, '发送端原签名草案 JSON'), inspect = button(root, '预览固定原请求'), shown = node('div'); root.append(shown)
  const audit = area(root, '接收端未接纳核对说明（单行，≤2000字符）'), checked = check(root, '我已核实全部原尝试未被接纳及原身份延续')
  const grant = button(root, '为这一个原请求签发临时许可'), output = area(root, '返回许可（交回发送端原卡）', true)
  const revokeId = area(root, '待撤销的原 requestId'), revoke = button(root, '撤销这个原请求许可'), note = node('div'); note.setAttribute('role', 'status'); root.append(note)
  let viewed: Proposal | undefined, busy = false, grantAttempted = false, epoch = 0, displayedPermitId: string | undefined
  const birthOrigin = window.location.origin
  const active = (): boolean => current() && window.location.origin === birthOrigin && root.isConnected
  const attempted = new Set<string>()
  const refresh = (): void => { inspect.disabled = busy; grant.disabled = busy || !viewed || grantAttempted; revoke.disabled = busy; revokeId.disabled = busy; raw.disabled = busy; audit.disabled = busy; checked.disabled = busy }
  raw.addEventListener('input', () => { epoch++; viewed = undefined; checked.checked = false; output.value = ''; displayedPermitId = undefined; grantAttempted = false; shown.replaceChildren(); refresh() })
  revokeId.addEventListener('input', () => { epoch++; note.textContent = ''; refresh() })
  inspect.addEventListener('click', () => {
    if (!active()) return
    epoch++
    try { viewed = proposal(parse(raw.value)); checked.checked = false; grantAttempted = attempted.has(String(viewed.binding.requestId)); preview(shown, viewed); revokeId.value = String(viewed.binding.requestId); note.textContent = '只预览未核签数据；请在本机核对固定接收身份与原未接纳事实后确认。' } catch (e) { viewed = undefined; note.textContent = String(e) }
    refresh()
  })
  grant.addEventListener('click', async () => {
    if (grant.disabled || !viewed || !active()) return
    if (!checked.checked || !hasAudit(audit.value)) { note.textContent = '必须先核查原件并填写说明；未签发'; return }
    if (!window.confirm('只给上面完整绑定的一个请求临时许可；不是重新批准业务，也不增加任何长期准入。确认核对完成？')) return
    const p = viewed, generation = epoch; busy = true; grantAttempted = true; attempted.add(String(p.binding.requestId)); refresh()
    try {
      const out = await act({ action: 'grant', proposal: p, reconciliation: audit.value, checked_not_admitted: true })
      if (generation !== epoch || !active()) return
      if (out.ok !== true || !object(out.permit) || stable(out.permit.proposal) !== stable(p)) { note.textContent = '未取得匹配许可；核原记录，不重复签发：' + String(out.error ?? out.code ?? 'permit mismatch'); return }
      const acceptedPermit = exactPermit(out.permit, p)
      displayedPermitId = String(p.binding.requestId)
      output.value = JSON.stringify(acceptedPermit, null, 2); note.textContent = '已取得这一个固定许可，没有投递业务；交回发送端原卡。有效期：' + String(acceptedPermit.issuedAt) + ' → ' + String(acceptedPermit.expiresAt)
    } catch (e) { if (generation === epoch && active()) note.textContent = '许可结果未知；保留requestId并核对／撤销原许可，不自动重签：' + String(e) }
    finally { busy = false; refresh() }
  })
  revoke.addEventListener('click', async () => {
    if (!active()) return
    if (revoke.disabled || !/^rr-[A-Za-z0-9-]{1,77}$/.test(revokeId.value)) { note.textContent = '填写原requestId，不选择其他请求'; return }
    const requestId = revokeId.value
    if (!window.confirm('撤销原 requestId ' + requestId + ' 的许可？已发生的接纳事实不会因此抹去。')) return
    const generation = epoch; busy = true; note.textContent = '正在撤销 requestId ' + requestId; refresh()
    try {
      const out = await act({ action: 'revoke', request_id: requestId })
      if (generation !== epoch || !active() || revokeId.value !== requestId) return
      if (out.ok === true) {
        if (displayedPermitId === requestId) { output.value = ''; displayedPermitId = undefined }
        const other = displayedPermitId ?? (viewed && String(viewed.binding.requestId) !== requestId ? String(viewed.binding.requestId) : undefined)
        note.textContent = '已撤销 requestId ' + requestId + '；' + (other ? '当前展示 requestId ' + other + ' 未撤销；' : '') + '不抹去已接纳事实。'
      } else note.textContent = '未撤销 requestId ' + requestId + '：' + String(out.error ?? out.code)
    } catch (e) { if (generation === epoch && active()) note.textContent = '撤销 requestId ' + requestId + ' 结果未知：' + String(e) }
    finally { busy = false; refresh() }
  })
  function invalidate(): void { epoch++; viewed = undefined; checked.checked = false; output.value = ''; displayedPermitId = undefined; raw.value = ''; audit.value = ''; shown.replaceChildren(); refresh() }
  let opened = false
  root.addEventListener('toggle', () => { if (root.open) opened = true; else if (opened) { opened = false; invalidate() } })
  refresh(); return { root, invalidate, refresh }
}
