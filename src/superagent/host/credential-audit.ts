/**
 * The credential-access audit (local market trial, 2026-11-11): a team member that found no market tool read another
 * session's scratch directory, took a token file from it and used it. A team session's sandbox limits writes, not reads,
 * so the host cannot stop such a read today; it can see the call. This module looks at a team session's tool call and
 * says which kinds of sensitive place it touches: credential files and directories, an Authorization header, or another
 * session's files. The host records a hit and tells the owner; it does not block. Nothing a command read is ever
 * recorded — only the kinds, the tool and a preview of the command with anything secret-looking blanked out.
 */

/** What a call can touch. */
export type CredentialKind = 'credential-file' | 'authorization-header' | 'other-session'

const CREDENTIAL_FILE: readonly RegExp[] = [
  /(^|[\s"'=/~])\.ssh(\/|\b)/, /\bid_(rsa|ed25519|ecdsa|dsa)\b/, /[\w-]\.(pem|p12|key)(["'\s]|$)/,
  /(^|[\s"'=/~])\.a2a\//, /\bhost\.env\b/, /\/secrets?(\/|["'\s]|$)/, /\.token\b/, /(^|[\s"'=/~])\.netrc\b/, /(^|[\s"'=/~])\.npmrc\b/,
  /\.config\/gh\b/, /(^|[\s"'=/~])\.aws\//, /\.docker\/config\.json/, /\bgateway\.env\b/, /(^|[\s"'=/~])\.env(\.[a-z]+)?\b/,
  /\/keys?\/[^\s"']*\.(json|pem|key)\b/, /\bkeychain\b/i, /security\s+find-(generic|internet)-password/,
]
const AUTH_HEADER = /\bAuthorization\s*:|\bBearer\s+[A-Za-z0-9._~+/-]{8,}|\bx-api-key\s*:/i
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
