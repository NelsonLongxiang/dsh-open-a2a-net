/**
 * docs/design/superagent-team-mcp.md M1–M3, as the owner settled it on 2026-11-13: a team's MCP servers are team settings, and
 * the host calls them for its members with a short-lived token per seat, exchanged with the market under the node key
 * (./seat-token.ts). Tokens live only in this process's memory; a member never holds one, and there is no long-lived token
 * to fall back to: when no seat token can be had, the call fails with that reason.
 *
 * Why memory only: team sessions run under the host's own system user (owner 2026-11-12), so a member can read every file,
 * log and environment that user can read. The host process's memory is the one place left; reading another process's
 * memory needs debugger rights, and the credential-access audit records attempts.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/team-mcp
 */
import { SeatTokenError, SeatTokens, type SeatSigner, type SeatTokenFetch } from './seat-token.ts'

/** One MCP server of a team (M1). The token is never part of it. */
export interface TeamMcpServer {
  readonly name: string
  readonly url: string
  readonly transport: 'streamable-http'
  /** The tools members may call; absent: every tool the server offers. */
  readonly tools?: readonly string[]
}

export const MCP_SERVERS_MAX = 4
export const MCP_TOOLS_MAX = 64
/** A call's result as members get it, at most this many characters (M2: 64 KiB). */
export const MCP_RESULT_CAP = 64 * 1024
const NAME = /^[a-z0-9-]{1,16}$/
const TOOL = /^[A-Za-z0-9_.:-]{1,64}$/

/**
 * The owner's `mcp` write: `null` or `''` clears, an array replaces. A server's URL is http(s), carries no user or password
 * (the token is entered apart), and no query that looks like a credential.
 */
export function parseMcpServers(raw: unknown): { ok: true; servers: readonly TeamMcpServer[] | undefined } | { ok: false; error: string } {
  if (raw === null || raw === '') return { ok: true, servers: undefined }
  if (!Array.isArray(raw)) return { ok: false, error: 'mcp is a list of servers: { name, url, transport: "streamable-http", tools? }' }
  if (raw.length > MCP_SERVERS_MAX) return { ok: false, error: `mcp holds at most ${String(MCP_SERVERS_MAX)} servers` }
  const out: TeamMcpServer[] = []
  for (const [index, entry] of raw.entries()) {
    const where = `mcp[${String(index)}]`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, error: `${where} is an object` }
    const e = entry as Record<string, unknown>
    if (typeof e.name !== 'string' || !NAME.test(e.name)) return { ok: false, error: `${where}.name is 1–16 of a-z, 0-9 and -` }
    if (e.name === 'ygl') return { ok: false, error: `${where}.name: ygl is the team's memory, mounted by the presets` }
    if (out.some(s => s.name === e.name)) return { ok: false, error: `${where}.name ${e.name} is used twice` }
    let url: URL
    try { url = new URL(String(e.url)) } catch { return { ok: false, error: `${where}.url is not a URL` } }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, error: `${where}.url is http or https` }
    if (url.username !== '' || url.password !== '') return { ok: false, error: `${where}.url carries no user or password: the host exchanges a seat token for each call` }
    if ([...url.searchParams.keys()].some(key => /token|key|secret|auth|password/i.test(key))) return { ok: false, error: `${where}.url carries no credential in its query: the host exchanges a seat token for each call` }
    if (e.transport !== undefined && e.transport !== 'streamable-http') return { ok: false, error: `${where}.transport is streamable-http` }
    const list = (value: unknown, key: string): readonly string[] | undefined | string => {
      if (value === undefined) return undefined
      if (!Array.isArray(value) || value.length > MCP_TOOLS_MAX || value.some(t => typeof t !== 'string' || !TOOL.test(t))) return `${where}.${key} is a list of at most ${String(MCP_TOOLS_MAX)} tool names`
      return [...new Set(value as string[])]
    }
    if (e.routerTools !== undefined) return { ok: false, error: `${where}.routerTools: the router gets no team MCP tools yet (members only in this version)` }
    const tools = list(e.tools, 'tools')
    if (typeof tools === 'string') return { ok: false, error: tools }
    out.push({ name: e.name, url: url.toString(), transport: 'streamable-http', ...(tools !== undefined ? { tools } : {}) })
  }
  return { ok: true, servers: out.length > 0 ? out : undefined }
}

/** A server's state for the team page and health: tools read, no seat to read them as, or no token to be had. */
export type McpServerState = 'ready' | 'no-seat' | 'unavailable'

/** One call, as recorded on the team (M2): never the arguments or the result. */
export interface McpCallRecord { readonly at: string; readonly server: string; readonly tool: string; readonly by: string; readonly seatId?: string; readonly ticketId?: string; readonly size: number; readonly outcome: 'ok' | 'error' | 'token-refused' | 'token-unavailable' | 'refused' }

/** A JSON-RPC exchange with one server; the default sends HTTP. Injected in tests. */
export type McpTransport = (url: string, headers: Record<string, string>, body: string, signal: AbortSignal) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>

const PROTOCOL = '2025-06-18'
const TIMEOUT_MS = 30_000
const RECORDS_KEPT = 200

export class McpError extends Error {
  constructor(readonly code: 'token-unavailable' | 'token-refused' | 'no-seat' | 'unknown-server' | 'not-allowed' | 'changed' | 'authority' | 'server', message: string) { super(message) }
}

/** The text of a streamable-HTTP answer: plain JSON, or the `data:` lines of an event stream; the message with `id`. */
export function readRpc(text: string, contentType: string | null, id: number): Record<string, unknown> {
  const messages: unknown[] = []
  if ((contentType ?? '').includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
      if (data !== '') try { messages.push(JSON.parse(data)) } catch { /* a non-JSON event is not an answer */ }
    }
  } else messages.push(JSON.parse(text))
  const flat = messages.flatMap(m => Array.isArray(m) ? m : [m]) as Array<Record<string, unknown>>
  const answer = flat.find(m => m !== null && typeof m === 'object' && m.id === id)
  if (answer === undefined) throw new McpError('server', 'the server sent no answer to the request')
  return answer
}

/** Clip a call result to the cap, as text: members get at most 64 KiB, and the size it really was. */
export function clipResult(result: unknown): { text: string; size: number; clipped: boolean } {
  const text = JSON.stringify(result) ?? 'null'
  return text.length > MCP_RESULT_CAP ? { text: text.slice(0, MCP_RESULT_CAP), size: text.length, clipped: true } : { text, size: text.length, clipped: false }
}

export interface TeamMcpDeps {
  readonly servers: () => readonly TeamMcpServer[]
  readonly now: () => string
  /** The node's identity at the market, to sign seat-token exchanges with the node key (absent: no token can be had). */
  readonly signer?: SeatSigner
  /** A seat id of this team the server's tool list is read as (a member's); undefined while the team has none. */
  readonly catalogSeat: () => string | undefined
  /** The tools members may call changed (a list read): the host re-registers them. */
  readonly toolsChanged?: () => void
  readonly transport?: McpTransport
  readonly tokenFetch?: SeatTokenFetch
  readonly nowMs?: () => number
}

/** One tool of a team MCP server, as its list gave it. */
export interface McpToolInfo { readonly name: string; readonly description?: string; readonly inputSchema?: unknown }

const SEP = '\u0000'

/**
 * The caller's authority for one call, checked live (#690 re-review R1): undefined while it holds, else the refusal. A
 * request already sent when it stops holding is not taken back (the server may have acted); one not yet sent never goes.
 */
export type Guard = () => McpError | undefined

/** The team's MCP side: seat tokens in memory, one session per server and seat, calls and their records. */
export class TeamMcp {
  /** Each server's seat tokens, bound to the market origin they were exchanged with (a changed URL starts afresh). */
  private readonly tokens = new Map<string, { origin: string; seats: SeatTokens }>()
  private readonly sessions = new Map<string, string>()
  /** Each server's tool list as last read (names, descriptions, input schemas). */
  private readonly catalog = new Map<string, McpToolInfo[]>()
  private readonly problems = new Map<string, string>()
  /** The full URL each server's sessions and tool list belong to: a changed endpoint, even on the same origin, starts them afresh. */
  private readonly endpoints = new Map<string, string>()
  /** Per server, the seats whose token was refused or could not be had at a call, and why (cleared when that seat works again). */
  private readonly faults = new Map<string, Map<string, string>>()
  private readonly records: McpCallRecord[] = []
  private nextId = 1

  constructor(private readonly d: TeamMcpDeps) {}

  private server(name: string): TeamMcpServer {
    const server = this.d.servers().find(s => s.name === name)
    if (server === undefined) throw new McpError('unknown-server', `the team has no MCP server ${name}`)
    return server
  }

  private seatTokens(server: TeamMcpServer): SeatTokens {
    const origin = new URL(server.url).origin
    const held = this.tokens.get(server.name)
    if (held !== undefined && held.origin === origin) return held.seats
    if (this.d.signer === undefined) throw new McpError('token-unavailable', 'this host has no node key to exchange seat tokens with')
    const seats = new SeatTokens(origin, { signer: this.d.signer, ...(this.d.tokenFetch !== undefined ? { fetch: this.d.tokenFetch } : {}), ...(this.d.nowMs !== undefined ? { now: this.d.nowMs } : {}) })
    this.tokens.set(server.name, { origin, seats })
    return seats
  }

  /** Each server's state, for the team page and health (never a token). */
  status(): Array<{ name: string; url: string; state: McpServerState; problem?: string; tools?: readonly string[]; offered: number; seats: Array<{ seatId: string; expiresAt: string }>; faults?: Array<{ seatId: string; problem: string }> }> {
    this.prune()
    return this.d.servers().map(s => {
      const faults = [...(this.faults.get(s.name) ?? new Map<string, string>())].map(([seatId, problem]) => ({ seatId, problem }))
      const listed = this.catalog.has(s.name)
      // A list read once is not enough: a seat whose calls are refused makes the server not ready, so health shows it and the
      // pass keeps trying to recover it.
      const state: McpServerState = listed && faults.length === 0 ? 'ready' : !listed && this.d.catalogSeat() === undefined ? 'no-seat' : 'unavailable'
      const problem = listed ? (faults[0] !== undefined ? `seat ${faults[0].seatId}: ${faults[0].problem}` : undefined) : this.problems.get(s.name)
      return { name: s.name, url: s.url, state, ...(problem !== undefined && state !== 'ready' ? { problem } : {}), ...(s.tools !== undefined ? { tools: s.tools } : {}), offered: this.offered(s.name).length, seats: this.tokens.get(s.name)?.seats.status() ?? [], ...(faults.length > 0 ? { faults } : {}) }
    })
  }

  /** The server's tools members may call, as last listed (empty until the list was read with a seat token). */
  offered(name: string): readonly McpToolInfo[] {
    const server = this.d.servers().find(s => s.name === name)
    if (server === undefined) return []
    return (this.catalog.get(name) ?? []).filter(t => server.tools === undefined || server.tools.includes(t.name))
  }

  /** Read every server's tool list again (the team's servers or seats changed). */
  async refreshAll(): Promise<void> {
    for (const s of this.d.servers()) {
      await this.refreshTools(s.name)
      await this.recoverSeats(s.name)
    }
  }

  /** Exchange again for each seat whose calls failed on its token; a seat that gets one is no longer faulted. */
  private async recoverSeats(name: string): Promise<void> {
    const faulted = this.faults.get(name)
    if (faulted === undefined) return
    const server = this.d.servers().find(s => s.name === name)
    if (server === undefined) return
    for (const seat of [...faulted.keys()]) {
      try { await this.token(server, seat); this.clearFault(name, seat) } catch (error) { faulted.set(seat, String(error instanceof Error ? error.message : error).slice(0, 300)) }
    }
    this.d.toolsChanged?.()
  }

  private setFault(name: string, seat: string, problem: string): void {
    const held = this.faults.get(name) ?? new Map<string, string>()
    held.set(seat, problem.slice(0, 300))
    this.faults.set(name, held)
  }

  private clearFault(name: string, seat: string): void {
    const held = this.faults.get(name)
    if (held === undefined) return
    held.delete(seat)
    if (held.size === 0) this.faults.delete(name)
  }

  /** Read a server's tool list again, as one of the team's seats; the host then registers them as tools. */
  async refreshTools(name: string): Promise<void> {
    const seat = this.d.catalogSeat()
    try {
      const server = this.server(name)
      if (seat === undefined) throw new McpError('no-seat', "the team has no member with a seat id yet: the market issues tokens to seats in this host's roster")
      const result = await this.call(server, 'tools/list', {}, seat)
      this.stillCurrent(server)
      const tools = Array.isArray(result.tools) ? result.tools as Array<Record<string, unknown>> : []
      this.endpoints.set(name, server.url)
      this.catalog.set(name, tools.filter(t => typeof t.name === 'string' && TOOL.test(t.name)).map(t => ({ name: t.name as string, ...(typeof t.description === 'string' ? { description: t.description.slice(0, 1_000) } : {}), ...(t.inputSchema !== undefined ? { inputSchema: t.inputSchema } : {}) })))
      this.problems.delete(name)
      this.clearFault(name, seat)
    } catch (error) {
      this.catalog.delete(name)
      this.problems.set(name, String(error instanceof Error ? error.message : error).slice(0, 300))
    }
    this.d.toolsChanged?.()
  }

  /** The last calls, newest last: who, which tool, size and outcome. */
  calls(): readonly McpCallRecord[] { return this.records }

  /** Forget the tokens, sessions and lists of servers the owner removed, or whose URL changed (a token is never sent elsewhere). */
  prune(): void {
    const servers = this.d.servers()
    const names = new Set(servers.map(s => s.name))
    const forget = (name: string): void => {
      this.catalog.delete(name); this.problems.delete(name); this.faults.delete(name); this.endpoints.delete(name)
      for (const key of [...this.sessions.keys()]) if (key.startsWith(`${name}${SEP}`)) this.sessions.delete(key)
    }
    for (const [name, held] of [...this.tokens.entries()]) {
      const server = servers.find(s => s.name === name)
      if (server === undefined || new URL(server.url).origin !== held.origin) { this.tokens.delete(name); forget(name) }
    }
    // Sessions and the tool list belong to one endpoint: a new path or port on the same origin keeps the tokens (they are the
    // market's, by origin) but nothing the old endpoint said.
    for (const [name, url] of [...this.endpoints.entries()]) {
      const server = servers.find(s => s.name === name)
      if (server === undefined || server.url !== url) forget(name)
    }
    for (const name of [...this.faults.keys()]) if (!names.has(name)) this.faults.delete(name)
    for (const name of [...this.catalog.keys()]) if (!names.has(name)) this.catalog.delete(name)
    for (const key of [...this.sessions.keys()]) if (!names.has(key.split(SEP)[0] ?? '')) this.sessions.delete(key)
  }

  private record(row: McpCallRecord): void {
    this.records.push(row)
    if (this.records.length > RECORDS_KEPT) this.records.splice(0, this.records.length - RECORDS_KEPT)
  }

  private async token(server: TeamMcpServer, seat: string): Promise<string> {
    try { return await this.seatTokens(server).tokenFor(seat) } catch (error) {
      if (error instanceof SeatTokenError) throw new McpError(error.code === 'no-seat' ? 'no-seat' : 'token-unavailable', `no ${server.name} token for seat ${seat}: ${error.message}`)
      throw error
    }
  }

  /** A server's whole configuration as the owner saved it: name, endpoint and allowed tools. */
  private configOf(server: TeamMcpServer): string { return JSON.stringify([server.name, server.url, server.transport, server.tools ?? null]) }

  /**
   * #690 re-review F4: the server a request is about to go to is still the one this call started with — same endpoint, same
   * allowed tools, still configured. Checked after every wait and before anything is sent or written back, so a removed or
   * changed server gets nothing more from a call that began under the old configuration.
   */
  private stillCurrent(server: TeamMcpServer): void {
    const live = this.d.servers().find(s => s.name === server.name)
    if (live === undefined || this.configOf(live) !== this.configOf(server)) throw new McpError('changed', `the team's MCP server ${server.name} was changed or removed while this call waited; nothing more was sent to it`)
  }

  /** The caller's live authority (#690 re-review R1): refused with nothing sent when it no longer holds. */
  private stillAuthorized(guard: Guard | undefined): void {
    const refused = guard?.()
    if (refused !== undefined) throw refused
  }

  private async rpc(server: TeamMcpServer, method: string, params: unknown, seat: string, notify = false, guard?: Guard): Promise<Record<string, unknown>> {
    this.prune()
    this.stillCurrent(server)
    this.stillAuthorized(guard)
    const token = await this.token(server, seat)
    // After the credential wait, immediately before sending: the server and the caller's authority are both still current.
    this.stillCurrent(server)
    this.stillAuthorized(guard)
    const key = `${server.name}${SEP}${seat}`
    if (!this.endpoints.has(server.name)) this.endpoints.set(server.name, server.url)
    const id = this.nextId++
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, 'mcp-protocol-version': PROTOCOL }
    const session = this.sessions.get(key)
    if (session !== undefined) headers['mcp-session-id'] = session
    // M4: the seat as the host states it; the market records it for reconciliation only (the token names the seat).
    headers['x-team-seat'] = seat
    const body = JSON.stringify(notify ? { jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) } : { jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) })
    const send: McpTransport = this.d.transport ?? (async (url, h, b, signal) => await fetch(url, { method: 'POST', headers: h, body: b, signal, redirect: 'error' }))
    const response = await send(server.url, headers, body, AbortSignal.timeout(TIMEOUT_MS))
    // The answer of a server changed meanwhile is not written back (no session, no result).
    this.stillCurrent(server)
    if (response.status === 401 || response.status === 403) {
      // The market checks every call (host active, key pinned, seat in the roster, not revoked): this token is done.
      this.seatTokens(server).drop(seat)
      this.sessions.delete(key)
      throw new McpError('token-refused', `${server.name} refused seat ${seat}'s token (${String(response.status)})`)
    }
    if (response.status === 404 && session !== undefined) {
      // The server forgot the session: start a new one once.
      this.sessions.delete(key)
      throw new McpError('server', 'session-expired')
    }
    const fresh = response.headers.get('mcp-session-id')
    if (fresh !== null && fresh !== '') this.sessions.set(key, fresh)
    if (notify) return {}
    if (response.status < 200 || response.status >= 300) throw new McpError('server', `${server.name} answered HTTP ${String(response.status)}`)
    const answer = readRpc(await response.text(), response.headers.get('content-type'), id)
    if (answer.error !== undefined) {
      const err = answer.error as { message?: unknown }
      throw new McpError('server', `${server.name}: ${typeof err.message === 'string' ? err.message.slice(0, 300) : 'error'}`)
    }
    return (answer.result ?? {}) as Record<string, unknown>
  }

  private async ensureSession(server: TeamMcpServer, seat: string, guard?: Guard): Promise<void> {
    // Prune before deciding: a session of an endpoint the owner since changed is gone first, so a new endpoint is initialized.
    this.prune()
    if (this.sessions.has(`${server.name}${SEP}${seat}`)) return
    await this.rpc(server, 'initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'dsh-open-a2a-net-team-host', version: '1' } }, seat, false, guard)
    await this.rpc(server, 'notifications/initialized', undefined, seat, true, guard)
  }

  /** One request as a seat: a forgotten session starts again once; a refused token is exchanged again once. */
  private async call(server: TeamMcpServer, method: string, params: unknown, seat: string, guard?: Guard): Promise<Record<string, unknown>> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.ensureSession(server, seat, guard)
        return await this.rpc(server, method, params, seat, false, guard)
      } catch (error) {
        const again = error instanceof McpError && (error.message === 'session-expired' || error.code === 'token-refused')
        if (!again || attempt >= 1) throw error
      }
    }
  }

  private allowed(server: TeamMcpServer): (tool: string) => boolean {
    return tool => server.tools === undefined || server.tools.includes(tool)
  }

  /** M2: one tool call as the member's seat, for its running ticket; recorded without arguments or result. */
  async callTool(name: string, tool: string, args: Record<string, unknown>, who: { by: string; seat?: string; ticketId?: string; authority?: Guard }): Promise<{ text: string; size: number; clipped: boolean; isError: boolean }> {
    const at = this.d.now()
    const base = { at, server: name, tool, by: who.by, ...(who.seat !== undefined ? { seatId: who.seat } : {}), ...(who.ticketId !== undefined ? { ticketId: who.ticketId } : {}) }
    let server: TeamMcpServer
    try { server = this.server(name) } catch (error) { this.record({ ...base, size: 0, outcome: 'refused' }); throw error }
    if (!this.allowed(server)(tool)) {
      this.record({ ...base, size: 0, outcome: 'refused' })
      throw new McpError('not-allowed', `${tool} is not among ${name}'s tools the owner allowed`)
    }
    if (who.seat === undefined) {
      this.record({ ...base, size: 0, outcome: 'refused' })
      throw new McpError('no-seat', "you have no seat id yet: the market issues tokens to seats in this host's roster")
    }
    try {
      const result = await this.call(server, 'tools/call', { name: tool, arguments: args }, who.seat, who.authority)
      const clipped = clipResult(result)
      const isError = result.isError === true
      this.clearFault(name, who.seat)
      this.record({ ...base, size: clipped.size, outcome: isError ? 'error' : 'ok' })
      return { ...clipped, isError }
    } catch (error) {
      const tokenFault = error instanceof McpError && (error.code === 'token-refused' || error.code === 'token-unavailable')
      if (tokenFault) { this.setFault(name, who.seat, error.message); this.d.toolsChanged?.() }
      this.record({ ...base, size: 0, outcome: tokenFault ? error.code as 'token-refused' | 'token-unavailable' : error instanceof McpError && (error.code === 'authority' || error.code === 'changed') ? 'refused' : 'error' })
      throw error
    }
  }
}
