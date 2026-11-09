/**
 * The 团队 tab's settings that are lists rather than switches: rules, the A2A sender list, each member's repository, who
 * counts as a person on a pull request, and the review address. `patch()` returns only what the owner changed, so a save
 * never rewrites a field left alone. The host validates again; the checks here only say what is wrong in the owner's terms.
 * @module nexus-stage/wb-superagent-settings
 */

export interface TeamRule { readonly name: string; readonly text: string; readonly enabled: boolean }

/** The part of the team's settings these fields edit. */
export interface TeamFieldValues {
  readonly rules?: readonly TeamRule[]
  readonly bots?: { readonly a2a?: readonly string[] }
  readonly allowed?: { readonly github?: readonly string[] }
  readonly reviewer?: string
  readonly repos?: Readonly<Record<string, string>>
  readonly members: readonly string[]
  readonly remoteMembers: ReadonlyArray<{ readonly ref: string }>
}

export interface TeamFields {
  readonly nodes: readonly HTMLElement[]
  patch(): { patch: Record<string, unknown> } | { error: string }
}

const RULE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
const REPO = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/ // the host's REPO_RE
const RULE_TEXT_MAX = 2_000
const RULES_MAX = 32

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const linesOf = (text: string): string[] => [...new Set(text.split(/[\s,，]+/).filter(item => item !== ''))]
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export function buildTeamFields(s: TeamFieldValues, memberName: (id: string) => string, mark: () => void): TeamFields {
  const section = (title: string, hint: string): HTMLElement => {
    const box = el('div', 'wb-sa-section')
    box.append(el('div', 'wb-sa-section-title', title), el('div', 'wb-sa-hint', hint))
    return box
  }
  const input = (label: string, value: string, placeholder = ''): HTMLInputElement => {
    const box = el('input', 'wb-sa-input'); box.type = 'text'; box.value = value; box.placeholder = placeholder
    box.setAttribute('aria-label', label); box.addEventListener('input', mark)
    return box
  }
  const area = (label: string, value: string, rows: number, placeholder = ''): HTMLTextAreaElement => {
    const box = el('textarea', 'wb-sa-input'); box.rows = rows; box.value = value; box.placeholder = placeholder
    box.setAttribute('aria-label', label); box.addEventListener('input', mark)
    return box
  }

  // ── rules ──
  const rulesBox = section('接单规则', '机器发来的请求，总工按这些规则判断接不接。接单模式是「自动」时，命中启用的规则才开工单；你在工作台提的需求不看规则。')
  const list = el('div', 'wb-sa-rules')
  const rows: Array<{ name: HTMLInputElement; text: HTMLTextAreaElement; enabled: HTMLInputElement; row: HTMLElement }> = []
  const addRow = (rule?: TeamRule): void => {
    const row = el('div', 'wb-sa-rule')
    const head = el('div', 'wb-sa-rule-head')
    const name = input('规则名称', rule?.name ?? '', '名称（小写字母、数字、短横线，可留空）')
    const check = el('label', 'wb-sa-check')
    const enabled = el('input', ''); enabled.type = 'checkbox'; enabled.checked = rule?.enabled ?? true
    enabled.setAttribute('aria-label', '启用规则'); enabled.addEventListener('change', mark)
    check.append(enabled, el('span', '', '启用'))
    const remove = el('button', 'wb-btn', '删除'); remove.type = 'button'
    const text = area('规则内容', rule?.text ?? '', 3, '什么样的请求可以接，比如：以 [ops] 开头、要求核对某份文档对外声明的请求。')
    const entry = { name, text, enabled, row }
    remove.addEventListener('click', () => { mark(); row.remove(); rows.splice(rows.indexOf(entry), 1) })
    head.append(name, check, remove)
    row.append(head, text)
    rows.push(entry)
    list.appendChild(row)
  }
  for (const rule of s.rules ?? []) addRow(rule)
  const add = el('button', 'wb-btn', '添加规则'); add.type = 'button'
  add.addEventListener('click', () => { mark(); addRow() })
  rulesBox.append(list, add)

  // ── senders, repositories, people, review ──
  const botsBox = section('允许发需求的机器', 'A2A 来源打开后，只有这里列出的身份发来的请求才会交给总工。一行一个，写法是 名字/16 位十六进制。')
  const bots = area('允许发需求的机器', (s.bots?.a2a ?? []).join('\n'), 3)
  botsBox.appendChild(bots)

  const repoBox = section('成员的仓库', '填了仓库后，总工接单时写明仓库，工单只派给这个仓库的成员。格式 owner/name，留空表示不限。')
  const memberIds = [...s.members, ...s.remoteMembers.map(m => m.ref)]
  const repoInputs = memberIds.map(id => {
    const row = el('label', 'wb-sa-field')
    const box = input(`${memberName(id)} 的仓库`, s.repos?.[id] ?? '', 'owner/name')
    row.append(el('span', 'wb-kv-k', memberName(id)), box)
    repoBox.appendChild(row)
    return { id, box }
  })
  if (memberIds.length === 0) repoBox.appendChild(el('div', 'wb-sa-hint', '（团队里还没有成员）'))

  const githubBox = section('PR 上算人的 GitHub 账号', '工单跟随的 PR 上，这些账号的评论算人写的，其他账号只作参考。一行一个。')
  const github = area('PR 上算人的 GitHub 账号', (s.allowed?.github ?? []).join('\n'), 2)
  githubBox.appendChild(github)

  const reviewBox = section('送审地址', '填了之后，工单开的 PR 会在每个新提交上发一次评审请求，结论只供合并的人参考。必须是已建链的 A2A 地址，留空表示不送审。')
  const reviewer = input('送审地址', s.reviewer ?? '', 'dsh/xxxxxxxx')
  reviewBox.appendChild(reviewer)

  function patch(): { patch: Record<string, unknown> } | { error: string } {
    const out: Record<string, unknown> = {}
    if (rows.length > RULES_MAX) return { error: `规则最多 ${String(RULES_MAX)} 条` }
    const taken = new Set(rows.map(r => r.name.value.trim()).filter(name => name !== ''))
    let next = 1
    const rules: TeamRule[] = []
    for (const r of rows) {
      let name = r.name.value.trim()
      if (name === '') { while (taken.has(`rule-${String(next)}`)) next++; name = `rule-${String(next)}`; taken.add(name) }
      if (!RULE_NAME.test(name)) return { error: `规则名称「${name}」只能用小写字母、数字和短横线，并以字母或数字开头` }
      if (rules.some(rule => rule.name === name)) return { error: `规则名称「${name}」重复了` }
      const text = r.text.value.trim()
      if (text === '') return { error: `规则「${name}」还没有写内容` }
      if (text.length > RULE_TEXT_MAX) return { error: `规则「${name}」超过 ${String(RULE_TEXT_MAX)} 字` }
      rules.push({ name, text, enabled: r.enabled.checked })
    }
    if (!same(rules, s.rules ?? [])) out.rules = rules

    const botList = linesOf(bots.value)
    if (!same(botList, s.bots?.a2a ?? [])) out.bots = { a2a: botList }

    const repos: Record<string, string> = {}
    for (const { id, box } of repoInputs) {
      const repo = box.value.trim()
      if (repo === '') continue
      if (!REPO.test(repo)) return { error: `「${memberName(id)}」的仓库要写成 owner/name` }
      repos[id] = repo
    }
    const before = Object.fromEntries(Object.entries(s.repos ?? {}).sort(([a], [b]) => a.localeCompare(b)))
    const after = Object.fromEntries(Object.entries(repos).sort(([a], [b]) => a.localeCompare(b)))
    if (!same(after, before)) out.repos = repos

    const githubList = linesOf(github.value)
    if (!same(githubList, s.allowed?.github ?? [])) out.allowed = { github: githubList }

    const address = reviewer.value.trim()
    if (address !== (s.reviewer ?? '')) out.reviewer = address === '' ? null : address
    return { patch: out }
  }
  return { nodes: [rulesBox, botsBox, repoBox, githubBox, reviewBox], patch }
}
