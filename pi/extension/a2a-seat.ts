/**
 * a2a-seat: a Pi extension that makes this Pi a superagent team member (docs/design/superagent-pi-platform.md P3–P6).
 *
 * The seat is the a2a-net CLI identity on this machine (`a2a-net init`, `a2a-net publish --pi-seat`, deposited on the
 * team host). The team host writes the seat's work into that identity's mailbox; this extension polls the mailbox with
 * `a2a-net inbox --after <cursor>` (its own cursor, never ~/.a2a/inbox.cursor), hands each piece of work to the Pi
 * session as a user message, tells the host it was read, and tells it when the run settles. The model answers with the
 * `a2a-net ticket …` commands the work card names.
 *
 * Installed by `a2a-net pi install` into ~/.pi/agent/extensions/. It joins no team: the team's owner adds the handle to
 * the team canvas. Environment: A2A_NET (the CLI command, default `a2a-net`), A2A_SEAT_POLL_MS (default 15000).
 */
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One mailbox row as `a2a-net inbox --after` prints it. */
interface MailRow { readonly from?: string; readonly text?: string; readonly seq?: number; readonly task_id?: string }
interface AfterRead { readonly next?: string; readonly mail?: readonly MailRow[]; readonly epochChanged?: boolean }

/** The sender name the team host writes a seat's work under (src/index.ts piDeliver). */
const TEAM_SENDER = 'superagent'
const CLI = process.env.A2A_NET ?? 'a2a-net'
const POLL_MS = Math.max(5_000, Number(process.env.A2A_SEAT_POLL_MS ?? 15_000) || 15_000)
const STATE_DIR = join(homedir(), '.pi', 'agent', 'a2a-seat')
const CURSOR = join(STATE_DIR, 'cursor')

function readCursor(): string {
  try { const value = readFileSync(CURSOR, 'utf8').trim(); return value === '' ? 'start' : value } catch { return 'start' }
}

function writeCursor(value: string): void {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(CURSOR, value, { mode: 0o600 })
}

export default function a2aSeat(pi: ExtensionAPI): void {
  let timer: ReturnType<typeof setInterval> | undefined
  let polling = false
  /** Whether team work reached this session since the last turn end was told. */
  let working = false

  const cli = async (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
    const out = await pi.exec(CLI, args, { timeout: 60_000 })
    return { code: out.code, stdout: out.stdout, stderr: out.stderr }
  }

  const poll = async (ctx: ExtensionContext): Promise<void> => {
    if (polling) return
    polling = true
    try {
      const cursor = readCursor()
      const out = await cli(['inbox', '--after', cursor])
      if (out.code !== 0) return
      const read = JSON.parse(out.stdout) as AfterRead
      const work = (read.mail ?? []).filter(row => row.from === TEAM_SENDER && typeof row.text === 'string' && row.text !== '')
      for (const row of work) {
        const text = row.text as string
        if (ctx.isIdle()) pi.sendUserMessage(text)
        else pi.sendUserMessage(text, { deliverAs: 'followUp' })
        working = true
      }
      // The cursor moves only after the work is handed over, so a crash in between delivers it again, never loses it.
      if (typeof read.next === 'string' && read.next !== cursor) writeCursor(read.next)
      if (work.length > 0) await cli(['ticket', 'read'])
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(`a2a-seat: mailbox poll failed: ${String(error)}`, 'warning')
    } finally {
      polling = false
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    if (timer !== undefined) return
    void poll(ctx)
    timer = setInterval(() => { void poll(ctx) }, POLL_MS)
  })

  pi.on('agent_settled', async (event, _ctx) => {
    if (!working) return
    working = false
    if (event.aborted) await cli(['ticket', 'error', '--transient', '--', 'the Pi run was aborted'])
    else await cli(['ticket', 'idle'])
  })

  pi.on('session_shutdown', async () => {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
  })
}
