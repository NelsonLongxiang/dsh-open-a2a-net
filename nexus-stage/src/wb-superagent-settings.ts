/**
 * The 团队 tab's settings that are lists rather than switches: rules, dispatch rules, each member's role and rules, the A2A
 * sender list, each member's repository, who counts as a person on a pull request, and the review address. `patch()` returns only what the owner changed, so a save
 * never rewrites a field left alone. The host validates again; the checks here only say what is wrong in the owner's terms.
 * @module nexus-stage/wb-superagent-settings
 */

export interface TeamRule { readonly name: string; readonly text: string; readonly enabled: boolean }

/** The part of the team's settings these fields edit. */
export interface TeamFieldValues {
  readonly rules?: readonly TeamRule[]
  readonly bots?: { readonly a2a?: readonly string[] }
  readonly allowed?: { readonly github?: readonly string[] }
  /** GitHub issues as requests (design github-issues). */
  readonly github?: { readonly repos: readonly string[]; readonly intake: 'mention' | 'all' }
  readonly sources?: { readonly workbench?: boolean; readonly a2a?: boolean; readonly github?: boolean }
  readonly reviewer?: string
  readonly repos?: Readonly<Record<string, string>>
  readonly profiles?: Readonly<Record<string, { readonly role?: string; readonly rules: readonly TeamRule[] }>>
  readonly prepare?: { readonly command: string; readonly timeoutMs: number }
  readonly maxConcurrent?: number
  readonly dispatch?: string
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
const ROLE_MAX = 200

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const linesOf = (text: string): string[] => [...new Set(text.split(/[\s,，]+/).filter(item => item !== ''))]
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export function buildTeamFields(s: TeamFieldValues, memberName: (id: string) => string, mark: () => void, syncGithub?: () => void): TeamFields {
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

  /** An editable list of rules; `read` validates and returns them, or says what is wrong. */
  const ruleList = (initial: readonly TeamRule[], where: string): { node: HTMLElement; read(): readonly TeamRule[] | string } => {
    const node = el('div', 'wb-sa-rules')
    const list = el('div', 'wb-sa-rules')
    const rows: Array<{ name: HTMLInputElement; text: HTMLTextAreaElement; enabled: HTMLInputElement }> = []
    const addRow = (rule?: TeamRule): void => {
      const row = el('div', 'wb-sa-rule')
      const head = el('div', 'wb-sa-rule-head')
      const name = input(`${where}规则名称`, rule?.name ?? '', '名称（小写字母、数字、短横线，可留空）')
      const check = el('label', 'wb-sa-check')
      const enabled = el('input', ''); enabled.type = 'checkbox'; enabled.checked = rule?.enabled ?? true
      enabled.setAttribute('aria-label', `${where}启用规则`); enabled.addEventListener('change', mark)
      check.append(enabled, el('span', '', '启用'))
      const remove = el('button', 'wb-btn', '删除'); remove.type = 'button'
      const text = area(`${where}规则内容`, rule?.text ?? '', 3, '什么样的请求可以接，比如：以 [ops] 开头、要求核对某份文档对外声明的请求。')
      const entry = { name, text, enabled }
      remove.addEventListener('click', () => { mark(); row.remove(); rows.splice(rows.indexOf(entry), 1) })
      head.append(name, check, remove)
      row.append(head, text)
      rows.push(entry)
      list.appendChild(row)
    }
    for (const rule of initial) addRow(rule)
    const add = el('button', 'wb-btn', '添加规则'); add.type = 'button'
    add.addEventListener('click', () => { mark(); addRow() })
    node.append(list, add)
    const read = (): readonly TeamRule[] | string => {
      if (rows.length > RULES_MAX) return `规则最多 ${String(RULES_MAX)} 条`
      const taken = new Set(rows.map(r => r.name.value.trim()).filter(name => name !== ''))
      let next = 1
      const rules: TeamRule[] = []
      for (const r of rows) {
        let name = r.name.value.trim()
        if (name === '') { while (taken.has(`rule-${String(next)}`)) next++; name = `rule-${String(next)}`; taken.add(name) }
        if (!RULE_NAME.test(name)) return `规则名称「${name}」只能用小写字母、数字和短横线，并以字母或数字开头`
        if (rules.some(rule => rule.name === name)) return `规则名称「${name}」重复了`
        const text = r.text.value.trim()
        if (text === '') return `规则「${name}」还没有写内容`
        if (text.length > RULE_TEXT_MAX) return `规则「${name}」超过 ${String(RULE_TEXT_MAX)} 字`
        rules.push({ name, text, enabled: r.enabled.checked })
      }
      return rules
    }
    return { node, read }
  }

  // ── rules ──
  const rulesBox = section('接单规则', '机器发来的请求，总工按这些规则判断接不接。接单模式是「自动」时，命中启用的规则才开工单；你在工作台提的需求不看规则。')
  const teamRules = ruleList(s.rules ?? [], '')
  rulesBox.appendChild(teamRules.node)

  const dispatchBox = section('派单规则', '总工按这里的说明，结合每个成员的角色和规则，决定工单交给谁。')
  const dispatch = area('派单规则', s.dispatch ?? '', 3, '比如：日本站相关的工单优先给负责亚马逊日本站的成员。')
  dispatchBox.appendChild(dispatch)

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

  const profilesBox = section('成员的角色和规则', '总工按角色和规则派单。这里可以直接改，也可以在对话里让成员自己提议，你同意后生效。')
  const profiles = memberIds.map(id => {
    const profile = s.profiles?.[id]
    const row = el('div', 'wb-sa-rule')
    const role = input(`${memberName(id)} 的角色`, profile?.role ?? '', '一句话：这个成员负责什么')
    const rules = ruleList(profile?.rules ?? [], `${memberName(id)} `)
    row.append(el('div', 'wb-sa-section-title', memberName(id)), role, rules.node)
    profilesBox.appendChild(row)
    return { id, role, rules }
  })

  const githubBox = section('GitHub', '下面这些账号算人：工单跟随的 PR 上他们的评论、列出的仓库里他们开的 Issue。打开 Issue 接收后，点名 @superagent 或打 superagent 标签的新 Issue 会作为需求交给总工，回复写回 Issue。这一块的修改需要在已登录的界面里保存。')
  const issuesOn = el('input', '') as HTMLInputElement; issuesOn.type = 'checkbox'; issuesOn.checked = s.sources?.github === true
  issuesOn.setAttribute('aria-label', '接收 GitHub Issue 作为需求'); issuesOn.addEventListener('change', mark)
  const onRow = el('label', 'wb-sa-hint'); onRow.append(issuesOn, document.createTextNode(' 接收 GitHub Issue 作为需求'))
  const issueRepos = area('接收 Issue 的仓库', (s.github?.repos ?? []).join('\n'), 2, '一行一个 owner/name，最多 10 个')
  const intake = el('select', 'wb-sa-input') as HTMLSelectElement; intake.setAttribute('aria-label', '哪些 Issue 算需求')
  for (const [value, text] of [['mention', '只收点名 @superagent 或打 superagent 标签的'], ['all', '仓库里所有新 Issue']] as const) { const option = el('option', '', text); option.value = value; intake.appendChild(option) }
  intake.value = s.github?.intake ?? 'mention'; intake.addEventListener('change', mark)
  const github = area('算人的 GitHub 账号', (s.allowed?.github ?? []).join('\n'), 2)
  githubBox.append(onRow, issueRepos, intake, github)
  if (syncGithub !== undefined) {
    const sync = el('button', 'wb-btn', '从仓库协作者同步账号'); sync.type = 'button'
    sync.addEventListener('click', syncGithub)
    githubBox.append(sync, el('div', 'wb-sa-hint', '把上面仓库里有推送权限的协作者加进账号名单，只加不删。先保存仓库再同步。'))
  }

  const execBox = section('执行', '准备命令在成员拿到工单前，在成员的工作区里用 sh 跑一次，可用变量 $SUPERAGENT_TICKET_ID、$SUPERAGENT_TICKET_NAME、$SUPERAGENT_REPO、$SUPERAGENT_MEMBER。它以本机用户身份运行，不在沙箱里，保存需要界面登录。上限为 0 表示不限，每个成员同时只接一张。')
  const prepareBox = area('准备命令', s.prepare?.command ?? '', 3, '例如：git worktree add .worktrees/$SUPERAGENT_TICKET_NAME')
  const capBox = input('同时进行的工单上限', String(s.maxConcurrent ?? 0), '0')
  execBox.append(prepareBox, capBox)

  const reviewBox = section('送审地址', '填了之后，工单开的 PR 会在每个新提交上发一次评审请求，结论只供合并的人参考。必须是已建链的 A2A 地址，留空表示不送审。')
  const reviewer = input('送审地址', s.reviewer ?? '', 'dsh/xxxxxxxx')
  reviewBox.appendChild(reviewer)

  function patch(): { patch: Record<string, unknown> } | { error: string } {
    const out: Record<string, unknown> = {}
    const rules = teamRules.read()
    if (typeof rules === 'string') return { error: rules }
    if (!same(rules, s.rules ?? [])) out.rules = rules

    const dispatchText = dispatch.value.trim()
    if (dispatchText !== (s.dispatch ?? '')) out.dispatch = dispatchText

    const nextProfiles: Record<string, { role?: string; rules: readonly TeamRule[] }> = {}
    for (const { id, role, rules: list } of profiles) {
      const memberRules = list.read()
      if (typeof memberRules === 'string') return { error: `${memberName(id)}：${memberRules}` }
      const text = role.value.trim()
      if (text.length > ROLE_MAX) return { error: `${memberName(id)} 的角色超过 ${String(ROLE_MAX)} 字` }
      if (text === '' && memberRules.length === 0) continue
      nextProfiles[id] = { ...(text !== '' ? { role: text } : {}), rules: memberRules }
    }
    const sorted = (value: Readonly<Record<string, unknown>>): unknown => Object.fromEntries(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)))
    if (!same(sorted(nextProfiles), sorted(s.profiles ?? {}))) out.profiles = nextProfiles

    const command = prepareBox.value.trim()
    if (command !== (s.prepare?.command ?? '')) out.prepare = command === '' ? null : { command, timeoutMinutes: Math.round((s.prepare?.timeoutMs ?? 600_000) / 60_000) }
    const cap = capBox.value.trim() === '' ? 0 : Number(capBox.value.trim())
    if (!Number.isInteger(cap) || cap < 0 || cap > 64) return { error: '同时进行的工单上限要是 0–64 的整数' }
    if (cap !== (s.maxConcurrent ?? 0)) out.maxConcurrent = cap

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
    // Only what changed goes out: an untouched GitHub part keeps the save free of the owner-login check (design github-issues G7).
    if (issuesOn.checked !== (s.sources?.github === true)) out.sources = { github: issuesOn.checked }
    const repoList = linesOf(issueRepos.value)
    if (repoList.length > 10 || repoList.some(repo => !REPO.test(repo))) return { error: '接收 Issue 的仓库要写成 owner/name，最多 10 个' }
    if (!same(repoList, s.github?.repos ?? []) || intake.value !== (s.github?.intake ?? 'mention')) out.github = repoList.length === 0 && intake.value === 'mention' ? null : { repos: repoList, intake: intake.value }

    const address = reviewer.value.trim()
    if (address !== (s.reviewer ?? '')) out.reviewer = address === '' ? null : address
    return { patch: out }
  }
  return { nodes: [rulesBox, dispatchBox, profilesBox, execBox, botsBox, repoBox, githubBox, reviewBox], patch }
}
