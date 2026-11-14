/**
 * #91 file channel, slice F2 (docs/design/file-channel.md §3.1–§3.3, §3.5–§3.6): the two model
 * tools over the blob store and the pull face.
 *
 * - `a2a_file_send { paths, team, note? }` reads one or more files from the session's workspace,
 *   stages each (by sha256, granted to `team`), and routes ONE message carrying one reference line
 *   per file through the ordinary route trunk — admission, ledger and receipts are a2a_route's. The
 *   route's host-written `peer_content` flag rides the result (N4: a route that reached a peer taints).
 * - `a2a_file_fetch { ref }` pulls one referenced file — from this host's own store when the
 *   reference names this host, else over the pull face with this host's OriginClaim envelope — checks
 *   sha256 and size, and lands it at `<workspace>/a2a-inbox/<sha12>-<name>`, never following a link.
 *   Its result always counts as content from outside this host (N4).
 * - `a2a_file_grants {}` lists the grants THIS session made that are still live (sha256, size, name,
 *   to, granted/expiry times, task id, whether the target fetched it) and the store's occupancy and
 *   ceilings; `a2a_file_revoke { sha256, to }` revokes one of them (market request 2026-11-14). A
 *   session revokes only its own grants: another sender's is answered as missing. A blob no grant
 *   names any more is deleted, so its bytes are free at once.
 * @module @nelsonlongxiang/dsh-open-a2a-net/tools/files
 */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from '../index.ts'
import { BLOB_FILE_MAX, BLOB_TASK_RE, formatFileRef, parseFileRef, sanitizeBlobName, type BlobStore } from '../blob-store.ts'
import { grantAdmits, grantView } from '../faces/files.ts'
import { LOCAL_ROUTE } from '../node-self.ts'
import { originOf, type OriginClaimTarget } from '../origin-claim.ts'
import { normalizeLinkKeys, outboundKeyFor } from '../link-keys.ts'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Files one send may carry (one message; the FloodGuard per-transfer figure). */
export const FILE_SEND_MAX = 16
/** The inbox directory under a session's workspace. */
export const FILE_INBOX_DIR = 'a2a-inbox'

export interface FileToolsDeps {
  readonly ctx: Context
  readonly config: Pick<Config, 'apiKey' | 'team' | 'linkKeys'>
  readonly blobStore: BlobStore
  readonly canvasMembersOf: (name: string) => readonly string[]
  /** This host's own card URL (live: it is known only once the web server settled). */
  readonly ownCardUrl: () => string
  readonly sessionTeamOf: (agent: Agent) => string
  readonly a2aJoinGateRefusal: (exec: { agent?: { id: unknown } } | undefined) => void
  readonly routeTrunk: (args: { team: string; message: string; async?: boolean }, agent: Agent | undefined, signal: AbortSignal) => Promise<Record<string, JsonValue>>
  readonly peerFetch: typeof globalThis.fetch
  readonly originClaimHeaders: (target: OriginClaimTarget) => Record<string, string>
}

/** The session's workspace directory, or '' when it has none. */
const workspaceOf = (agent: Agent | undefined): string => {
  const cwd = (agent?.session as { header?: { cwd?: unknown } } | undefined)?.header?.cwd
  return typeof cwd === 'string' ? cwd : ''
}

export function createFileTools(d: FileToolsDeps): { registerFileSend: () => void; registerFileFetch: () => void; registerFileGrants: () => void; registerFileRevoke: () => void } {
  const { ctx, config, blobStore } = d

  function registerFileSend(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_file_send',
      description:
        'Send one or more files to an A2A team WITHOUT putting their bytes in a session message (#91 file channel). '
        + 'Each file is stored on this host by sha256 and granted to the team for 24h; the team receives ONE message '
        + 'with one "[A2A file] v1 …" reference line per file and pulls them with a2a_file_fetch. At most 16 files, '
        + '64 MiB each. Paths are relative to your workspace (or absolute).',
      parameters: {
        paths: { type: 'array', items: { type: 'string' }, required: true, description: 'Files to send (1–16).' },
        team: { type: 'string', required: true, description: 'Target team, as for a2a_route.' },
        note: { type: 'string', description: 'Optional text to put above the references.' },
        task_id: { type: 'string', description: 'Optional task id to record on the grants (default: the task this send goes out in).' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: value.ok === true ? `Sent ${String((value.files as unknown[]).length)} file(s) to ${String(value.team)} (task ${String(value.task_id)}).` : `File send refused: ${String(value.error)}` }],
      },
      presentCall: args => ({ card: 'generic', title: `A2A file send → ${String(args.team)}`, kind: 'other', rawInput: args }),
      execute: async (args: { paths: string[]; team: string; note?: string; task_id?: string }, exec): Promise<Record<string, JsonValue>> => {
        const agent = exec.agent as Agent | undefined
        const team = String(args.team ?? '').trim()
        const paths = Array.isArray(args.paths) ? args.paths.map(p => String(p)) : []
        if (team === '') return { ok: false, error: 'team is required', peer_content: false }
        if (paths.length === 0 || paths.length > FILE_SEND_MAX) return { ok: false, error: `paths must name 1–${String(FILE_SEND_MAX)} files`, peer_content: false }
        const taskId = typeof args.task_id === 'string' && args.task_id.trim() !== '' ? args.task_id.trim() : undefined
        if (taskId !== undefined && !BLOB_TASK_RE.test(taskId)) return { ok: false, error: 'task_id is 1–80 of A-Z a-z 0-9 . _ : -', peer_content: false }
        const from = originOf(d.ownCardUrl())
        if (from === '') return { ok: false, error: 'this host publishes no card URL yet (announce is off or the web server has not settled): a receiver could not pull from it', peer_content: false }
        const cwd = workspaceOf(agent)
        const by = agent !== undefined ? String(agent.id) : 'host'
        const staged: Array<{ sha256: string; size: number; name: string; expiresAt: number }> = []
        for (const p of paths) {
          const abs = isAbsolute(p) ? p : cwd !== '' ? resolve(cwd, p) : ''
          if (abs === '') return { ok: false, error: `relative path ${p} needs a session workspace`, peer_content: false }
          let bytes: Uint8Array
          try {
            const st = statSync(abs)
            if (!st.isFile()) return { ok: false, error: `${p} is not a file`, peer_content: false }
            if (st.size > BLOB_FILE_MAX) return { ok: false, error: `${p} is ${String(st.size)} bytes; the file channel takes at most ${String(BLOB_FILE_MAX)}`, peer_content: false }
            bytes = readFileSync(abs)
          } catch (error) {
            return { ok: false, error: `cannot read ${p}: ${error instanceof Error ? error.message : String(error)}`, peer_content: false }
          }
          const out = blobStore.stage(bytes, { name: abs.split(/[\\/]/).pop() ?? p, to: team, by, ...(taskId !== undefined ? { taskId } : {}) })
          if (!out.ok) return { ok: false, error: `${p}: ${out.error}`, code: out.code, peer_content: false }
          staged.push({ sha256: out.sha256, size: out.size, name: out.name, expiresAt: out.expiresAt })
        }
        const note = typeof args.note === 'string' ? args.note.trim() : ''
        const message = [...(note !== '' ? [note] : []), ...staged.map(f => formatFileRef({ ...f, from }))].join('\n')
        // The route's own trunk: join gate, admission, ledger and receipts are a2a_route's.
        const { [LOCAL_ROUTE]: local, ...routed } = await d.routeTrunk({ team, message, async: true }, agent, exec.signal) as Record<string, JsonValue> & { [LOCAL_ROUTE]?: true }
        // The grants remember the task they went out in (unless the caller named one).
        if (taskId === undefined && typeof routed.task_id === 'string') for (const f of staged) blobStore.tagTask(f.sha256, team, by, routed.task_id)
        return { ...routed, ok: routed.ok === true, team, files: staged, peer_content: local !== true }
      },
    }))
  }

  function registerFileFetch(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_file_fetch',
      description:
        'Pull a file another node sent you with a2a_file_send: pass the whole "[A2A file] v1 …" reference line. '
        + 'The file is checked against its sha256 and size and saved under a2a-inbox/ in your workspace; the result '
        + 'gives its path. Fetched content comes from outside this host.',
      parameters: {
        ref: { type: 'string', required: true, description: 'The reference line, as received.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: value.ok === true ? `Fetched ${String(value.path)} (${String(value.size)} bytes, sha256 ${String(value.sha256)}).` : `File fetch failed: ${String(value.error)}` }],
      },
      presentCall: () => ({ card: 'generic', title: 'A2A file fetch', kind: 'other', rawInput: null }),
      execute: async (args: { ref: string }, exec): Promise<Record<string, JsonValue>> => {
        const agent = exec.agent as Agent | undefined
        d.a2aJoinGateRefusal(agent === undefined ? undefined : { agent })
        const ref = parseFileRef(String(args.ref ?? ''))
        if (ref === undefined) return { ok: false, code: 'bad-ref', error: 'not an "[A2A file] v1 sha256=… size=… name=… from=<origin>" reference' }
        const cwd = workspaceOf(agent)
        if (cwd === '') return { ok: false, code: 'no-workspace', error: 'this session has no workspace to land the file in' }
        const caller = agent !== undefined ? d.sessionTeamOf(agent) : config.team
        let bytes: Uint8Array
        if (ref.from === originOf(d.ownCardUrl())) {
          // This host's own store: the grant must name THIS session (or a canvas team of this host it is a
          // member of) — the session is its own signer here, never the whole host zone.
          const grant = blobStore.list().find(g => g.sha256 === ref.sha256 && grantAdmits(g.to, caller, caller, config.team, d.canvasMembersOf))
          const local = grant === undefined ? undefined : blobStore.read(grant)
          if (local === undefined || grant === undefined) return { ok: false, code: 'not-granted', error: 'no live grant lets this session pull that file' }
          blobStore.noteFetch(grant)
          bytes = local
        } else {
          const target = `${ref.from}/a2a/blob`
          const key = outboundKeyFor(target, normalizeLinkKeys(config.linkKeys), config.apiKey) // #317 link key
          let response: Response
          try {
            response = await d.peerFetch(`${target}?sha256=${ref.sha256}&caller_session=${encodeURIComponent(caller)}`, {
              headers: { ...d.originClaimHeaders({ url: target, method: 'GET' }), ...(key !== '' ? { 'X-API-Key': key } : {}) },
              redirect: 'manual',
              signal: AbortSignal.any([exec.signal, AbortSignal.timeout(120_000)]),
            })
          } catch (error) {
            const why = error instanceof Error ? error.message : String(error)
            return { ok: false, code: why.startsWith('isolated') ? 'isolated' : 'file-origin-unreachable', error: `cannot reach ${ref.from}: ${why}` }
          }
          if (response.status !== 200) {
            const body = await response.json().catch(() => ({})) as { code?: unknown; error?: unknown }
            return { ok: false, code: typeof body.code === 'string' ? body.code : `http-${String(response.status)}`, error: `${ref.from} refused: ${String(body.error ?? `HTTP ${String(response.status)}`)}` }
          }
          const declared = Number(response.headers.get('content-length') ?? NaN)
          if (Number.isFinite(declared) && declared !== ref.size) { await response.body?.cancel(); return { ok: false, code: 'size-mismatch', error: `the reference says ${String(ref.size)} bytes; ${ref.from} sends ${String(declared)}` } }
          // Bounded read: a peer that streams past the referenced size is cut off, never buffered.
          const reader = response.body?.getReader()
          const chunks: Uint8Array[] = []
          let got = 0
          for (;;) {
            const step = reader === undefined ? { done: true as const, value: undefined } : await reader.read()
            if (step.done) break
            got += step.value.byteLength
            if (got > ref.size) { await reader?.cancel(); return { ok: false, code: 'size-mismatch', error: `${ref.from} sent more than the referenced ${String(ref.size)} bytes` } }
            chunks.push(step.value)
          }
          bytes = Buffer.concat(chunks)
        }
        if (bytes.byteLength !== ref.size) return { ok: false, code: 'size-mismatch', error: `expected ${String(ref.size)} bytes, got ${String(bytes.byteLength)}` }
        if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) return { ok: false, code: 'digest-mismatch', error: 'the bytes do not hash to the referenced sha256; nothing was saved' }
        const dir = join(cwd, FILE_INBOX_DIR)
        try {
          if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) return { ok: false, code: 'unsafe-inbox', error: `${FILE_INBOX_DIR} is a link; refusing to write through it` }
          mkdirSync(dir, { recursive: true })
          const path = join(dir, `${ref.sha256.slice(0, 12)}-${sanitizeBlobName(ref.name)}`)
          if (existsSync(path) || (() => { try { lstatSync(path); return true } catch { return false } })()) {
            // Already landed (same sha prefix + name): reuse only when it IS these bytes and not a link.
            if (lstatSync(path).isSymbolicLink() || createHash('sha256').update(readFileSync(path)).digest('hex') !== ref.sha256) return { ok: false, code: 'exists', error: `${path} exists with other content` }
          } else {
            writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
          }
          return { ok: true, path, size: bytes.byteLength, sha256: ref.sha256, name: sanitizeBlobName(ref.name), from: ref.from }
        } catch (error) {
          return { ok: false, code: 'write-failed', error: error instanceof Error ? error.message : String(error) }
        }
      },
    }))
  }

  function registerFileGrants(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_file_grants',
      description:
        'List the file-channel grants YOU made that are still live: per file its sha256, size, name, target (to), when it was '
        + 'granted and expires, the task it went out in, and whether the target has fetched it; plus the store\'s occupancy '
        + 'and ceilings (files, bytes). Use it to see what still holds space, then a2a_file_revoke what is no longer needed.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: value.ok === true ? `${String((value.grants as unknown[]).length)} live grant(s) of yours; store ${JSON.stringify(value.usage)}.` : `Grants unavailable: ${String(value.error)}` }],
      },
      presentCall: () => ({ card: 'generic', title: 'A2A file grants', kind: 'other', rawInput: null }),
      execute: async (_args: Record<string, never>, exec): Promise<Record<string, JsonValue>> => {
        const agent = exec.agent as Agent | undefined
        if (agent === undefined) return { ok: false, error: 'only a session lists its grants' }
        return { ok: true, grants: blobStore.grantsBy(String(agent.id)).map(grantView), usage: { ...blobStore.usage() } }
      },
    }))
  }

  function registerFileRevoke(): void {
    ctx.tools.register(defineTool({
      name: 'a2a_file_revoke',
      description:
        'Revoke one file-channel grant YOU made: the file (sha256) for one target (to), exactly as a2a_file_grants lists it. '
        + 'The target can no longer pull it; when no grant names the file any more its bytes are deleted and the space is free. '
        + 'You can revoke only your own grants.',
      parameters: {
        sha256: { type: 'string', required: true, description: 'The file\'s sha256 (64 hex).' },
        to: { type: 'string', required: true, description: 'The grant\'s target, as listed.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: value.ok === true ? `Revoked ${String(value.sha256).slice(0, 12)}… for ${String(value.to)}${value.reclaimed === true ? ` (${String(value.bytes)} bytes freed)` : ''}.` : `Revoke refused: ${String(value.error)}` }],
      },
      presentCall: args => ({ card: 'generic', title: `A2A file revoke → ${String(args.to)}`, kind: 'other', rawInput: args }),
      execute: async (args: { sha256: string; to: string }, exec): Promise<Record<string, JsonValue>> => {
        const agent = exec.agent as Agent | undefined
        if (agent === undefined) return { ok: false, code: 'bad-request', error: 'only a session revokes its grants' }
        return { ...blobStore.revoke(String(args.sha256 ?? ''), String(args.to ?? ''), String(agent.id)) }
      },
    }))
  }

  return { registerFileSend, registerFileFetch, registerFileGrants, registerFileRevoke }
}
