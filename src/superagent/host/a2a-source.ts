/**
 * superagent design v4, PR-B2b: the A2A Source, hosted by the a2a host itself.
 *
 * #402's a2a-watch (the Source written for upstream superagent) runs unchanged; this file is the upstream SourceHost /
 * SourceContext it expects, implemented over the a2a host:
 * - the team's A2A address is a CLI identity the host holds under `<a2a home>/superagent/team-cli/` (created on first
 *   start). a2a-watch keeps its deposit published (renewing before the 4h expiry) and reads its mailbox;
 * - `commands` runs the real a2a-net CLI against this very host. a2a-watch speaks the CLI's JSON contract (`inbox --after`,
 *   `admission`, `receipt`, `route`, `publish`), and running the CLI reuses that contract byte for byte instead of
 *   re-implementing it in process;
 * - `receive` hands its Triggers to the engine. A2A callers are agents (D7): `human: false`, so they enter only through the
 *   Policy's bot list and accept mode;
 * - the Outbox sends a2a Channel messages through the kind's own channel: receipts and follow-ups go back only to the
 *   original caller, after the host rechecks the caller's link.
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/host/a2a-source
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXIT_GONE, EXIT_RECEIPT_CONFLICT, HEALTH, KIND, KV, LINK_RULES, createA2aKind, replyAllowed, sendReply, watch, type A2aConfig, type ReceiptOutcome } from '../a2a-watch.ts'
import type { Commands, Health, OutboundMessage, ReceiveResult, SourceContext, TicketView, Trigger } from '../source-types.ts'

/** The packaged CLI, from both src/superagent/host and lib/superagent/host. */
export const CLI_PATH = fileURLToPath(new URL('../../../cli/a2a.mjs', import.meta.url))
/** The team identity's name; its handle is `<name>/<16 hex>`. */
export const TEAM_IDENTITY_NAME = 'superagent-team'
/** How long one CLI call may take. */
const CLI_TIMEOUT_MS = 60_000
/** Where the acknowledged tasks are kept (in a2a-source.json), and for how long and how many. */
const ACKED_KEY = 'superagent.acked'
const ACKED_TTL_MS = 8 * 86_400_000
const ACKED_CAP = 2000

export interface A2aSourceDeps {
  /** `<a2a home>/superagent`. */
  readonly dir: string
  /** This host's own base URL, once the web server listens. */
  readonly homeUrl: () => string | undefined
  /** The host's own API key (the CLI's control credential), if it has one. */
  readonly apiKey: () => string | undefined
  readonly enabled: () => boolean
  readonly receive: (trigger: Trigger) => ReceiveResult
  readonly ticket: (id: string) => TicketView | undefined
  /**
   * Whether `task` is the request a still-open ticket was accepted from, and no member report on it is ready: a reply on
   * that task then is a question or a notice, never the result the requester's formal receipt is kept for.
   */
  readonly resultPending?: (ticketId: string, task: string) => boolean
  readonly logger: { info(format: string, ...args: unknown[]): void; warn(format: string, ...args: unknown[]): void }
  /** Mailbox poll interval in seconds (a2a-watch default 15 here); tests shorten it. */
  readonly pollSeconds?: number
  /** Tests point this at a stub. */
  readonly run?: (args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal) => Promise<string>
}

/** One CLI run: stdout on exit 0, otherwise an Error carrying `exitCode` (a2a-watch reads it) and the stderr text. */
export function runCli(args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], ...(signal !== undefined ? { signal } : {}) })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), CLI_TIMEOUT_MS)
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(Object.assign(new Error(`a2a-net ${args[0] ?? ''} exited ${String(code)}: ${stderr.trim().slice(0, 400)}`), { exitCode: code ?? undefined, stdout }))
    })
  })
}

export class A2aSource {
  private readonly identityDir: string
  private readonly statePath: string
  private stateValue: Record<string, unknown>
  private readonly healthValue = new Map<string, Health>()
  private readonly kindValue = createA2aKind(() => this.context)
  private controller: AbortController | undefined
  private loop: Promise<void> | undefined
  readonly context: SourceContext

  constructor(private readonly d: A2aSourceDeps) {
    this.identityDir = join(d.dir, 'team-cli')
    this.statePath = join(d.dir, 'a2a-source.json')
    this.stateValue = this.loadState()
    const self = this
    this.context = {
      commands: this.commands(),
      ready: Promise.resolve(),
      configured: () => true,
      config: <C extends Record<string, unknown>>(kind: string): C | undefined =>
        (kind === KIND && d.enabled() ? ({ mode: 'reply', pollSeconds: d.pollSeconds ?? 15, renewMinutes: 60 } satisfies A2aConfig) as unknown as C : undefined),
      receive: trigger => d.receive(trigger),
      state: {
        get: <V>(key: string): V | undefined => self.stateValue[key] as V | undefined,
        set: <V>(key: string, value: V | undefined): void => {
          if (value === undefined) delete self.stateValue[key]
          else self.stateValue[key] = value
          self.saveState()
        },
      },
      threads: { describe: () => {} },
      tickets: { get: id => d.ticket(id) },
      report: (entry, health) => { self.healthValue.set(entry, health) },
    }
  }

  private loadState(): Record<string, unknown> {
    try { return existsSync(this.statePath) ? JSON.parse(readFileSync(this.statePath, 'utf8')) as Record<string, unknown> : {} } catch { return {} }
  }
  private saveState(): void {
    mkdirSync(this.d.dir, { recursive: true })
    const temporary = `${this.statePath}.tmp-${randomUUID()}`
    try { writeFileSync(temporary, JSON.stringify(this.stateValue), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.statePath) } finally { rmSync(temporary, { force: true }) }
  }

  /** The environment of every CLI run: the team identity, this host, its key — and no operator A2A_* variable. */
  private env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    for (const [name, value] of Object.entries(process.env)) if (!name.startsWith('A2A_')) env[name] = value
    const home = this.d.homeUrl(), key = this.d.apiKey()
    return { ...env, A2A_CLI_HOME: this.identityDir, ...(home !== undefined ? { A2A_HOME: home } : {}), ...(key !== undefined && key !== '' ? { A2A_KEY: key } : {}) }
  }

  private commands(signal?: AbortSignal): Commands {
    return {
      withSignal: next => this.commands(next),
      run: async (program, args) => {
        if (program !== 'a2a-net') throw new Error(`the a2a Source runs only a2a-net, not ${program}`)
        if (this.d.homeUrl() === undefined) throw new Error('this host is not listening yet')
        return await (this.d.run ?? runCli)(args, this.env(), signal)
      },
    }
  }

  /** The team's A2A address (the held identity's handle), once it exists. */
  get address(): string | undefined {
    try {
      const id = JSON.parse(readFileSync(join(this.identityDir, 'cli.json'), 'utf8')) as { handle?: unknown }
      return typeof id.handle === 'string' ? id.handle : undefined
    } catch { return undefined }
  }

  get health(): Record<string, Health> { return Object.fromEntries(this.healthValue) }

  /** Create the team identity on first use. */
  async ensureIdentity(): Promise<string> {
    const existing = this.address
    if (existing !== undefined) return existing
    mkdirSync(this.identityDir, { recursive: true, mode: 0o700 })
    await (this.d.run ?? runCli)(['init', TEAM_IDENTITY_NAME], this.env())
    const created = this.address
    if (created === undefined) throw new Error('a2a-net init left no team identity')
    this.d.logger.info('superagent: team A2A address %s', created)
    return created
  }

  /** Run a2a-watch's mailbox loop (deposit renewal + reads) until stopped. */
  start(): void {
    if (this.controller !== undefined) return
    const controller = this.controller = new AbortController()
    this.loop = (async () => {
      try {
        await this.ensureIdentity()
        await watch(this.context, controller.signal)
      } catch (error) {
        if (!controller.signal.aborted) {
          this.healthValue.set(HEALTH.read, { state: 'error', detail: String(error), at: new Date().toISOString() })
          this.d.logger.warn('superagent: a2a Source stopped: %s', String(error))
        }
      }
    })()
  }

  async stop(): Promise<void> {
    this.controller?.abort()
    await this.loop
    this.controller = undefined
    this.loop = undefined
  }

  /** Whether an Outbox message can go out on the a2a Channel at all (a reply mode and a real caller). */
  allowed(message: OutboundMessage): boolean {
    const config = this.context.config<A2aConfig>(KIND)
    return config !== undefined && this.kindValue.channel.allowed(message.channel.address, config)
  }

  /**
   * superagent v4 (requester acknowledgement): tell an A2A requester its request became a ticket, with an `acknowledged`
   * receipt on task `ack-<task>`. The requester's row stays owed — the ticket's result receipt settles it — but leaves its
   * host's queue count and the 24-hour TTL. Not an Outbox message: the first Outbox message to a caller is its one formal
   * receipt (a2a-watch), which an acknowledgement must not take. Once per task: 'sent', 'already', 'gone' (never
   * deliverable: no reply mode, no real caller, an id no receipt can carry, a caller no longer linked), or a thrown
   * error (try again on a later pass).
   */
  async acknowledge(address: Record<string, string>, text: string): Promise<'sent' | 'already' | 'gone'> {
    const config = this.context.config<A2aConfig>(KIND)
    const { caller, task, ingress } = address
    if (config === undefined || !replyAllowed(address, config) || caller === undefined || task === undefined) return 'gone'
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(task) || `ack-${task}`.length > 80) return 'gone'
    const acked = (this.stateValue[ACKED_KEY] ?? {}) as Record<string, string>
    if (acked[task] !== undefined) return 'already'
    const check = JSON.parse(await this.context.commands.run('a2a-net', ['admission', caller, ...(ingress === 'local' ? ['--local'] : []), '--json'])) as { admitted?: unknown; rule?: unknown }
    if (check.admitted !== true || typeof check.rule !== 'string' || !LINK_RULES.has(check.rule)) return 'gone'
    try {
      await this.context.commands.run('a2a-net', ['receipt', task, '--acknowledged', '--to', caller, '--json', '--exit-class', '--', text])
    } catch (error) {
      const code = (error as { exitCode?: unknown }).exitCode
      if (code === EXIT_GONE) return 'gone'
      // Already on the host (a restart between the CLI's success and this record): it counts as sent.
      if (code !== EXIT_RECEIPT_CONFLICT) throw error
    }
    const now = Date.now()
    const kept = Object.entries({ ...acked, [task]: new Date(now).toISOString() }).filter(([, at]) => now - Date.parse(at) <= ACKED_TTL_MS).slice(-ACKED_CAP)
    this.context.state.set(ACKED_KEY, Object.fromEntries(kept))
    return 'sent'
  }

  /** Whether the A2A request `task` has had its one formal receipt (a2a-watch records it once it went out). */
  answered(task: string): boolean {
    const answered = this.stateValue[KV.answered]
    return typeof answered === 'object' && answered !== null && (answered as Record<string, unknown>)[task] !== undefined
  }

  /**
   * Send one Outbox message: 'sent', 'gone' (never deliverable), or a thrown error (retry later). The request a ticket was
   * accepted from keeps its one formal receipt for the result (acceptance run 3: a relayed question took it and settled
   * the acknowledged row): while the ticket is open with no ready report, a reply on that request — the member's question,
   * a notice — goes out as a follow-up in the same context, and the requester's row stays owed until the result settles
   * it. Whether or not the acknowledgement has gone out yet: it is sent asynchronously and may come second.
   */
  async send(message: OutboundMessage, options: { outcome?: ReceiptOutcome } = {}): Promise<'sent' | 'gone'> {
    const task = message.channel.address.task
    const hold = task !== undefined && message.ticketId !== undefined && this.d.resultPending?.(message.ticketId, task) === true
    if (!hold && options.outcome === undefined) return await this.kindValue.channel.send({ commands: this.context.commands }, message)
    return await sendReply(this.context, this.context.commands, message, undefined, { ...(hold ? { holdReceipt: true } : {}), ...options })
  }
}
