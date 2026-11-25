/**
 * `/__dsh_a2a/superagent/builder` (#903 S1): the owner's user scope reaches this host's team builders. S1 is read-only:
 * `view=inventory` is the builder's own inventory (`orgInventory`: named fields only, never credentials, admission lists,
 * MCP servers, tool grants, GitHub settings or file paths), `view=builders` lists the builder sessions. Both need the
 * control key and the browser owner or a live owner delegate, like every user-scope read that shows rule text.
 * @module @nelsonlongxiang/dsh-open-a2a-net/faces/builder
 */
import type { Context } from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { browserOwnerProof } from '../superagent/host/owner-proof.ts'
import { builderSessions, orgInventory, type InventoryInput } from '../superagent/host/builder-tools.ts'

interface BuilderFaceDeps {
  readonly ctx: Context
  readonly controlRoute: (fn: (req: IncomingMessage, res: ServerResponse) => void) => (req: IncomingMessage, res: ServerResponse) => void
  readonly inventory: () => InventoryInput
  /**
   * #906 review B2: the builder sessions — loaded ones running the builder preset, and the ones the host noted earlier
   * that are not loaded now (`live: false`); a session holding a team role is never one.
   */
  readonly roster: () => ReadonlyArray<{ readonly id: string; readonly live: boolean; readonly joined: boolean; readonly seenAt?: string }>
}

/**
 * Register the builder face.
 * @param server - the host's web server.
 * @param d - what the face needs.
 */
export function registerBuilderFace(server: WebServer, d: BuilderFaceDeps): void {
  d.ctx.effect(() => server.register({
    kind: 'exact',
    path: '/__dsh_a2a/superagent/builder',
    handler: d.controlRoute((req, res) => {
      const send = (status: number, value: unknown): void => { const payload = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }); res.end(payload) }
      if (req.method !== 'GET') { send(405, { ok: false, error: 'S1 is read-only: GET ?view=inventory or ?view=builders' }); return }
      let connection: unknown
      try { connection = d.ctx.get('connection') } catch { /* refused below */ }
      const proof = browserOwnerProof(connection, req)
      if (!proof.ok) { send(proof.status, proof); return }
      const view = new URL(req.url ?? '/', 'http://x').searchParams.get('view') ?? 'inventory'
      if (view === 'inventory') { send(200, { ok: true, ...orgInventory(d.inventory()) }); return }
      if (view === 'builders') {
        const inventory = d.inventory()
        const roster = d.roster()
        const seen = new Map(roster.map(row => [row.id, row.seenAt]))
        send(200, { ok: true, builders: builderSessions({ sessions: roster, isBuilder: () => true, nameOf: inventory.nameOf, staffing: inventory.staffing as never }).map(row => ({ ...row, ...(seen.get(row.session) !== undefined ? { seenAt: seen.get(row.session) } : {}) })) })
        return
      }
      send(400, { ok: false, code: 'view', error: 'view must be inventory or builders' })
    }),
  }), 'a2a: owner user scope — team builders (read-only)')
}
