/**
 * #91 file channel, slice F1b (docs/design/file-channel.md §3.2, §3.4, §5): the two HTTP faces
 * over the sender host's {@link BlobStore}.
 *
 * - `GET /a2a/blob?sha256=<hex>&caller_session=<label>` — the PULL face. Admission is the same
 *   reading the delivery face gives `已验证来源`: an OriginClaim that verifies, and for a host the
 *   audience-bound (v2) form signed from a ROOT card URL whose zone covers `caller_session`; a
 *   deposited CLI identity proves its own handle. The caller must then match a live grant's `to`:
 *   the same label, a target the verified signer's zone covers (that host answers for its own
 *   sessions and canvas teams), or a canvas team of THIS host with a member on the verified host.
 *   A refusal never says whether the blob exists. Pulls are rate-limited per proven signer.
 * - `POST /__dsh_a2a/blob?to=<team>&name=<file>` — the control-gated STAGE face (CLI `file send`,
 *   design §3.4): raw bytes in, a grant out. No peer can write into the store.
 * @module @nelsonlongxiang/dsh-open-a2a-net/faces/files
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Config } from '../index.ts'
import { BLOB_FILE_MAX, type BlobStore } from '../blob-store.ts'
import type { CanvasStore } from '../canvas-store.ts'
import { isRootOriginUrl } from '../origin-claim.ts'
import { claimCovers } from '../task-auth.ts'
import type { OriginClaimResult } from './wire.ts'

/** Pulls per proven signer (host zone or CLI handle) in a sliding minute (design §8; the FloodGuard figure). */
export const BLOB_PULLS_PER_MINUTE = 16
/** Distinct signers the pull limiter remembers; a full table refuses new signers rather than forgetting live ones. */
const PULL_CALLERS_MAX = 1024

export interface FileFaceDeps {
  readonly ctx: Context
  readonly config: Pick<Config, 'apiKey' | 'team'>
  readonly blobStore: BlobStore
  readonly canvasStore: Pick<CanvasStore, 'membersOf'>
  readonly verifyOriginClaim: (req: IncomingMessage, options?: { readonly cli?: boolean }) => Promise<OriginClaimResult>
  readonly secretEqual: (a: string, b: string) => boolean
  readonly controlRoute: (handler: (req: IncomingMessage, res: ServerResponse) => void) => (req: IncomingMessage, res: ServerResponse) => void
  readonly recordActivity: (dir: 'in' | 'out', team: string, peer: string, ok: boolean) => void
  readonly now?: () => number
}

/**
 * Whether a grant's target lets this proven caller pull (design §3.2): the same label; for a HOST
 * signer, also a target its zone covers, or a canvas team of THIS host (`<zone>/canvas/<name>`, this
 * zone only — another host's same-named team is a different team) with a member on the signer's
 * host. A CLI handle is an identity, never a zone (review of PR #208 R1): it admits only its own
 * exact grant. `caller` is already proven by `signer`.
 */
export function grantAdmits(to: string, caller: string, signer: string, zone: string, localCanvasMembers: (name: string) => readonly string[], cli = false): boolean {
  if (to === caller) return true
  if (cli) return false
  if (claimCovers(to, signer)) return true
  const prefix = `${zone}/canvas/`
  return to.startsWith(prefix) && to.length > prefix.length && localCanvasMembers(to.slice(prefix.length)).some(member => claimCovers(member, signer))
}

/**
 * Register the pull face and the stage face on the shared web server.
 * @param d - the captures listed on {@link FileFaceDeps}.
 */
export function registerFileFaces(webServer: WebServer, d: FileFaceDeps): void {
  const { ctx, config, blobStore, canvasStore, verifyOriginClaim, secretEqual, controlRoute, recordActivity } = d
  const now = d.now ?? (() => Date.now())
  const pulls = new Map<string, number[]>()
  const json = (res: ServerResponse, status: number, body: Record<string, unknown>): void => {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
    res.end(payload)
  }
  /** One more pull for a proven signer inside the minute, or false when it is over budget (or the table is full). */
  const takePull = (signer: string): boolean => {
    const at = now()
    for (const [key, times] of pulls) if (times.every(t => at - t >= 60_000)) pulls.delete(key)
    const recent = (pulls.get(signer) ?? []).filter(t => at - t < 60_000)
    if (recent.length >= BLOB_PULLS_PER_MINUTE) return false
    if (!pulls.has(signer) && pulls.size >= PULL_CALLERS_MAX) return false
    pulls.set(signer, [...recent, at])
    return true
  }

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/a2a/blob',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: 'GET is the only method on this face' }); return }
      if (config.apiKey !== '' && !secretEqual(String(req.headers['x-api-key'] ?? ''), config.apiKey)) {
        json(res, 401, { ok: false, error: 'unauthorized: X-API-Key required (apiKey is configured)' })
        return
      }
      const url = new URL(req.url ?? '/', 'http://x')
      const sha256 = url.searchParams.get('sha256') ?? ''
      const caller = url.searchParams.get('caller_session') ?? ''
      const refuse = (status: number, code: string, error: string): void => {
        recordActivity('in', 'blob', caller === '' ? 'anonymous' : caller, false)
        json(res, status, { ok: false, code, error })
      }
      if (caller === '') { refuse(403, 'untrusted-origin', 'caller_session is required'); return }
      const claim = await verifyOriginClaim(req, { cli: true })
      if (!claim.ok) { refuse(403, 'untrusted-origin', `OriginClaim verification failed (${claim.reason}) — a file is pulled only with a signed envelope`); return }
      // A deposited CLI handle proves exactly itself (R1: `H/child` is not H); a host proves its zone.
      const proven = claim.cli === true
        ? caller === claim.caller
        : claim.bound === true && isRootOriginUrl(claim.callerUrl) && claimCovers(caller, claim.caller)
      if (!proven) { refuse(403, 'untrusted-origin', 'the envelope does not prove this caller (it must be the audience-bound form, signed from a root card URL whose zone covers caller_session)'); return }
      const grant = blobStore.list().find(g => g.sha256 === sha256 && grantAdmits(g.to, caller, claim.caller, config.team, name => canvasStore.membersOf(name), claim.cli === true))
      // One answer for "no such blob", "expired" and "not yours": a refusal is no existence oracle.
      if (grant === undefined) { refuse(403, 'not-granted', 'no live grant lets this caller pull that file'); return }
      // Budgeted by the PROVEN signer (a host zone or a CLI handle), never the self-described label (R1).
      if (!takePull(claim.caller)) { refuse(429, 'rate-limited', `at most ${String(BLOB_PULLS_PER_MINUTE)} pulls per signer per minute`); return }
      const bytes = blobStore.read(grant)
      if (bytes === undefined) { refuse(410, 'gone', 'the file is no longer stored on this host'); return }
      recordActivity('in', 'blob', caller, true)
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.byteLength, 'X-A2A-Blob-Sha256': grant.sha256, 'X-A2A-Blob-Name': encodeURIComponent(grant.name) })
      res.end(bytes)
    },
  }), 'a2a: file-channel pull face')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/blob',
    handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'POST raw bytes with ?to=<team>&name=<file>' }); return }
      const url = new URL(req.url ?? '/', 'http://x')
      const to = url.searchParams.get('to') ?? ''
      const name = url.searchParams.get('name') ?? 'file'
      const by = url.searchParams.get('by') ?? 'control'
      const declared = Number(req.headers['content-length'] ?? NaN)
      if (Number.isFinite(declared) && declared > BLOB_FILE_MAX) { json(res, 413, { ok: false, code: 'too-large', error: `the file channel takes at most ${String(BLOB_FILE_MAX)} bytes` }); req.resume(); return }
      const chunks: Buffer[] = []
      let size = 0
      let over = false
      req.on('data', (chunk: Buffer) => {
        size += chunk.byteLength
        if (size > BLOB_FILE_MAX) { over = true; return }
        if (!over) chunks.push(chunk)
      })
      req.on('end', () => {
        if (over) { json(res, 413, { ok: false, code: 'too-large', error: `the file channel takes at most ${String(BLOB_FILE_MAX)} bytes` }); return }
        const staged = blobStore.stage(Buffer.concat(chunks), { name, to, by })
        json(res, staged.ok ? 200 : staged.code === 'too-large' ? 413 : staged.code === 'full' ? 507 : 400, { ...staged })
      })
    }),
  }), 'a2a: file-channel stage face')
}
