/**
 * `/__dsh_a2a/node-ops`: the control API's node operations (superagent/host/node-ops.ts). GET reads the status with the
 * control key; every POST also needs the browser owner or a live owner delegate, like the other owner-only routes.
 * POST actions: `install` (base64 tarball + sha256), `rollback` (optional backup id), `restart`; `install` and
 * `rollback` take `restart: true` to restart once the swap succeeded. A restart asks this node's own
 * `/dsh-simple-restart/api/restart` over loopback, so it inherits that plugin's supervisor checks.
 * @module @nelsonlongxiang/dsh-open-a2a-net/faces/node-ops
 */
import type { Context } from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { browserOwnerProof } from '../superagent/host/owner-proof.ts'
import { OWNER_DELEGATE_HEADER } from '../superagent/host/owner-delegate.ts'
import type { NodeOps } from '../superagent/host/node-ops.ts'

/** A base64 tarball of up to ~30 MB. */
export const MAX_NODE_OPS_BODY_BYTES = 40_000_000

interface NodeOpsFaceDeps {
  readonly ctx: Context
  readonly controlRoute: (fn: (req: IncomingMessage, res: ServerResponse) => void) => (req: IncomingMessage, res: ServerResponse) => void
  readonly readJsonBody: (req: IncomingMessage, res: ServerResponse, use: (body: { id?: unknown; name?: unknown; action?: unknown }) => void, maxBytes?: number) => void
  readonly ops: NodeOps
  /** Ask this node to restart; the tests replace the loopback call. */
  readonly restart?: (port: number) => Promise<Record<string, unknown>>
}

/**
 * Ask this node's dsh-simple-restart route to restart it, the way a same-origin browser on this machine would.
 * @param port - the port this host serves on.
 * @returns the route's answer, with its HTTP status.
 */
export async function loopbackRestart(port: number): Promise<Record<string, unknown>> {
  const origin = `http://127.0.0.1:${String(port)}`
  try {
    const res = await fetch(`${origin}/dsh-simple-restart/api/restart`, { method: 'POST', headers: { origin } })
    if (res.status === 404) return { ok: false, status: 404, code: 'restart-unavailable', error: 'this node has no dsh-simple-restart plugin' }
    let body: Record<string, unknown> = {}
    try { body = await res.json() as Record<string, unknown> } catch { /* answered without JSON */ }
    return { ...body, ok: res.status === 202, status: res.status }
  } catch (error) {
    return { ok: false, code: 'restart-unreachable', error: `the restart route did not answer on ${origin}: ${String(error)}` }
  }
}

/**
 * Register the node operations face.
 * @param server - the host's web server.
 * @param d - what the face needs.
 */
export function registerNodeOpsFace(server: WebServer, d: NodeOpsFaceDeps): void {
  const restart = d.restart ?? loopbackRestart
  d.ctx.effect(() => server.register({
    kind: 'exact',
    path: '/__dsh_a2a/node-ops',
    handler: d.controlRoute((req, res) => {
      const send = (status: number, value: unknown): void => { const payload = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }); res.end(payload) }
      if (req.method === 'GET') { send(200, d.ops.status()); return }
      if (req.method !== 'POST') { send(405, { ok: false, error: 'GET status or POST an operation' }); return }
      let connection: unknown
      try { connection = d.ctx.get('connection') } catch { /* refused below */ }
      const proof = browserOwnerProof(connection, req)
      if (!proof.ok) { send(proof.status, proof); return }
      const who = req.headers[OWNER_DELEGATE_HEADER] !== undefined ? 'delegate' : 'owner'
      const port = req.socket.localPort ?? 0
      d.readJsonBody(req, res, (body) => {
        const f = body as Record<string, unknown>
        const thenRestart = async (out: Record<string, unknown>): Promise<void> => {
          if (out.ok !== true || f.restart !== true) { send(200, out); return }
          const answer = await restart(port)
          d.ops.logRestart(who, answer)
          send(200, { ...out, restart: answer })
        }
        // #898 review P2: an unexpected failure still answers the request instead of leaving it hanging.
        const failed = (error: unknown): void => { try { send(500, { ok: false, code: 'failed', error: String((error as Error)?.message ?? error) }) } catch { /* already answered */ } }
        if (f.action === 'install') {
          if (typeof f.tgz !== 'string' || typeof f.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(f.sha256)) { send(400, { ok: false, code: 'input', error: 'install takes tgz (base64) and sha256 (hex)' }); return }
          void thenRestart(d.ops.install(Buffer.from(f.tgz, 'base64'), f.sha256, who, f.forceDeps === true)).catch(failed)
          return
        }
        if (f.action === 'rollback') {
          if (f.id !== undefined && typeof f.id !== 'string') { send(400, { ok: false, code: 'input', error: 'id must be a backup id' }); return }
          void thenRestart(d.ops.rollback(who, f.id)).catch(failed)
          return
        }
        if (f.action === 'restart') {
          void restart(port).then((answer) => { d.ops.logRestart(who, answer); send(200, answer) }).catch(failed)
          return
        }
        send(400, { ok: false, code: 'input', error: 'action must be install, rollback or restart' })
      }, MAX_NODE_OPS_BODY_BYTES)
    }),
  }), 'a2a: owner node operations')
}
