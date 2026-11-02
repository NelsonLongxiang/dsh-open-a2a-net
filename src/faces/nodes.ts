/**
 * The `/__dsh_a2a/nodes` face (docs/design/node-identity.md, slice N1).
 *
 * - GET rides the ordinary control trust (loopback or apiKey): the roster,
 *   and with `?name=` one node plus its version numbers and current layers.
 * - POST is an IDENTITY write (create / update / archive / write-core /
 *   write-mutable / rollback). §8-2 (owner ruling 2026-11-02): it requires
 *   the host's apiKey in `X-API-Key` even on loopback — a host with no
 *   apiKey refuses identity writes outright. No model tool reaches it.
 *   Same-host shell access can still edit the files; the design says so
 *   (§7) instead of pretending otherwise.
 * @module src/faces/nodes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { NodeResult, NodeStore } from '../node-store.ts'

/** Identity bodies carry layers of up to 3000 CJK characters; the 10 KiB control default is too small. */
export const NODE_BODY_MAX_BYTES = 32_000

export interface NodeFaceDeps {
  readonly ctx: Context
  readonly nodeStore: NodeStore
  readonly apiKey: () => string
  readonly secretEqual: (a: string, b: string) => boolean
  readonly controlRoute: (handler: (req: IncomingMessage, res: ServerResponse) => void) => (req: IncomingMessage, res: ServerResponse) => void
  readonly readJsonBody: (req: IncomingMessage, res: ServerResponse, use: (body: { readonly id?: unknown; readonly name?: unknown; readonly action?: unknown }) => void, maxBytes?: number) => void
}

/** §8-2: identity writes need the configured apiKey in the header — loopback is not enough, and no key means no identity writes. */
export function identityVerdict(apiKey: string, presented: unknown, secretEqual: (a: string, b: string) => boolean): { ok: true } | { ok: false; status: 401 | 403; error: string } {
  if (apiKey === '') return { ok: false, status: 403, error: 'identity writes require apiKey (node-identity §8-2): configure apiKey on this host first' }
  if (typeof presented !== 'string' || !secretEqual(presented, apiKey)) return { ok: false, status: 401, error: 'unauthorized: X-API-Key required for identity writes (loopback is not enough)' }
  return { ok: true }
}

const STATUS: Record<'bad-request' | 'not-found' | 'conflict' | 'quota' | 'cap', number> = { 'bad-request': 400, 'not-found': 404, conflict: 409, quota: 413, cap: 409 }

/** One POST body → status + payload. Pure: the route below only does I/O and the identity gate. */
export function nodeAction(store: NodeStore, body: Record<string, unknown>): { status: number; payload: Record<string, unknown> } {
  const by = typeof body.by === 'string' && body.by.trim() !== '' ? `human:${body.by.trim().slice(0, 64)}` : 'human:owner'
  const name = typeof body.name === 'string' ? body.name : ''
  const answer = (result: NodeResult<unknown>): { status: number; payload: Record<string, unknown> } => result.ok
    ? { status: 200, payload: { ok: true, value: result.value } }
    : { status: STATUS[result.code], payload: { ok: false, error: result.error, code: result.code } }
  switch (body.action) {
    case 'create': return answer(store.create(body, by))
    case 'update': return answer(store.update(name, { ...body, name: body.rename }))
    case 'archive': return answer(store.archive(name))
    case 'write-core': return answer(store.writeLayer(name, 'core', { core: body.text }, { expectedSha: body.expected_sha256, reason: body.reason, by, via: 'host-face' }))
    case 'write-mutable': return answer(store.writeLayer(name, 'mutable', body.sections, { expectedSha: body.expected_sha256, reason: body.reason, by, via: 'host-face' }))
    case 'rollback': return answer(store.rollback(name, body.layer === 'core' ? 'core' : 'mutable', body.to, { expectedSha: body.expected_sha256, reason: body.reason, by }))
    default: return { status: 400, payload: { ok: false, error: 'action must be create | update | archive | write-core | write-mutable | rollback' } }
  }
}

/** GET view: the roster, or one node with its version numbers and current layer texts. */
export function nodeView(store: NodeStore, name: string | null): { status: number; payload: Record<string, unknown> } {
  if (name === null || name === '') return { status: 200, payload: { ok: true, nodes: store.list() } }
  const node = store.get(name)
  if (node === undefined) return { status: 404, payload: { ok: false, error: `no node ${name}` } }
  return {
    status: 200,
    payload: {
      ok: true, node,
      versions: { core: store.versions(name, 'core'), mutable: store.versions(name, 'mutable') },
      current: {
        core: node.prompt.core_version > 0 ? store.version(name, 'core', node.prompt.core_version) : null,
        mutable: node.prompt.mutable_version > 0 ? store.version(name, 'mutable', node.prompt.mutable_version) : null,
      },
    },
  }
}

export function registerNodeFaces(webServer: WebServer, d: NodeFaceDeps): void {
  const { ctx, nodeStore, controlRoute, readJsonBody } = d
  const send = (res: ServerResponse, status: number, payload: Record<string, unknown>): void => {
    const text = JSON.stringify(payload)
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' })
    res.end(text)
  }
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/__dsh_a2a/nodes',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET') {
        controlRoute((r, s) => {
          const view = nodeView(nodeStore, new URL(r.url ?? '/', 'http://x').searchParams.get('name'))
          send(s, view.status, view.payload)
        })(req, res)
        return
      }
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'GET or POST' })
      const verdict = identityVerdict(d.apiKey(), req.headers['x-api-key'], d.secretEqual)
      if (!verdict.ok) return send(res, verdict.status, { ok: false, error: verdict.error })
      readJsonBody(req, res, (body) => {
        const out = nodeAction(nodeStore, body as Record<string, unknown>)
        send(res, out.status, out.payload)
      }, NODE_BODY_MAX_BYTES)
    },
  }), 'a2a: nodes route')
}
