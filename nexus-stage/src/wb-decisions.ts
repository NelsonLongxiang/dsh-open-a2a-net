/**
 * The 团队 tab's 等你拍板 group (T8 deep link, workbench-market #898 decide_at): the decision cards this instance's teams
 * wait for, decided here as in the DSH right bar — the same route (GET / POST /__dsh_a2a/superagent/decisions) and the same
 * host checks. Whether the person is the owner is the host's call alone (requireBrowserOwner, decision cards C5): nothing
 * here guesses it, and a refusal is shown as the host gave it. A card decided elsewhere (the right bar) is gone from the
 * next read and is shown as handled; a press on it gets the host's `stale` and says so.
 *
 * The market links here with `/__dsh_a2a_nexus/?tab=team&view=decisions&card=<id>`: only those three parameters are read,
 * the card id must match the card id rule, and it is never put into markup or a request path — only compared.
 * Cards are attacker-shaped data (a router or observer wrote them): textContent only.
 * @module nexus-stage/wb-decisions
 */

type Json = Record<string, unknown>

/** The card id rule (host and market): what a deep link may name. */
export const CARD_ID = /^[A-Za-z0-9._:-]{1,64}$/
const SHA256 = /^[0-9a-f]{64}$/

export interface DecisionCard {
  readonly id: string; readonly teamId: string; readonly team: string; readonly question: string; readonly level: string
  readonly options: readonly string[]; readonly recommended: string; readonly reason?: string; readonly title?: string
  readonly files: ReadonlyArray<{ readonly sha256: string; readonly size: number; readonly name: string }>
}

export interface DecisionsDeps {
  /** GET /__dsh_a2a/superagent/decisions. */
  list(): Promise<Json>
  /** POST /__dsh_a2a/superagent/decisions: the host's answer, with the HTTP status. */
  decide(body: Json): Promise<{ status: number; body: Json }>
  /** GET a card's file (the owner's control route); resolves to a blob, or a reason it could not. */
  file?(href: string): Promise<Blob | string>
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
  const files = Array.isArray(r.files) ? r.files.flatMap(f => {
    const x = (f ?? {}) as Json
    return typeof x.sha256 === 'string' && SHA256.test(x.sha256) && typeof x.name === 'string' && typeof x.size === 'number' ? [{ sha256: x.sha256, size: x.size, name: x.name }] : []
  }) : []
  return {
    id: str(r.id), teamId: str(r.teamId), team: str(r.team), question: str(r.question), level: str(r.level) || 'P1', options, recommended: str(r.recommended),
    ...(typeof r.reason === 'string' && r.reason !== '' ? { reason: r.reason } : {}), ...(typeof r.title === 'string' && r.title !== '' ? { title: r.title } : {}), files,
  }
}

/** P2 and P3 with a recommendation can be approved with one click; P0 and P1 need an option chosen (the host enforces it too). */
export const oneClick = (card: DecisionCard): boolean => (card.level === 'P2' || card.level === 'P3') && card.recommended !== ''

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
  let wanted: string | undefined
  /** Per card: the person's pick and words, kept across redraws; and what the host last said about it. */
  const picks = new Map<string, string>()
  const notes = new Map<string, string>()
  const said = new Map<string, string>()
  const busy = new Set<string>()

  function cardNode(card: DecisionCard): HTMLElement {
    const node = el('div', 'wb-led-card wb-sa-decision-card')
    node.dataset.card = card.id
    const top = el('div', 'wb-sa-decision-head')
    top.append(el('span', 'wb-sa-level', card.level), el('span', 'wb-sa-decision-team', card.team !== '' ? `团队 ${card.team}` : ''))
    if (card.title !== undefined) top.append(el('span', 'wb-sa-decision-ticket', `工单「${card.title}」`))
    node.append(top, el('div', 'wb-sa-decision-question', card.question))
    if (card.reason !== undefined) node.append(el('div', 'wb-sa-hint', `理由：${card.reason}`))
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
    node.append(words, actions)
    const line = el('div', 'wb-sa-hint wb-sa-decision-said', said.get(card.id) ?? '')
    line.setAttribute('role', 'status')
    node.append(line)
    sync(card, node)
    return node
  }

  /** P0 and P1 need an option, or the decision written in words. */
  function sync(card: DecisionCard, node: HTMLElement): void {
    const confirm = node.querySelector<HTMLButtonElement>('.wb-sa-confirm')
    if (confirm === null) return
    const picked = (picks.get(card.id) ?? '') !== ''
    const words = (notes.get(card.id) ?? '').trim() !== ''
    confirm.disabled = busy.has(card.id) || !(picked || words)
  }

  async function send(card: DecisionCard, body: Json): Promise<void> {
    if (busy.has(card.id)) return
    busy.add(card.id)
    said.delete(card.id)
    draw(true)
    let out: { status: number; body: Json }
    try { out = await deps.decide({ id: card.id, ...(card.teamId !== '' ? { teamId: card.teamId } : {}), ...body }) } catch (error) { out = { status: 0, body: { error: String(error) } } }
    busy.delete(card.id)
    if (out.status >= 200 && out.status < 300 && out.body.ok === true) {
      picks.delete(card.id); notes.delete(card.id)
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

  function draw(force = false): void {
    const key = JSON.stringify([cards, [...said], [...busy]])
    if (!force && key === shown) return
    shown = key
    count.textContent = String(cards.length)
    list.replaceChildren(...cards.map(cardNode))
    if (cards.length === 0) list.append(el('div', 'wb-sa-hint', loaded ? '没有等你拍板的卡' : '正在读取…'))
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
        const rows = Array.isArray(out.decisions) ? out.decisions : []
        cards = rows.flatMap(row => { const card = cardOf(row); return card === undefined ? [] : [card] })
        loaded = true
        // A card decided elsewhere is gone: what was typed for it goes too.
        for (const id of [...picks.keys(), ...notes.keys(), ...said.keys()]) if (!cards.some(c => c.id === id)) { picks.delete(id); notes.delete(id); said.delete(id) }
      } catch { /* the next poll reads again */ }
      draw()
      place()
    })().finally(() => { reading = undefined })
    return reading
  }

  draw(true)
  return {
    root, refresh,
    focus(cardId: string) { if (!CARD_ID.test(cardId)) return; wanted = cardId; void refresh() },
    waiting: () => cards.length,
  }
}
