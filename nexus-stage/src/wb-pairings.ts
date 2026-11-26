/**
 * #933: the team tab's terminal-pairing banner. A terminal ran `a2a-net user pair` against this node; the owner checks the
 * code the terminal shows and allows or refuses it here. Allowing needs the owner's own browser login — the host judges
 * that, an owner delegate cannot. Every text from the host is shown as text.
 * @module
 */
type Json = Record<string, unknown>

export interface PairingRow { readonly id: string; readonly code: string; readonly name: string; readonly days: number; readonly expiresAt: string; readonly state: string }

export interface PairingsDeps {
  /** GET /__dsh_a2a/owner-delegates (its `pairings`). */
  list(): Promise<Json>
  /** POST /__dsh_a2a/owner-delegates with pair-approve or pair-deny: the host's answer, with the HTTP status. */
  act(body: Json): Promise<{ status: number; body: Json }>
}

export interface PairingsBanner {
  readonly root: HTMLElement
  refresh(): Promise<void>
  /** How many pairings wait for the owner. */
  waiting(): number
}

const CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

/** A pairing as the host listed it, or undefined when a field is missing or odd (it is then not shown). */
export function pairingOf(raw: unknown): PairingRow | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const r = raw as Json
  if (typeof r.id !== 'string' || r.id === '' || r.id.length > 64 || typeof r.code !== 'string' || !CODE.test(r.code)) return undefined
  if (typeof r.name !== 'string' || typeof r.days !== 'number' || typeof r.expiresAt !== 'string' || typeof r.state !== 'string') return undefined
  return { id: r.id, code: r.code, name: r.name, days: r.days, expiresAt: r.expiresAt, state: r.state }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function createPairingsBanner(deps: PairingsDeps): PairingsBanner {
  const root = el('div', 'wb-led-group is-warn wb-sa-pairings')
  root.dataset.group = 'pairings'
  root.hidden = true
  const head = el('div', 'wb-led-group-head')
  head.append(el('span', undefined, '终端配对请求'))
  const hint = el('div', 'wb-sa-hint', '只在你自己的终端里运行了 a2a-net user pair、且终端上显示的短码与这里一致时才允许；允许后该终端获得这台节点的属主代理凭据。')
  const list = el('div', 'wb-sa-pairings-list')
  root.append(head, hint, list)
  let rows: PairingRow[] = []
  const said = new Map<string, string>()
  const busy = new Set<string>()
  let reading: Promise<void> | undefined

  function draw(): void {
    list.replaceChildren()
    const waiting = rows.filter(r => r.state === 'waiting')
    root.hidden = waiting.length === 0 && said.size === 0
    for (const r of waiting) {
      const card = el('div', 'wb-sa-pairing')
      card.dataset.pairing = r.id
      card.append(el('div', 'wb-sa-pairing-title', `终端配对请求：${r.name}`), el('div', 'wb-sa-pairing-code', `短码 ${r.code}`), el('div', 'wb-sa-hint', `有效 ${String(r.days)} 天的凭据 · 请求在 ${r.expiresAt} 前有效`))
      const allow = el('button', 'wb-btn', '允许')
      const deny = el('button', 'wb-btn is-ghost', '拒绝')
      allow.type = 'button'; deny.type = 'button'
      allow.disabled = deny.disabled = busy.has(r.id)
      allow.addEventListener('click', () => { void answer(r, 'pair-approve') })
      deny.addEventListener('click', () => { void answer(r, 'pair-deny') })
      const note = said.get(r.id)
      card.append(el('div', 'wb-sa-pairing-actions'))
      card.lastElementChild!.append(allow, deny)
      if (note !== undefined) card.append(el('div', 'wb-sa-hint', note))
      list.append(card)
    }
    for (const [id, note] of said) if (!waiting.some(r => r.id === id)) list.append(el('div', 'wb-sa-hint', note))
  }

  async function answer(r: PairingRow, action: 'pair-approve' | 'pair-deny'): Promise<void> {
    if (busy.has(r.id)) return
    busy.add(r.id); draw()
    try {
      const out = await deps.act({ action, id: r.id })
      const ok = out.status === 200 && out.body.ok === true
      said.set(r.id, ok
        ? (action === 'pair-approve' ? `已允许「${r.name}」（短码 ${r.code}）：终端会自行取走凭据。` : `已拒绝「${r.name}」（短码 ${r.code}）。`)
        : `没有办成：${out.status === 401 || out.status === 403 ? '需要你在这台节点的浏览器里登录后再试' : String(out.body.error ?? `HTTP ${String(out.status)}`)}`)
    } catch (error) {
      said.set(r.id, `没有办成：${String((error as Error).message ?? error)}`)
    } finally { busy.delete(r.id) }
    await refresh()
  }

  async function refresh(): Promise<void> {
    if (reading !== undefined) return reading
    reading = (async () => {
      try {
        const body = await deps.list()
        rows = Array.isArray(body.pairings) ? body.pairings.map(pairingOf).filter((p): p is PairingRow => p !== undefined) : []
      } catch { /* keep what is shown; the next tick reads again */ }
      draw()
    })().finally(() => { reading = undefined })
    return reading
  }

  return { root, refresh, waiting: () => rows.filter(r => r.state === 'waiting').length }
}
