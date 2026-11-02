/**
 * The `/__dsh_a2a/nodes` face (docs/design/node-identity.md, slice N1).
 *
 * - GET rides the ordinary control trust (loopback or apiKey): the roster,
 *   and with `?name=` one node plus its version numbers and current layers.
 * - POST is an IDENTITY write (create / update / archive / write-core /
 *   write-mutable / rollback, bind / unbind a session — N2+N3, and track /
 *   untrack a task pointer — N6). §8-2 (owner ruling 2026-11-02): it requires
 *   the host's apiKey in `X-API-Key` even on loopback — a host with no
 *   apiKey refuses identity writes outright. No model tool reaches it.
 *   Same-host shell access can still edit the files; the design says so
 *   (§7) instead of pretending otherwise.
 * @module src/faces/nodes
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { NodeErrorCode, NodeResult, NodeStore } from '../node-store.ts'
import type { NodeBinder, NodeBindings } from '../node-bind.ts'
import type { NodeTasks } from '../node-tasks.ts'

/** Identity bodies carry layers of up to 3000 CJK characters; the 10 KiB control default is too small. */
export const NODE_BODY_MAX_BYTES = 32_000

export interface NodeFaceDeps {
  readonly ctx: Context
  readonly logger: { warn: (format: string, ...args: unknown[]) => void }
  readonly nodeStore: NodeStore
  readonly bindings: NodeBindings
  readonly binder: NodeBinder
  readonly tasks: NodeTasks
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

const STATUS: Record<NodeErrorCode, number> = { 'bad-request': 400, 'not-found': 404, conflict: 409, quota: 413, cap: 409, unavailable: 503 }

/** One POST body → status + payload. Pure: the route below only does I/O and the identity gate. */
export function nodeAction(store: NodeStore, binder: NodeBinder, tasks: NodeTasks, raw: unknown): { status: number; payload: Record<string, unknown> } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { status: 400, payload: { ok: false, error: 'body must be a JSON object' } }
  const body = raw as Record<string, unknown>
  const by = typeof body.by === 'string' && body.by.trim() !== '' ? `human:${body.by.trim().slice(0, 64)}` : 'human:owner'
  const name = typeof body.name === 'string' ? body.name : ''
  const answer = (result: NodeResult<unknown>): { status: number; payload: Record<string, unknown> } => result.ok
    ? { status: 200, payload: { ok: true, value: result.value } }
    : { status: STATUS[result.code], payload: { ok: false, error: result.error, code: result.code } }
  switch (body.action) {
    case 'create': return answer(store.create(body, by))
    case 'update': return answer(store.update(name, { ...body, name: body.rename }))
    case 'archive': {
      const archived = store.archive(name)
      if (archived.ok) {
        binder.nodeArchived(name)
        tasks.dropNode(name)
      }
      return answer(archived)
    }
    case 'write-core': return answer(store.writeLayer(name, 'core', { core: body.text }, { expectedSha: body.expected_sha256, reason: body.reason, by, via: 'host-face' }))
    case 'write-mutable': return answer(store.writeLayer(name, 'mutable', body.sections, { expectedSha: body.expected_sha256, reason: body.reason, by, via: 'host-face' }))
    case 'rollback':
      if (body.layer !== 'core' && body.layer !== 'mutable') return { status: 400, payload: { ok: false, error: "layer must be 'core' or 'mutable'" } }
      return answer(store.rollback(name, body.layer, body.to, { expectedSha: body.expected_sha256, reason: body.reason, by }))
    case 'bind': return answer(binder.bind(typeof body.session === 'string' ? body.session : '', name, by))
    case 'unbind': return answer(binder.unbind(typeof body.session === 'string' ? body.session : ''))
    case 'track': {
      // §6 归因: the pointer records the node's versions at the moment it is tracked.
      const node = store.get(name)
      if (node === undefined) return { status: 404, payload: { ok: false, error: `no node ${name}` } }
      return answer(tasks.track(name, body.ref, { core: node.prompt.core_version, mutable: node.prompt.mutable_version }, by))
    }
    case 'untrack': return answer(tasks.untrack(name, body.ref))
    default: return { status: 400, payload: { ok: false, error: 'action must be create | update | archive | write-core | write-mutable | rollback | bind | unbind | track | untrack' } }
  }
}

/**
 * GET view: the roster with the bindings (and what each live session froze at mount), or one node
 * with its version numbers and current layers. `current` only shows a version that passes the shape
 * and sha checks (`null` otherwise) — the same reading a mount uses.
 */
export function nodeView(store: NodeStore, bindings: NodeBindings, binder: NodeBinder, tasks: NodeTasks, name: string | null): { status: number; payload: Record<string, unknown> } {
  if (name === null || name === '') {
    return {
      status: 200,
      payload: {
        ok: true, nodes: store.list(), read_only: store.readOnly, dropped: store.dropped,
        bindings: bindings.list().map(b => ({ ...b, mounted: binder.mounted(b.session) ?? null })),
        bindings_read_only: bindings.readOnly,
      },
    }
  }
  const node = store.get(name)
  if (node === undefined) return { status: 404, payload: { ok: false, error: `no node ${name}` } }
  return {
    status: 200,
    payload: {
      ok: true, node,
      versions: { core: store.versions(name, 'core'), mutable: store.versions(name, 'mutable') },
      current: {
        core: store.current(name, 'core') ?? null,
        mutable: store.current(name, 'mutable') ?? null,
      },
      tasks: tasks.list(name),
      tasks_read_only: tasks.readOnly,
    },
  }
}

export function registerNodeFaces(webServer: WebServer, d: NodeFaceDeps): void {
  const { ctx, nodeStore, bindings, binder, tasks, controlRoute, readJsonBody } = d
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
          try {
            const view = nodeView(nodeStore, bindings, binder, tasks, new URL(r.url ?? '/', 'http://x').searchParams.get('name'))
            send(s, view.status, view.payload)
          } catch (error) {
            d.logger.warn('nodes face: %s', String(error))
            if (!s.headersSent) send(s, 500, { ok: false, error: 'internal error' })
          }
        })(req, res)
        return
      }
      if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'GET or POST' })
      const verdict = identityVerdict(d.apiKey(), req.headers['x-api-key'], d.secretEqual)
      if (!verdict.ok) return send(res, verdict.status, { ok: false, error: verdict.error })
      readJsonBody(req, res, (body) => {
        // This runs in the body reader's 'end' callback, outside the web server's handler guard:
        // a throw here would be an uncaughtException and take the host down.
        try {
          const out = nodeAction(nodeStore, binder, tasks, body)
          send(res, out.status, out.payload)
        } catch (error) {
          d.logger.warn('nodes face: %s', String(error))
          if (!res.headersSent) send(res, 500, { ok: false, error: 'internal error' })
        }
      }, NODE_BODY_MAX_BYTES)
    },
  }), 'a2a: nodes route')
}
