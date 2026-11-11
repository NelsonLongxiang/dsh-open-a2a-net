/**
 * superagent's HTTP faces (moved out of src/index.ts for the #77 / #570 line ratchet): the owner's control route, the two
 * signed host-to-host faces, decision cards and their files, the model catalog, and the instance's teams. Behaviour is
 * unchanged; what the faces need from the host's closure comes in as {@link SuperagentFaceDeps}.
 * @module @nelsonlongxiang/dsh-open-a2a-net/faces/superagent
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type WebServer from '@deepseek-ai/dsh-host-webserver'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Config } from '../index.ts'
import type { A2aPeerCard } from '../types.ts'
import type { CardCacheEntry } from '../runtime.ts'
import type { OriginClaimVerdict } from '../origin-claim.ts'
import type { PeerStore } from '../peer-store.ts'
import type { JoinedSessions } from '../joined-store.ts'
import type { BlobStore } from '../blob-store.ts'
import type { SuperagentHost } from '../superagent/host/index.ts'
import type { SuperagentTeams } from '../superagent/host/teams.ts'
import { verifyCard } from '../card.ts'
import { claimCovers } from '../task-auth.ts'
import { guiOwnerProven, ownerOrNoLogin, touchesRules } from '../superagent/host/owner-proof.ts'
import { canvasOwnerFingerprint, splitCanvasOwner } from '../canvas-id.ts'

/** What the superagent faces need from the host's closure. */
export interface SuperagentFaceDeps {
  readonly ctx: Context
  readonly config: Config
  readonly superagentHost: SuperagentHost
  readonly superagentTeams: SuperagentTeams
  /** This host's own base URL for the owner-proof probe; it is known only once the web server has settled. */
  readonly homeUrl: () => string | undefined
  readonly controlRoute: (handler: (req: IncomingMessage, res: ServerResponse) => void) => (req: IncomingMessage, res: ServerResponse) => void
  readonly readJsonBody: (req: IncomingMessage, res: ServerResponse, use: (body: { readonly id?: unknown; readonly name?: unknown; readonly action?: unknown }) => void, maxBytes?: number) => void
  readonly recordActivity: (dir: 'in' | 'out' | 'fwd', team: string, peer: string, ok: boolean) => void
  readonly routeTrunk: (args: { team: string; message: string; context_id?: string; async?: boolean }, agent: Agent | undefined, signal: AbortSignal) => Promise<Record<string, unknown>>
  readonly sessionNodes: ReadonlyMap<string, Agent>
  readonly sessionPresetOf: (id: string) => string | undefined
  readonly sessionTeamOf: (agent: Agent) => string
  readonly joinedSessions: Pick<JoinedSessions, 'has'>
  readonly archivedSessionFilter: () => ((id: string) => boolean) | undefined
  readonly verifyOriginClaim: (req: IncomingMessage, options?: { readonly cli?: boolean; readonly rawBody?: Uint8Array }) => Promise<OriginClaimVerdict>
  readonly fetchPeerCard: (peer: string) => Promise<A2aPeerCard | undefined>
  readonly peerStore: Pick<PeerStore, 'list'>
  /** Written too: a remote team found while adding one is cached like any peer card. */
  readonly cardCache: Map<string, CardCacheEntry>
  readonly ownCanvasFingerprint: string
  readonly peerAdmissionLinkState: (peerUrl: string) => { link: 'linked' | 'stranger'; verified: boolean }
  readonly blobStore: BlobStore
}

/**
 * Register every superagent face on the settled web server.
 * @param webServer - the host's web server.
 * @param d - what the faces need from the host.
 */
export function registerSuperagentFaces(webServer: WebServer, d: SuperagentFaceDeps): void {
  const { ctx, config, superagentHost, superagentTeams, homeUrl, controlRoute, readJsonBody, recordActivity, routeTrunk, sessionNodes, sessionPresetOf, sessionTeamOf, joinedSessions, archivedSessionFilter, verifyOriginClaim, fetchPeerCard, peerStore, cardCache, ownCanvasFingerprint, peerAdmissionLinkState, blobStore } = d
  {
    // superagent design v4, PR-B: the owner's workbench face of the engine (owner control route only).
    // GET: the engine state; POST: settings (router, allowed senders, Sources, pause), request (the workbench Source),
    // stop / retry a ticket (upstream's people commands).
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/superagent',
      handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
        const send = (status: number, value: unknown): void => { const payload = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }); res.end(payload) }
        if (req.method === 'GET') {
          const params = new URL(req.url ?? '/', 'http://x').searchParams
          const asked = superagentTeams!.get(params.get('teamId') ?? undefined)
          if (asked === undefined) { send(404, { ok: false, error: 'no such team on this instance' }); return }
          // The team page's 搜索: this team's records only, like the state it reads.
          const search = params.get('search')
          if (search !== null) { send(200, asked.search(search)); return }
          send(200, asked.state())
          return
        }
        readJsonBody(req, res, (body) => {
          const fields = body as Record<string, unknown>
          const sa = superagentTeams!.get(typeof fields.teamId === 'string' ? fields.teamId : undefined)
          if (sa === undefined) { send(404, { ok: false, error: 'no such team on this instance' }); return }
          try {
            if (fields.action === 'settings') {
              const save = (): void => { send(200, sa.saveSettings(fields.settings, id => joinedSessions.has(id) && archivedSessionFilter()?.(id) !== true, sessionPresetOf, 'owner')) }
              // A shell on this machine passes the control route; a rule change needs what only the owner's browser holds (design D10).
              if (!touchesRules(fields.settings)) { save(); return }
              void guiOwnerProven(homeUrl(), req.headers.cookie).then(proven => {
                if (proven) { save(); return }
                send(403, { ok: false, code: 'owner-proof', error: '修改规则需要在已登录的 DSH 界面里操作，这个请求没有登录凭据。也可以直接在对话里让总工或成员修改。' })
              }, (error: unknown) => { send(500, { ok: false, error: String(error) }) })
              return
            } else if (fields.action === 'sync-github-allowed') {
              // Design github-issues G6, G7: add the repositories' collaborators with push access to allowed.github; owner only.
              void guiOwnerProven(homeUrl(), req.headers.cookie).then(async (proven) => {
                if (!proven) { send(403, { ok: false, code: 'owner-proof', error: '同步 GitHub 名单需要在已登录的 DSH 界面里操作。' }); return }
                const found = await sa.githubCollaborators()
                if (!found.ok) { send(200, found); return }
                const before = sa.settings.allowed.github ?? []
                const added = found.logins.filter(login => !before.some(a => a.toLowerCase() === login.toLowerCase()))
                if (added.length === 0) { send(200, { ok: true, added: [], allowed: before }); return }
                const saved = sa.saveSettings({ allowed: { github: [...before, ...added] } }, id => joinedSessions.has(id) && archivedSessionFilter()?.(id) !== true, sessionPresetOf, 'owner')
                send(200, saved.ok ? { ok: true, added, allowed: saved.settings.allowed.github } : saved)
              }).catch((error: unknown) => { send(500, { ok: false, error: String(error) }) })
              return
            } else if (fields.action === 'request') {
              send(200, sa.request(typeof fields.text === 'string' ? fields.text : '', typeof fields.thread === 'string' ? fields.thread : undefined, fields.via === 'cli' ? 'cli' : undefined))
            } else if (fields.action === 'answer') {
              send(200, sa.answer(typeof fields.ticket_id === 'string' ? fields.ticket_id : '', typeof fields.text === 'string' ? fields.text : ''))
            } else if (fields.action === 'add-remote-member' || fields.action === 'remove-remote-member') {
              // Design v5: a remote member is a remote slot of the bound canvas team — added on the canvas, which pins its key.
              send(200, { ok: false, error: 'the team is a canvas team: add or remove a remote member on the canvas (/__dsh_a2a/canvas add-member / remove-member)' })
            } else if (fields.action === 'serve-team') {
              // Design v5 (D4): a team is served by its canvas id, which names its owner by key fingerprint.
              send(200, { ok: false, error: "serve a team by its canvas id: POST { action: 'serve', team: '<zone>/canvas/<name>@<fp8>', members: [<local session ids>] } (team: null leaves)" })
            } else if (fields.action === 'serve') {
              // Design v5 (D4): serve another host's team — the canvas team `<zone>/canvas/<name>@<fp8>`. The fingerprint picks
              // the linked peer whose signed card key it names and which advertises that canvas; that key is pinned, so only it
              // may assign these sessions work. null leaves. The member host's owner consents here; the team host cannot
              // take another host's sessions on its own (U17).
              if (fields.team === null) { send(200, sa.serveTeam(undefined, [], () => false)); return }
              const team = typeof fields.team === 'string' ? fields.team.trim() : ''
              const members = Array.isArray(fields.members) ? fields.members.filter((m): m is string => typeof m === 'string') : []
              void (async () => {
                const split = splitCanvasOwner(team)
                if (split.owner === undefined || !/^[^/\s]+\/canvas\/[^/\s]+$/.test(split.team)) { send(200, { ok: false, error: 'team must be a canvas id with its owner: <zone>/canvas/<name>@<fp8>' }); return }
                if (split.owner === ownCanvasFingerprint) { send(200, { ok: false, error: "that canvas is this host's own: its sessions join it as members on the canvas" }); return }
                let found: { url: string; card: A2aPeerCard } | undefined
                for (const url of new Set([...peerStore.list(), ...cardCache.keys()])) {
                  const card = await fetchPeerCard(url).catch(() => undefined)
                  if (card === undefined || !verifyCard(card, Date.now()).ok || typeof card.publicKey !== 'string' || canvasOwnerFingerprint(card.publicKey) !== split.owner) continue
                  if (!(card.canvasOrg ?? []).some(entry => entry.team === split.team && entry.team === card.team + '/canvas/' + entry.name)) continue
                  found = { url, card }
                  break
                }
                if (found === undefined) { send(200, { ok: false, error: `no linked peer's signed card is the owner of ${team} (key fingerprint ${split.owner}) and advertises it` }); return }
                // The link judgement reads the cached card: cache the verified one first, as the canvas member proof does.
                cardCache.set(found.url, { at: Date.now(), card: found.card })
                if (peerAdmissionLinkState(found.url).link !== 'linked') { send(200, { ok: false, error: 'the team host must be a linked peer' }); return }
                send(200, sa.serveTeam({ url: new URL(found.url).origin, key: found.card.publicKey!, canvas: team }, members, id => joinedSessions.has(id) && archivedSessionFilter()?.(id) !== true, sessionPresetOf))
              })().catch(error => send(200, { ok: false, error: String(error) }))
            } else if (fields.action === 'reevaluate') {
              // Design superagent-reevaluate-note D1: the owner asks for a fresh judgement of a stored message.
              send(200, sa.reevaluate(typeof fields.trigger_id === 'string' ? fields.trigger_id : ''))
            } else if (fields.action === 'move-seat') {
              // Named dispatch N2: the owner moves a seat (its stable id) to the session that replaced its member.
              const moved = sa.named.moveSeat(typeof fields.from === 'string' ? fields.from : '', typeof fields.to === 'string' ? fields.to : '')
              sa.pass()
              send(200, moved)
            } else if (fields.action === 'stop' || fields.action === 'retry') {
              const ticketId = typeof fields.ticket_id === 'string' ? fields.ticket_id : ''
              const ticket = fields.action === 'stop'
                ? sa.engine.stopTicket(ticketId, typeof fields.reason === 'string' ? fields.reason : undefined)
                : sa.engine.retryTicket(ticketId)
              sa.pass()
              send(200, { ok: true, ticket })
            } else send(200, { ok: false, error: 'action must be settings, request, answer, serve, move-seat, stop, retry or reevaluate' })
          } catch (error) { send(200, { ok: false, error: error instanceof Error ? error.message : String(error) }) }
        }, 64_000)
      }),
    }), 'a2a: superagent control route')
    // PR-C2: the two host-to-host faces. Each takes a signed, body-bound OriginClaim and judges the signer's card key against
    // the key the owner pinned: the team host's key on a member host, the member host's key on the team host.
    const signedFace = (path: string, judge: (body: Record<string, unknown>, claim: { caller: string; key: string }) => Record<string, unknown>, label: string): void => {
      ctx.effect(() => webServer.register({
        kind: 'exact',
        path,
        handler: (req: IncomingMessage, res: ServerResponse) => {
          const send = (value: unknown): void => { const payload = JSON.stringify(value); res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }); res.end(payload) }
          if (req.method !== 'POST') { send({ ok: false, error: 'POST required' }); return }
          const chunks: Buffer[] = []
          let size = 0
          req.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= 64 * 1024) chunks.push(chunk) })
          req.on('end', () => {
            void (async () => {
              if (size > 64 * 1024) { send({ ok: false, error: 'payload too large' }); return }
              const rawBody = Buffer.concat(chunks)
              let body: Record<string, unknown>
              try { body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown> } catch { send({ ok: false, error: 'not JSON' }); return }
              const claim = await verifyOriginClaim(req, { rawBody })
              if (!claim.ok || !claim.bound || claim.bodyBound !== true || typeof claim.card.publicKey !== 'string') {
                recordActivity('in', path, String(req.headers['x-a2a-caller'] ?? 'unknown'), false)
                superagentHost.noteRefusal('superagent-untrusted-origin', { caller: String(req.headers['x-a2a-caller'] ?? 'unknown'), target: path })
                send({ ok: false, code: 'untrusted-origin', error: `a signed, body-bound OriginClaim is required (${claim.ok ? 'unbound' : claim.reason})` })
                return
              }
              const out = judge(body, { caller: claim.caller, key: claim.card.publicKey })
              recordActivity('in', path, claim.caller, out.ok === true)
              // A signer that is not the pinned key (an impostor sharing a handle) is refused by identity; a malformed body is not counted.
              if (out.ok !== true && ['not-signer', 'not-team', 'not-member'].includes(String(out.code))) superagentHost.noteRefusal(`superagent-${String(out.code)}`, { caller: claim.caller, target: path })
              send(out)
            })().catch(error => send({ ok: false, error: String(error) }))
          })
        },
      }), label)
    }
    // Design M6: each team answers only for its own members and pinned keys, so the first that does not refuse is the one.
    const firstTeam = (ask: (team: SuperagentHost) => Record<string, unknown>): Record<string, unknown> => {
      let refused: Record<string, unknown> = { ok: false, code: 'not-team', error: 'no team here' }
      for (const team of superagentTeams!.all()) { refused = ask(team); if (!['not-team', 'not-member'].includes(String(refused.code))) return refused }
      return refused
    }
    signedFace('/a2a/superagent-member', (body, claim) => firstTeam(team => team.assignedWork(body.op, body.member, claim.key, body.text)), 'a2a: superagent member face')
    signedFace('/a2a/superagent-team', (body, claim) => typeof body.member === 'string' && claimCovers(body.member, claim.caller)
      ? firstTeam(team => team.remoteEvent(body.op, body.member, claim.key, body.report))
      : { ok: false, code: 'not-signer', error: 'the signer does not speak for that member' }, 'a2a: superagent team face')
  }

  /** Design M8: the teams linked instances advertise on their cards; only a team whose A2A Source is on is advertised. */
  function linkedTeams(): Array<{ id: string; primary: false; remote: true; canvas: string; address: string; open: true; host: string }> {
    return [...cardCache.entries()].flatMap(([url, hit]) => {
      const card = hit.card
      if (card === undefined || typeof card.publicKey !== 'string' || !verifyCard(card, Date.now()).ok || peerAdmissionLinkState(url).link !== 'linked') return []
      const owner = canvasOwnerFingerprint(card.publicKey)
      return (card.canvasOrg ?? []).filter(entry => entry.superagentTeam === true && entry.team === `${card.team}/canvas/${entry.name}`)
        .map(entry => ({ id: `remote:${entry.team}@${owner}`, primary: false as const, remote: true as const, canvas: entry.name, address: `${entry.team}@${owner}`, open: true as const, host: card.name ?? new URL(url).host }))
    })
  }

  {
    // Decision cards: what waits for the owner, and their decision (C3, C5).
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/superagent/decisions',
      handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
        const send = (status: number, value: unknown): void => { const payload = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }); res.end(payload) }
        // Each card names its team's canvas address: the right bar stages the owner's files to it (C8).
        if (req.method === 'GET') { send(200, { decisions: superagentTeams.decisionCards().map(card => ({ ...card, ...(typeof card.team === 'string' && card.team !== '' ? { address: `${config.team}/canvas/${card.team}` } : {}) })), health: superagentTeams.health() }); return }
        readJsonBody(req, res, (body) => {
          const fields = body as { teamId?: unknown; id?: unknown; how?: unknown; option?: unknown; note?: unknown; files?: unknown }
          const team = superagentTeams.get(typeof fields.teamId === 'string' ? fields.teamId : undefined)
          if (team === undefined) { send(404, { ok: false, error: 'no such team on this instance' }); return }
          // A member's shell on this machine passes the control route; deciding is the owner's alone (C5).
          void ownerOrNoLogin(homeUrl(), req.headers.cookie).then((allowed) => {
            if (!allowed) { send(403, { ok: false, code: 'owner-proof', error: '决策需要在已登录的 DSH 界面里操作。' }); return }
            send(200, team.decide(typeof fields.id === 'string' ? fields.id : '', fields.how, fields.option, fields.note, fields.files))
          }, (error: unknown) => { send(500, { ok: false, error: String(error) }) })
        })
      }),
    }), 'a2a: superagent decisions face')
    // C8: a file on a card, for the owner. Only files a card names, only while the file channel still holds them (24 h).
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/superagent/decisions/file',
      handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
        const fail = (status: number, error: string): void => { const payload = JSON.stringify({ ok: false, error }); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }); res.end(payload) }
        if (req.method !== 'GET') { fail(405, 'GET only'); return }
        const query = new URL(req.url ?? '/', 'http://local').searchParams
        const team = superagentTeams.get(query.get('teamId') ?? undefined)
        const sha256 = query.get('sha256') ?? ''
        if (team === undefined || !/^[0-9a-f]{64}$/.test(sha256)) { fail(404, 'no such file on a card'); return }
        void ownerOrNoLogin(homeUrl(), req.headers.cookie).then((allowed) => {
          if (!allowed) { fail(403, '决策卡的文件需要在已登录的 DSH 界面里打开。'); return }
          const file = team.decisionFile(query.get('card') ?? '', sha256)
          if (file === undefined) { fail(404, 'no such file on a card'); return }
          const grant = blobStore.list().find(g => g.sha256 === sha256)
          const bytes = grant === undefined ? undefined : blobStore.read(grant)
          if (bytes === undefined) { fail(410, '文件已过期：文件通道只保留 24 小时。'); return }
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.byteLength, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
          res.end(bytes)
        }, (error: unknown) => { fail(500, String(error)) })
      }),
    }), 'a2a: superagent decision file face')
  }

  {
    // The models a team's roles may run (owner 2026-11-10): DSH's own catalog, proxied; the page falls back to free text.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/superagent/models',
      handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
        const send = (status: number, value: unknown): void => { const payload = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }); res.end(payload) }
        // In-process modelCatalog (review of #566): the HTTP face answers 401 without a browser cookie.
        const controller = (ctx as unknown as { get?(name: string): { modelCatalog?(request: unknown): Promise<unknown> } | undefined }).get?.('sessionController')
        if (controller?.modelCatalog === undefined) { send(200, { ok: false, code: 'no-service' }); return }
        void controller.modelCatalog({}).then(catalog => { send(200, catalog as Record<string, unknown>) }, (error: unknown) => { send(200, { ok: false, code: 'catalog', error: String(error) }) })
      }),
    }), 'a2a: superagent models face')
    // Design M3/M5: the instance's teams, and adding one.
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/__dsh_a2a/superagent/teams',
      handler: controlRoute((req: IncomingMessage, res: ServerResponse) => {
        const send = (status: number, value: unknown): void => { const payload = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }); res.end(payload) }
        if (req.method === 'GET') { send(200, { teams: [...superagentTeams.rows().map(row => ({ ...row, ...(row.canvas !== undefined ? { address: `${config.team}/canvas/${row.canvas}` } : {}) })), ...linkedTeams()] }); return }
        readJsonBody(req, res, (body) => {
          const fields = body as { canvas?: unknown; router?: unknown; action?: unknown; address?: unknown; session?: unknown; text?: unknown }
          if (fields.action === 'send') {
            // Design M9: as the session the view is open in, through the ordinary route, so every gate of a2a_route applies.
            const address = typeof fields.address === 'string' ? fields.address : '', text = typeof fields.text === 'string' ? fields.text.trim() : ''
            const agent = typeof fields.session === 'string' ? sessionNodes.get(fields.session) : undefined
            if (!linkedTeams().some(team => team.address === address)) { send(200, { ok: false, code: 'not-listed', error: 'that team is not on a linked instance, or it takes no A2A requests' }); return }
            if (text === '' || text.length > 20_000) { send(200, { ok: false, code: 'text', error: 'text is required, at most 20000 characters' }); return }
            if (agent === undefined) { send(200, { ok: false, code: 'not-joined', error: 'join this session to the A2A network first: a request to another instance is sent as this session' }); return }
            void routeTrunk({ team: address, message: text, async: true }, agent, new AbortController().signal).then((out) => { send(200, { ...out, sender: sessionTeamOf(agent) }) }, (error: unknown) => { send(200, { ok: false, error: String(error) }) })
            return
          }
          send(200, superagentTeams.add({ canvas: fields.canvas, router: fields.router }, id => joinedSessions.has(id) && archivedSessionFilter()?.(id) !== true, sessionPresetOf))
        })
      }),
    }), 'a2a: superagent teams face')
  }
}
