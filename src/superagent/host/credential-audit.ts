/**
 * The credential-access audit (local market trial, 2026-11-11): a team member that found no market tool read another
 * session's scratch directory, took a token file from it and used it. A team session's sandbox limits writes, not reads,
 * so the host cannot stop such a read today; it can see the call. This module looks at a team session's tool call and
 * says which kinds of sensitive place it touches: credential files and directories, an Authorization header, or another
 * session's files. The host records a hit and tells the owner; it does not block. Nothing a command read is ever
 * recorded — only the kinds, the tool and a preview of the command with anything secret-looking blanked out.
 *
 * #895 (owner ruling 2026-11-26): every hit is still recorded, but only three things raise the owner's P1 card — a call
 * whose actual target is a protected credential file and that reads, sends or copies it; an actual request that carries an
 * Authorization or x-api-key header; and reading another session's token or credential files. A name that only appears in
 * a search term, a description, a note or the body of something written is recorded and nothing more. `credentialVerdict`
 * says which kinds are which; a shape it cannot read with confidence falls back to the old behaviour (a card).
 */

/** What a call can touch. */
export type CredentialKind = 'credential-file' | 'authorization-header' | 'other-session'

const CREDENTIAL_FILE: readonly RegExp[] = [
  /(^|[\s"'=/~])\.ssh(\/|\b)/, /\bid_(rsa|ed25519|ecdsa|dsa)\b/, /[\w-]\.(pem|p12|key)(["'\s]|$)/,
  /(^|[\s"'=/~])\.a2a\//, /\bhost\.env\b/, /\/secrets?(\/|["'\s]|$)/, /\.token\b/, /(^|[\s"'=/~])\.netrc\b/, /(^|[\s"'=/~])\.npmrc\b/,
  /\.config\/gh\b/, /(^|[\s"'=/~])\.aws\//, /\.docker\/config\.json/, /\bgateway\.env\b/, /(^|[\s"'=/~])\.env(\.[a-z]+)?\b/,
  /\/keys?\/[^\s"']*\.(json|pem|key)\b/, /\bkeychain\b/i, /security\s+find-(generic|internet)-password/,
  // 2026-11-12 (one system user, measured on a test node): an A2A identity's private key (any team's `team-cli/cli.json`
  // or another CLI home's `cli.json`), the host's own state directory, the profile overrides that carry provider keys,
  // and the ygl workspace database files.
  /\bcli\.json\b/, /\.dsh\/state\//, /\.dsh\/profiles\/[^\s"']*cordis[^\s"'/]*\.ya?ml/, /ygl[^\s"']*\.db\b/,
]
const AUTH_HEADER = /\bAuthorization["']?\s*:|\bBearer\s+[A-Za-z0-9._~+/-]{8,}|\bx-api-key["']?\s*:/i
/** Places other sessions keep their files: Claude Code scratch directories, DSH session logs, shared side-session notes. */
const OTHER_SESSION: readonly RegExp[] = [/\/(private\/)?tmp\/claude-\d+\//, /\.dsh\/sessions\//, /side-session-notes/, /\.claude\/projects\//]

/** The text a call's arguments put on the host: a shell command, a path, a URL and headers. */
function callText(args: unknown): string {
  if (typeof args === 'string') return args
  if (args === null || typeof args !== 'object') return ''
  const out: string[] = []
  const walk = (value: unknown, depth: number): void => {
    if (depth > 4) return
    if (typeof value === 'string') out.push(value)
    else if (Array.isArray(value)) for (const item of value) walk(item, depth + 1)
    else if (value !== null && typeof value === 'object') for (const [key, item] of Object.entries(value as Record<string, unknown>)) { out.push(key); walk(item, depth + 1) }
  }
  walk(args, 0)
  return out.join('\n')
}

/** The kinds of sensitive place a tool call touches; empty when it touches none. */
export function credentialAccess(args: unknown): CredentialKind[] {
  const text = callText(args)
  if (text === '') return []
  const kinds: CredentialKind[] = []
  if (CREDENTIAL_FILE.some(re => re.test(text))) kinds.push('credential-file')
  if (AUTH_HEADER.test(text)) kinds.push('authorization-header')
  if (OTHER_SESSION.some(re => re.test(text))) kinds.push('other-session')
  return kinds
}

/** A preview of the call safe to keep: anything that looks like a secret value is blanked, and it is cut short. */
export function redactedPreview(args: unknown, cap = 200): string {
  return callText(args).replace(/\s+/g, ' ')
    .replace(/\b(Bearer|Basic|token|password|passwd|secret|api[_-]?key|authorization)("?\s*[:=]\s*"?|\s+)[^\s"'&,}]{4,}/gi, '$1$2<redacted>')
    .replace(/[A-Za-z0-9+/_-]{24,}={0,2}/g, '<redacted>')
    .trim().slice(0, cap)
}

// ---- #895: what a call actually does, as opposed to what it mentions ----

/** What the host does with a call: every hit is `kinds` (recorded); `card` is the part that raises the owner's P1 card. */
export interface CredentialVerdict { readonly kinds: CredentialKind[]; readonly card: CredentialKind[] }

const matchesFile = (text: string): boolean => CREDENTIAL_FILE.some(re => re.test(text))
const matchesOther = (text: string): boolean => OTHER_SESSION.some(re => re.test(text))

/** The first string among the named fields of a structured call, or undefined when none is a string. */
function field(args: unknown, names: readonly string[]): string | undefined {
  if (args === null || typeof args !== 'object') return undefined
  const record = args as Record<string, unknown>
  for (const name of names) if (typeof record[name] === 'string') return record[name] as string
  return undefined
}

/** A shell-ish word: its text with the quotes taken off. */
function words(segment: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(segment); m !== null; m = re.exec(segment)) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

/** Heredoc bodies are text the command writes or feeds, not a target: cut them before looking at the command. */
function withoutHeredocs(command: string): string {
  const lines = command.split('\n')
  const out: string[] = []
  let stop: string | undefined
  for (const line of lines) {
    if (stop !== undefined) { if (line.trim() === stop) stop = undefined; continue }
    out.push(line)
    const m = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)
    if (m !== null) stop = m[2]
  }
  return out.join('\n')
}

/** Programs that read what they are given (the content, not just the name), or copy or send it on. */
const READS = new Set(['cat', 'tac', 'head', 'tail', 'less', 'more', 'bat', 'nl', 'od', 'xxd', 'hexdump', 'strings', 'base64', 'openssl', 'gpg', 'sha256sum', 'shasum', 'md5sum', 'cut', 'sort', 'uniq', 'tr', 'wc', 'diff', 'cmp', 'paste', 'fold', 'jq', 'yq', 'source', '.', 'cp', 'scp', 'sftp', 'rsync', 'mv', 'tar', 'zip', 'unzip', 'gzip', 'gunzip', 'zcat', 'bzip2', 'xz', 'dd', 'sqlite3', 'ssh', 'ssh-add', 'security', 'pbcopy', 'tee', 'xargs'])
/** Programs whose first plain argument is a search pattern or script, not a file. */
const PATTERN_FIRST = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'sed', 'awk'])
/** Programs that make a request. */
const REQUESTS = new Set(['curl', 'wget', 'http', 'https', 'httpie', 'xh', 'grpcurl', 'nc', 'ncat', 'telnet'])
/** General executors: what they run cannot be read from here, so a protected name anywhere in the call counts. */
const EXECUTORS = new Set(['python', 'python3', 'node', 'deno', 'bun', 'ruby', 'perl', 'php', 'eval', 'osascript'])
const SHELLS = new Set(['sh', 'bash', 'zsh'])
/** Programs that read nothing of their targets (names, builds, tests, bookkeeping). */
const QUIET = new Set(['ls', 'find', 'tree', 'stat', 'du', 'df', 'echo', 'printf', 'pwd', 'cd', 'mkdir', 'touch', 'rm', 'rmdir', 'test', '[', 'true', 'false', 'date', 'which', 'whoami', 'env', 'export', 'npm', 'pnpm', 'npx', 'yarn', 'vitest', 'jest', 'tsc', 'eslint', 'prettier', 'make', 'gh', 'sleep', 'kill', 'ps', 'lsof', 'pgrep', 'pkill', 'git', 'basename', 'dirname', 'realpath', 'readlink', 'chmod', 'chown', 'ln', 'type', 'command', 'wait', 'set', 'unset', 'read'])
const GIT_READS = new Set(['add', 'show', 'diff', 'cat-file', 'archive', 'stash', 'hash-object', 'grep', 'log'])
// A request call in program text. No trailing \b after a call's `(`: fetch("https://…") has a quote there, and a word boundary needs a word character on one side (#947 review B1).
const AUTH_REQUEST_CODE = /\b(?:fetch\s*\(|got\s*\(|https?\.(?:request|get)\b|(?:axios|XMLHttpRequest|urlopen|urllib|aiohttp|httpx|HttpClient|curl|wget)\b|requests\.|http\.client|Invoke-(?:WebRequest|RestMethod))/
const READ_CODE = /\b(readFileSync?|readFile|createReadStream|copyFile(Sync)?|cpSync|open\s*\(|tools\.(read|read_image|grep|bash)|\.read\s*\(|execSync|spawnSync|execFile|exec\s*\()|\b(cat|head|tail|cp|scp|base64|source)\s/

/** Split a command at ; newline && || | & that are outside quotes, so a quoted script stays one piece. */
function segments(command: string): string[] {
  const out: string[] = []
  let current = '', quote = ''
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote !== '') {
      current += ch
      if (quote === '"' && ch === '\\' && i + 1 < command.length) { current += command[++i]!; continue }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue }
    const next = command[i + 1] ?? '', prev = command[i - 1] ?? ''
    const split = ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && !/[0-9>&]/.test(prev) && !/[>&0-9]/.test(next))
    if (split) { out.push(current); current = ''; if ((ch === '|' || ch === '&') && next === ch) i++; continue }
    current += ch
  }
  out.push(current)
  return out
}

/**
 * The commands a shell would run inside $( ) or backticks. Quote-aware (#947 review B2): inside single quotes nothing is expanded,
 * so a note that quotes $(cat …) is text; a double-quoted $( ) does run; a backslash-escaped one does not; $( ) nests.
 */
function substitutions(command: string): string[] {
  const out: string[] = []
  let single = false, double = false
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (single) { if (ch === "'") single = false; continue }
    if (ch === '\\') { i++; continue }
    if (ch === "'" && !double) { single = true; continue }
    if (ch === '"') { double = !double; continue }
    if (ch === '$' && command[i + 1] === '(') {
      let depth = 1, j = i + 2
      for (; j < command.length && depth > 0; j++) { if (command[j] === '(') depth++; else if (command[j] === ')') depth-- }
      out.push(command.slice(i + 2, depth === 0 ? j - 1 : j))
      i = j - 1
      continue
    }
    if (ch === '`') {
      const end = command.indexOf('`', i + 1)
      const stop = end < 0 ? command.length : end
      out.push(command.slice(i + 1, stop))
      i = stop
    }
  }
  return out
}

/** Whether a shell command, read word by word, reads, sends or copies a protected target, or makes a request with a credential header. */
function shellCard(command: string, kind: CredentialKind, depth = 0): boolean {
  const text = withoutHeredocs(command)
  if (depth < 3) for (const inner of substitutions(text)) if (shellCard(inner, kind, depth + 1)) return true
  for (const segment of segments(text)) {
    let w = words(segment)
    while (w.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]!) || ['sudo', 'time', 'nohup', 'command', 'exec', 'builtin'].includes(w[0]!))) w = w.slice(1)
    if (w.length === 0) continue
    const verb = (w[0]!.split('/').pop() ?? '').toLowerCase()
    const rest = w.slice(1)
    const protectedHere = (item: string): boolean => kind === 'credential-file' ? matchesFile(item) : kind === 'other-session' ? matchesOther(item) : false
    // A redirect reads or writes its target: < file reads it, > file writes it.
    for (let i = 0; i < rest.length; i++) {
      const word = rest[i]!
      const m = /^(\d?)(>>?|<)(.*)$/.exec(word)
      if (m !== null && !word.startsWith('<<') && !word.startsWith('>&')) {
        const target = m[3]! !== '' ? m[3]! : (rest[i + 1] ?? '')
        if (protectedHere(target)) return true
      }
    }
    if (REQUESTS.has(verb)) {
      if (kind === 'authorization-header' && AUTH_HEADER.test(segment)) return true
      // curl -d @file, --data-binary @file, -F name=@file, -T file, --upload-file file, wget --post-file file: the file is sent.
      for (let i = 0; i < rest.length; i++) {
        const word = rest[i]!
        const sent = /@(.+)$/.exec(word)?.[1] ?? (/^(-T|--upload-file|--post-file|--body-file)$/.test(word) ? rest[i + 1] : undefined)
        if (sent !== undefined && protectedHere(sent)) return true
      }
      continue
    }
    if (SHELLS.has(verb) && depth < 2) {
      const at = rest.findIndex(item => item === '-c' || /^-[a-z]*c$/.test(item))
      if (at >= 0 && rest[at + 1] !== undefined) { if (shellCard(rest[at + 1]!, kind, depth + 1)) return true; continue }
    }
    if (EXECUTORS.has(verb) || SHELLS.has(verb) || (verb === 'find' && rest.some(item => /^-(exec|execdir|ok|okdir)$/.test(item)))) {
      // What these run cannot be read from the command: a protected name anywhere in it counts, and so does a credential header with a request.
      if (kind === 'authorization-header') { if (AUTH_HEADER.test(segment) && AUTH_REQUEST_CODE.test(segment)) return true }
      else if (protectedHere(segment)) return true
      continue
    }
    if (kind === 'authorization-header') continue
    const plain = rest.filter(item => !item.startsWith('-') && !/^\d?[<>]/.test(item))
    if (PATTERN_FIRST.has(verb)) {
      const targets = plain.slice(1)
      // -e PATTERN gives the pattern as an option, so every plain argument is a file then; -f FILE names a pattern file that is read.
      const named = rest.some(item => item === '-e' || item === '--regexp')
      if ((named ? plain : targets).some(protectedHere)) return true
      const fileOpt = rest.findIndex(item => item === '-f' || item === '--file')
      if (fileOpt >= 0 && rest[fileOpt + 1] !== undefined && protectedHere(rest[fileOpt + 1]!)) return true
      continue
    }
    if (verb === 'git') { if (rest[0] !== undefined && GIT_READS.has(rest[0]) && plain.slice(1).some(protectedHere)) return true; continue }
    if (READS.has(verb)) { if (plain.some(protectedHere)) return true; continue }
    if (QUIET.has(verb)) continue
    // An unknown program given a path to a protected place: it may read it, so it counts (a bare word does not).
    if (plain.some(item => protectedHere(item) && /[/~]|^\./.test(item))) return true
  }
  return false
}

/** Whether a program text (a generic executor's code) reads a protected place or makes a request with a credential header. */
function codeCard(code: string, kind: CredentialKind): boolean {
  if (kind === 'authorization-header') return AUTH_HEADER.test(code) && AUTH_REQUEST_CODE.test(code)
  return (kind === 'credential-file' ? matchesFile(code) : matchesOther(code)) && READ_CODE.test(code)
}

/** Tools whose arguments are notes, descriptions or reports: text the host passes on, never a target. */
const NOTE_TOOLS: ReadonlySet<string> = new Set([
  'todo_write',
  'a2a_ticket_read', 'a2a_ticket_report', 'a2a_ticket_ack', 'a2a_ticket_handback', 'a2a_ticket_request', 'a2a_ticket_note', 'a2a_outbound_request',
  'a2a_decision_decide', 'a2a_decision_propose', 'a2a_member_rules_propose', 'a2a_member_rules_apply', 'a2a_status', 'a2a_task_read', 'a2a_tasks', 'a2a_teams', 'a2a_probe', 'a2a_report',
  'superagent_note', 'superagent_reply', 'superagent_read', 'superagent_status', 'superagent_route', 'superagent_split', 'superagent_request', 'superagent_assign', 'superagent_org_read',
  'superagent_decision_propose', 'superagent_issue_propose', 'superagent_rules_propose', 'superagent_rules_apply', 'superagent_rule_templates', 'superagent_blueprint_propose', 'superagent_blueprint_apply', 'superagent_blueprint_withdraw',
])
/** Only the tools that carry text a person or the host reads. The file-transfer tools (a2a_file_*) read and write files, so a prefix is not enough (#947 review N1); a tool not named here keeps the old rule. */
const isNoteTool = (tool: string): boolean => NOTE_TOOLS.has(tool)

/**
 * Which of the hits make the owner's card (#895). Structured tools are read by field: the file a read or write names is
 * the target, a search term and the body of a write are not; a shell command is read word by word. A tool or shape that is
 * not known keeps the old rule (every hit is a card).
 */
export function credentialVerdict(tool: string, args: unknown): CredentialVerdict {
  const kinds = credentialAccess(args)
  if (kinds.length === 0) return { kinds, card: [] }
  const card = (rule: (kind: CredentialKind) => boolean): CredentialVerdict => ({ kinds, card: kinds.filter(rule) })
  const place = (target: string | undefined) => (kind: CredentialKind): boolean => target !== undefined && (kind === 'credential-file' ? matchesFile(target) : kind === 'other-session' ? matchesOther(target) : false)
  switch (tool) {
    case 'read': case 'read_image': case 'write': case 'edit': {
      const target = field(args, ['file_path', 'path'])
      return target === undefined ? { kinds, card: kinds } : card(place(target))
    }
    case 'grep': {
      // The pattern is a search term; the path and the file filter are where it looks, and a search reads what it finds.
      const scope = [field(args, ['path']), field(args, ['include'])].filter((item): item is string => item !== undefined).join(' ')
      return card(place(scope === '' ? undefined : scope))
    }
    case 'glob': case 'web_fetch': return card(() => false)
    case 'bash': {
      const command = field(args, ['command'])
      return command === undefined ? { kinds, card: kinds } : card(kind => shellCard(command, kind))
    }
    case 'run_code': {
      const code = field(args, ['code'])
      return code === undefined ? { kinds, card: kinds } : card(kind => codeCard(code, kind))
    }
    default: return isNoteTool(tool) ? card(() => false) : { kinds, card: kinds }
  }
}
