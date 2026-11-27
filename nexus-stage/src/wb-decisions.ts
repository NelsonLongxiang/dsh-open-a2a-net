/**
 * The 团队 tab's 等你拍板 group (T8 deep link, workbench-market #898 decide_at): the decision cards this instance's teams
 * wait for, decided here as in the DSH right bar — the same route (GET / POST /__dsh_a2a/superagent/decisions) and the same
 * host checks. Whether the person is the owner is the host's call alone (requireBrowserOwner, decision cards C5): nothing
 * here guesses it, and a refusal is shown as the host gave it. A card decided elsewhere (the right bar) is gone from the
 * next read and is shown as handled; a press on it gets the host's `stale` and says so.
 *
 * The market links here with `/__dsh_a2a_nexus/?tab=team&view=decisions&card=<id>`: only those three parameters are read,
 * the card id must match the card id rule, and it is never put into markup or a request path — only compared.
 * Only the router's and the observer's cards are listed — the same cards the host pushes to the market. A member's
 * question on a ticket is answered on its ticket card in 待你处理的工单, so it is neither shown nor counted twice — except
 * (#888 D4) one with an option that needs input: the host refuses a plain-text answer to it, so it is decided here.
 * Cards are attacker-shaped data (a router or observer wrote them): textContent only.
 * @module nexus-stage/wb-decisions
 */

type Json = Record<string, unknown>

/** The card id rule (host and market): what a deep link may name. */
export const CARD_ID = /^[A-Za-z0-9._:-]{1,64}$/
const SHA256 = /^[0-9a-f]{64}$/
/** The file channel's limits (src/blob-store.ts; the host's DECISION_FILES_MAX): files on one decision, bytes per file. */
export const ATTACH_MAX = 16, ATTACH_BYTES_MAX = 64 * 1024 * 1024
/**
 * How long a staged file is reused for a retried decision. The file channel keeps a grant 24 hours; a copy older than this
 * is staged again rather than sent as a reference that may expire before the team fetches it. The DSH right bar keeps the
 * same value in src/client/TeamDecisionsTab.tsx (this bundle imports nothing from src/); a test keeps the two equal.
 */
export const STAGE_REUSE_MS = 23 * 60 * 60_000

export interface DecisionCard {
  readonly id: string; readonly teamId: string; readonly team: string; readonly question: string; readonly level: string
  readonly options: readonly string[]; readonly recommended: string; readonly reason?: string; readonly title?: string
  readonly files: ReadonlyArray<{ readonly sha256: string; readonly size: number; readonly name: string }>
  /** The team's canvas address: the owner's files on a decision are granted to it (C8). */
  readonly address?: string
  /** #888 D1: per option, what the owner must fill in to choose it (read from the host, checked here as data). */
  readonly inputs: Readonly<Record<string, CardInput>>
  /** #888 D5: the host took the recommendation on the owner's setting; the owner may still decide it. */
  readonly autoApproved?: { readonly at: string; readonly minutes: number }
  readonly observerResult?: { generation: string; name: string; at: string; state: string; option: string; reason: string; canCorrect: boolean; correction?: string; controlOptions: string[] }
}

export interface CardInput { readonly kind: 'text' | 'file' | 'text+file'; readonly prompt: string }
const INPUT_KINDS = ['text', 'file', 'text+file']

/** #888 D1: what choosing `option` requires, if anything. */
export const inputOf = (card: DecisionCard, option: string): CardInput | undefined => Object.prototype.hasOwnProperty.call(card.inputs, option) ? card.inputs[option] : undefined
/** #888 D1: whether the recommended option needs input; such a card has no one-click approval. */
export const recommendedNeedsInput = (card: DecisionCard): boolean => card.recommended !== '' && inputOf(card, card.recommended) !== undefined
/** #888 D4: whether the owner's words and files satisfy the chosen option. */
export const inputMet = (card: DecisionCard, option: string, note: string, fileCount: number): boolean => {
  const need = inputOf(card, option)
  if (need === undefined) return true
  return (need.kind === 'file' || note.trim() !== '') && (need.kind === 'text' || fileCount > 0)
}

export interface DecisionsDeps {
  /** GET /__dsh_a2a/superagent/decisions. */
  list(): Promise<Json>
  /** POST /__dsh_a2a/superagent/decisions: the host's answer, with the HTTP status. */
  decide(body: Json): Promise<{ status: number; body: Json }>
  /** GET a card's file (the owner's control route); resolves to a blob, or a reason it could not. */
  file?(href: string): Promise<Blob | string>
  /**
   * Stage one of the owner's files on this host's file channel, granted to the team's canvas (C8): its `[A2A file] v1`
   * reference line, or why it could not. Absent, a decision carries no files.
   */
  stage?(file: File, address: string): Promise<{ ref: string } | { refused: string }>
}

/** The card a deep link names: only `tab=team`, `view=decisions` and a card id that fits the rule; anything else is ignored. */
export function decisionLink(search: string): string | undefined {
  let params: URLSearchParams
  try { params = new URLSearchParams(search) } catch { return undefined }
  const card = params.get('card') ?? ''
  return params.get('tab') === 'team' && params.get('view') === 'decisions' && CARD_ID.test(card) ? card : undefined
}

/** One row of the host's read, or undefined when it is not a card shape (records are data). */
export function cardOf(raw: unknown): DecisionCard | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as Json
  const str = (v: unknown): string => typeof v === 'string' ? v : ''
  const options = Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === 'string') : []
  if (str(r.id) === '' || str(r.question) === '' || options.length === 0) return undefined
  // Only entries for real options with a known kind and a text prompt; anything else is dropped (records are data).
  const inputs: Record<string, CardInput> = {}
  if (r.inputs !== null && typeof r.inputs === 'object' && !Array.isArray(r.inputs)) {
    for (const [key, value] of Object.entries(r.inputs as Json)) {
      const v = (value ?? {}) as Json
      if (options.includes(key) && typeof v.kind === 'string' && INPUT_KINDS.includes(v.kind) && typeof v.prompt === 'string' && v.prompt !== '') inputs[key] = { kind: v.kind as CardInput['kind'], prompt: v.prompt }
    }
  }
  const result = r.observerResult !== null && typeof r.observerResult === 'object' ? r.observerResult as Json : undefined
  const observerResult = result === undefined || typeof result.generation !== 'string' || typeof result.name !== 'string' || typeof result.at !== 'string' || typeof result.option !== 'string' ? undefined : {
    generation: result.generation, name: result.name, at: result.at, state: str(result.state), option: result.option, reason: str(result.reason), canCorrect: result.canCorrect === true,
    ...(typeof result.correction === 'string' ? { correction: result.correction } : {}),
    controlOptions: Array.isArray(result.controlOptions) ? result.controlOptions.filter((choice): choice is string => typeof choice === 'string' && options.includes(choice)) : [],
  }
  if (observerResult === undefined && r.source !== 'router' && r.source !== 'observer' && !(r.source === 'ticket' && Object.keys(inputs).length > 0)) return undefined
  const files = Array.isArray(r.files) ? r.files.flatMap(f => {
    const x = (f ?? {}) as Json
    return typeof x.sha256 === 'string' && SHA256.test(x.sha256) && typeof x.name === 'string' && typeof x.size === 'number' ? [{ sha256: x.sha256, size: x.size, name: x.name }] : []
  }) : []
  return {
    id: str(r.id), teamId: str(r.teamId), team: str(r.team), question: str(r.question), level: str(r.level) || 'P1', options, recommended: str(r.recommended),
    ...(typeof r.reason === 'string' && r.reason !== '' ? { reason: r.reason } : {}), ...(typeof r.title === 'string' && r.title !== '' ? { title: r.title } : {}), files,
    ...(typeof r.address === 'string' && r.address !== '' ? { address: r.address } : {}), inputs,
    ...(observerResult === undefined ? {} : { observerResult }),
    ...(r.autoApproved !== null && typeof r.autoApproved === 'object' && typeof (r.autoApproved as Json).at === 'string' && typeof (r.autoApproved as Json).minutes === 'number' ? { autoApproved: { at: (r.autoApproved as Json).at as string, minutes: (r.autoApproved as Json).minutes as number } } : {}),
  }
}

/** P2 and P3 with a recommendation can be approved with one click; P0 and P1 need an option chosen (the host enforces it too). */
export const oneClick = (card: DecisionCard): boolean => (card.level === 'P2' || card.level === 'P3') && card.recommended !== '' && !recommendedNeedsInput(card)

/** Where a card's file is fetched: every part encoded, the digest checked. */
export const fileHref = (card: DecisionCard, sha256: string): string =>
  `/__dsh_a2a/superagent/decisions/file?card=${encodeURIComponent(card.id)}&sha256=${encodeURIComponent(sha256)}${card.teamId !== '' ? `&teamId=${encodeURIComponent(card.teamId)}` : ''}`

/** What a refusal says to the person. */
export function refusalText(status: number, body: Json): string {
  if (body.code === 'stale') return '这张卡已经处理了（可能已在 DSH 右栏拍板），不能再提交'
  const error = typeof body.error === 'string' && body.error !== '' ? body.error : `HTTP ${String(status)}`
  return status === 401 || status === 403 ? `没有提交：只有在浏览器里登录的属主能拍板（${error}）` : `没有提交：${error}`
}

const sizeText = (bytes: number): string => bytes < 1024 ? `${String(bytes)} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export interface DecisionsGroup {
  /** The group, built once: it is re-parented into the 待你处理 view and keeps what the person typed. */
  readonly root: HTMLElement
  /** Read the cards again (single flight); the view redraws when they changed. */
  refresh(): Promise<void>
  /** A deep link named this card: show it, scrolled to and flashed, or say it is no longer waiting here. */
  focus(cardId: string): void
  /** How many cards wait (the rail badge). */
  waiting(): number
}

export function createDecisionsGroup(deps: DecisionsDeps): DecisionsGroup {
  const root = el('div', 'wb-led-group is-warn wb-sa-decisions')
  root.dataset.group = 'decisions'
  const head = el('div', 'wb-led-group-head')
  const count = el('span', 'wb-led-group-hint', '0')
  head.append(el('span', undefined, '等你拍板'), count)
  const notice = el('div', 'wb-sa-hint wb-sa-decisions-notice')
  notice.setAttribute('role', 'status')
  notice.hidden = true
  const list = el('div', 'wb-sa-decisions-list')
  root.append(head, notice, list)

  let cards: DecisionCard[] = []
  let shown = ''
  let loaded = false
  let reading: Promise<void> | undefined
  /** Why the last read failed; cleared by a read that works. */
  let failure = ''
  let wanted: string | undefined
  /** Per card: the person's pick and words, kept across redraws; and what the host last said about it. */
  const picks = new Map<string, string>()
  const notes = new Map<string, string>()
  const said = new Map<string, string>()
  const busy = new Set<string>()
  /** Per card: the owner's files picked for the decision, kept across redraws until it is sent or the card goes. */
  const attached = new Map<string, File[]>()
  /**
   * Per card: the reference of each file already staged for it. A decision the host refuses and the owner sends again
   * reuses them while they are younger than STAGE_REUSE_MS, so a refusal leaves at most one live staged copy of each file
   * (it expires with the file channel's 24 hours).
   */
  const staged = new Map<string, Map<File, { readonly ref: string; readonly at: number }>>()

  /**
   * Add picked or dropped files to a card's decision: at most 16, each at most 64 MB. The same file picked again (same
   * name, size and modification time) is kept once and the page says so; two different files that share a name and size
   * are both kept.
   */
  function attach(card: DecisionCard, added: readonly File[]): void {
    const tooBig = added.find(file => file.size > ATTACH_BYTES_MAX)
    if (tooBig !== undefined) { said.set(card.id, `「${tooBig.name}」超过 64 MB，文件通道收不下`); draw(true); return }
    const now = attached.get(card.id) ?? []
    const keyOf = (file: File): string => `${file.name}:${String(file.size)}:${String(file.lastModified)}`
    const known = new Set(now.map(keyOf))
    const next = [...now]
    const again: string[] = []
    for (const file of added) { const key = keyOf(file); if (known.has(key)) again.push(file.name); else { known.add(key); next.push(file) } }
    if (next.length > ATTACH_MAX) { said.set(card.id, `一个决定最多附 ${String(ATTACH_MAX)} 个文件`); draw(true); return }
    attached.set(card.id, next)
    if (again.length > 0) said.set(card.id, `已经附上过，没有重复添加：${again.join('、')}`); else said.delete(card.id)
    draw(true)
  }

  function cardNode(card: DecisionCard): HTMLElement {
    const node = el('div', 'wb-led-card wb-sa-decision-card')
    node.dataset.card = card.id
    const top = el('div', 'wb-sa-decision-head')
    top.append(el('span', 'wb-sa-level', card.level), el('span', 'wb-sa-decision-team', card.team !== '' ? `团队 ${card.team}` : ''))
    if (card.title !== undefined) top.append(el('span', 'wb-sa-decision-ticket', `工单「${card.title}」`))
    node.append(top, el('div', 'wb-sa-decision-question', card.question))
    if (card.reason !== undefined) node.append(el('div', 'wb-sa-hint', `理由：${card.reason}`))
    if (card.autoApproved !== undefined) node.append(el('div', 'wb-sa-hint wb-sa-auto-approved', `已自动采纳「${card.recommended}」：${String(card.autoApproved.minutes)} 分钟没人处理，宿主于 ${card.autoApproved.at} 按你的设置采纳（不是你本人的决定），仍可改判`))
    const options = el('div', 'wb-sa-decision-options')
    options.setAttribute('role', 'radiogroup')
    for (const option of card.options) {
      const label = el('label', option === card.recommended ? 'wb-sa-option is-recommended' : 'wb-sa-option')
      const input = el('input')
      input.type = 'radio'
      input.name = `decide-${card.id}`
      input.checked = picks.get(card.id) === option
      input.disabled = busy.has(card.id)
      input.addEventListener('change', () => { picks.set(card.id, option); sync(card, node) })
      label.append(input, el('span', undefined, option))
      if (option === card.recommended) label.append(el('span', 'wb-sa-badge', '推荐'))
      const need = inputOf(card, option)
      if (need !== undefined) label.append(el('span', 'wb-sa-badge is-input', '需你填写'), el('span', 'wb-sa-hint wb-sa-input-prompt', need.prompt))
      options.append(label)
    }
    node.append(options)
    for (const file of card.files) {
      const link = el('button', 'wb-btn wb-sa-file', `${file.name}（${sizeText(file.size)}）`)
      link.type = 'button'
      link.addEventListener('click', () => { void download(card, file) })
      node.append(link)
    }
    const words = el('textarea', 'wb-sa-input wb-sa-decision-note')
    words.setAttribute('aria-label', '说明（可不填）')
    words.placeholder = '说明（可不填；不选选项时写下你的决定）'
    words.value = notes.get(card.id) ?? ''
    words.disabled = busy.has(card.id)
    words.addEventListener('input', () => { notes.set(card.id, words.value); sync(card, node) })
    const actions = el('div', 'wb-sa-actions')
    if (oneClick(card)) {
      const approve = el('button', 'wb-btn is-primary wb-sa-approve', `同意推荐：${card.recommended}`)
      approve.type = 'button'
      approve.disabled = busy.has(card.id)
      approve.addEventListener('click', () => { void send(card, { how: 'approve' }) })
      actions.append(approve)
    }
    const confirm = el('button', 'wb-btn wb-sa-confirm', '确认这个决定')
    confirm.type = 'button'
    confirm.addEventListener('click', () => {
      const option = picks.get(card.id) ?? ''
      const note = (notes.get(card.id) ?? '').trim()
      void send(card, { how: 'choose', ...(option !== '' ? { option } : {}), ...(note !== '' ? { note } : {}) })
    })
    actions.append(confirm)
    node.append(words)
    if (deps.stage !== undefined) node.append(attachRow(card, node))
    node.append(actions)
    const why = el('div', 'wb-sa-hint wb-sa-input-why')
    why.hidden = true
    node.append(why)
    const line = el('div', 'wb-sa-hint wb-sa-decision-said', said.get(card.id) ?? '')
    line.setAttribute('role', 'status')
    node.append(line)
    sync(card, node)
    return node
  }

  /** The owner's files for this decision: picked with the button or dropped on the card; each one listed and removable. */
  function attachRow(card: DecisionCard, node: HTMLElement): HTMLElement {
    const row = el('div', 'wb-sa-attach')
    const picker = el('input')
    picker.type = 'file'
    picker.multiple = true
    picker.hidden = true
    picker.addEventListener('change', () => { attach(card, Array.from(picker.files ?? [])); picker.value = '' })
    const add = el('button', 'wb-btn wb-sa-attach-add', '附上文件')
    add.type = 'button'
    add.disabled = busy.has(card.id)
    add.addEventListener('click', () => { picker.click() })
    row.append(picker, add)
    for (const file of attached.get(card.id) ?? []) {
      const chip = el('span', 'wb-sa-attach-file')
      chip.append(el('span', undefined, `${file.name}（${sizeText(file.size)}）`))
      const drop = el('button', 'wb-btn wb-sa-attach-remove', '移除')
      drop.type = 'button'
      drop.disabled = busy.has(card.id)
      drop.setAttribute('aria-label', `移除 ${file.name}`)
      drop.addEventListener('click', () => { attached.set(card.id, (attached.get(card.id) ?? []).filter(f => f !== file)); draw(true) })
      chip.append(drop)
      row.append(chip)
    }
    // Only a drag of files is taken; dragging selected text stays the browser's.
    const files = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files')
    node.addEventListener('dragover', event => { if (!files(event) || busy.has(card.id)) return; event.preventDefault(); node.classList.add('is-dragging') })
    node.addEventListener('dragleave', () => { node.classList.remove('is-dragging') })
    node.addEventListener('drop', event => { if (!files(event)) return; event.preventDefault(); node.classList.remove('is-dragging'); if (!busy.has(card.id)) attach(card, Array.from(event.dataTransfer?.files ?? [])) })
    return row
  }

  /** P0 and P1 need an option, or the decision written in words. */
  function sync(card: DecisionCard, node: HTMLElement): void {
    const confirm = node.querySelector<HTMLButtonElement>('.wb-sa-confirm')
    if (confirm === null) return
    const option = picks.get(card.id) ?? ''
    const picked = option !== ''
    const words = (notes.get(card.id) ?? '').trim() !== ''
    // #888 D4: an option that needs input waits for it. A file it needs cannot come without a canvas or a file channel: say
    // why (without a file channel nothing can be attached; with files and no canvas, send() refuses with the same reason).
    const need = picked ? inputOf(card, option) : undefined
    const unreachable = need !== undefined && need.kind !== 'text' && (card.address === undefined || deps.stage === undefined)
    const why = node.querySelector<HTMLElement>('.wb-sa-input-why')
    if (why !== null) { why.hidden = !unreachable; why.textContent = unreachable ? '这个选项要附文件，但这里附不了（团队没有画布地址或主机不能附带文件）' : '' }
    confirm.disabled = busy.has(card.id) || !(picked || words) || (picked && !inputMet(card, option, notes.get(card.id) ?? '', (attached.get(card.id) ?? []).length))
  }

  async function send(card: DecisionCard, body: Json): Promise<void> {
    if (busy.has(card.id)) return
    busy.add(card.id)
    said.delete(card.id)
    draw(true)
    // The owner's files go with the decision as reference lines, staged to the team's canvas first (C8), like the right bar.
    const files = attached.get(card.id) ?? []
    const refs: string[] = []
    if (files.length > 0) {
      const refused = card.address === undefined ? '这张卡没有团队地址，不能附带文件' : deps.stage === undefined ? '这台主机不能附带文件' : undefined
      if (refused !== undefined) { busy.delete(card.id); said.set(card.id, `没有提交：${refused}`); draw(true); return }
      const done = staged.get(card.id) ?? new Map<File, { readonly ref: string; readonly at: number }>()
      staged.set(card.id, done)
      for (const file of files) {
        const already = done.get(file)
        if (already !== undefined && Date.now() - already.at < STAGE_REUSE_MS) { refs.push(already.ref); continue }
        let out: { ref: string } | { refused: string }
        try { out = await deps.stage!(file, card.address!) } catch (error) { out = { refused: String(error) } }
        if ('refused' in out) { busy.delete(card.id); said.set(card.id, `没有提交：文件「${file.name}」没有附上（${out.refused}）`); draw(true); return }
        done.set(file, { ref: out.ref, at: Date.now() })
        refs.push(out.ref)
      }
    }
    let out: { status: number; body: Json }
    try { out = await deps.decide({ id: card.id, ...(card.teamId !== '' ? { teamId: card.teamId } : {}), ...body, ...(refs.length > 0 ? { files: refs } : {}) }) } catch (error) { out = { status: 0, body: { error: String(error) } } }
    busy.delete(card.id)
    if (out.status >= 200 && out.status < 300 && out.body.ok === true) {
      picks.delete(card.id); notes.delete(card.id); attached.delete(card.id); staged.delete(card.id)
      notice.textContent = '已提交，团队会收到你的决定'
      notice.hidden = false
    } else if (out.body.code === 'stale') {
      // Decided elsewhere: the next read drops the card, so the word goes where it stays.
      notice.textContent = refusalText(out.status, out.body)
      notice.hidden = false
    } else said.set(card.id, refusalText(out.status, out.body))
    draw(true)
    await refresh()
  }

  async function download(card: DecisionCard, file: { sha256: string; name: string }): Promise<void> {
    if (deps.file === undefined) return
    const got = await deps.file(fileHref(card, file.sha256)).catch((error: unknown) => String(error))
    if (typeof got === 'string') { said.set(card.id, `文件没有下载：${got}`); draw(true); return }
    const url = URL.createObjectURL(got)
    const a = el('a')
    a.href = url
    a.download = file.name
    a.click()
    setTimeout(() => { URL.revokeObjectURL(url) }, 10_000)
  }

  function observerResultNode(card: DecisionCard): HTMLElement {
    const result = card.observerResult!
    const node = el('div', 'wb-sa-decision')
    node.dataset.card = card.id
    const state = new Map([['pending', '待处理'], ['attempting', '执行中'], ['applied', '已应用'], ['failed', '未应用'], ['unknown', '结果未知']]).get(result.state) ?? '状态未知'
    node.append(el('div', 'wb-sa-question', card.question), el('div', 'wb-sa-hint', '观察者代决 · ' + result.name + ' · ' + result.at + ' · ' + result.option + ' · ' + state))
    if (result.reason !== '') node.append(el('div', 'wb-sa-hint', result.reason))
    if (result.correction !== undefined) node.append(el('div', 'wb-sa-hint', '属主改判：' + result.correction))
    if (result.canCorrect) {
      const choices = el('select', 'wb-sa-select')
      choices.setAttribute('aria-label', '选择改判选项')
      for (const choice of card.options.filter(option => option !== result.option)) choices.append(el('option', undefined, choice))
      const correct = el('button', 'wb-btn', '记录改判，不撤回原动作')
      correct.disabled = busy.has(card.id) || choices.options.length === 0
      correct.addEventListener('click', () => { void send(card, { how: 'observer-correct', generation: result.generation, option: choices.value }) })
      node.append(choices, correct)
    }
    for (const choice of result.controlOptions) {
      const control = el('button', 'wb-btn', choice)
      control.disabled = busy.has(card.id)
      control.addEventListener('click', () => { void send(card, { how: 'credential-control', generation: result.generation, option: choice }) })
      node.append(control)
    }
    const status = said.get(card.id)
    if (status !== undefined) node.append(el('div', 'wb-sa-hint', status))
    return node
  }

  function draw(force = false): void {
    const key = JSON.stringify([cards, [...said], [...busy], failure, loaded, [...attached].map(([id, fs]) => [id, fs.map(f => `${f.name}:${String(f.size)}`)])])
    if (!force && key === shown) return
    shown = key
    // #888 D4: split by whether the recommendation needs input, when any card has inputs.
    // #888 D5: cards the host already took are shown but not counted as waiting.
    const open = cards.filter(card => card.autoApproved === undefined && card.observerResult === undefined)
    const fill = open.filter(recommendedNeedsInput).length
    count.textContent = open.some(c => Object.keys(c.inputs).length > 0) ? `${String(open.length)}（需填写 ${String(fill)} · 可直接定 ${String(open.length - fill)}）` : String(open.length)
    list.replaceChildren(...cards.map(card => card.observerResult === undefined ? cardNode(card) : observerResultNode(card)))
    if (failure !== '') list.append(el('div', 'wb-sa-hint wb-sa-decisions-failed', `${loaded ? '刷新失败，下面是上次读到的卡' : '读不到等你拍板的卡'}：${failure}（下次轮询会再试）`))
    if (cards.length === 0 && failure === '') list.append(el('div', 'wb-sa-hint', loaded ? '没有等你拍板的卡' : '正在读取…'))
  }

  /** The deep-linked card: scrolled to and flashed once it is here; once the cards are read and it is not, say so. */
  function place(): void {
    if (wanted === undefined || !loaded) return
    const id = wanted
    wanted = undefined
    const node = Array.from(list.querySelectorAll<HTMLElement>('[data-card]')).find(n => n.dataset.card === id)
    if (node === undefined) { notice.textContent = '这张卡已经处理了，或者不在这台机器上'; notice.hidden = false; return }
    notice.hidden = true
    node.scrollIntoView?.({ block: 'center' })
    node.classList.add('is-flash')
    setTimeout(() => { node.classList.remove('is-flash') }, 1600)
  }

  async function refresh(): Promise<void> {
    if (reading !== undefined) return reading
    reading = (async () => {
      try {
        const out = await deps.list()
        const rows = [...(Array.isArray(out.decisions) ? out.decisions : []), ...(Array.isArray(out.observerDecisions) ? out.observerDecisions : [])]
        cards = rows.flatMap(row => { const card = cardOf(row); return card === undefined ? [] : [card] })
        loaded = true
        // A card decided elsewhere is gone: what was typed for it goes too.
        for (const id of [...picks.keys(), ...notes.keys(), ...said.keys(), ...attached.keys()]) if (!cards.some(c => c.id === id)) { picks.delete(id); notes.delete(id); said.delete(id); attached.delete(id); staged.delete(id) }
        failure = ''
      } catch (error) { failure = error instanceof Error ? error.message : String(error) }
      draw()
      place()
    })().finally(() => { reading = undefined })
    return reading
  }

  draw(true)
  return {
    root, refresh,
    focus(cardId: string) { if (!CARD_ID.test(cardId)) return; wanted = cardId; void refresh() },
    // #888 D5: a card the host already took is shown for a day but is not waiting.
    waiting: () => cards.filter(card => card.autoApproved === undefined && card.observerResult === undefined).length,
  }
}
