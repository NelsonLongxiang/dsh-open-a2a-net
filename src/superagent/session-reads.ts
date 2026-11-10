/**
 * What the superagent host reads from, or does to, a local DSH session (moved out of src/index.ts for the #570 line
 * ratchet; the behaviour is unchanged): the person's latest message (D11), a member's last turn, cancelling a turn, a
 * team model selection, and staging a card's files on the file channel (decision cards C8).
 * @module @nelsonlongxiang/dsh-open-a2a-net/superagent/session-reads
 */
import { isAbsolute, resolve } from 'node:path'
import { readFileSync, statSync } from 'node:fs'
import { NEUTRAL_SOURCES } from '../node-self.ts'
import { BLOB_FILE_MAX, formatFileRef, type BlobStore } from '../blob-store.ts'

type TextBlocks = ReadonlyArray<{ type?: string; text?: string }>
const textOf = (blocks: TextBlocks | undefined): string => (blocks ?? []).filter(block => block.type === 'text').map(block => block.text ?? '').join('\n').trim()

/**
 * Design D11: the latest message in the session that is not host context, when a person typed it. `source` is set by the
 * host on arrival; a nudge the plugin itself sends through the same RPC is marked by its rpcId.
 * @param events - the session's events, oldest first.
 * @returns the person's message, or undefined when the latest such message was not a person's.
 */
export function personMessageFrom(events: readonly unknown[]): { id: string; atMs: number; text: string } | undefined {
  for (const event of [...events].reverse()) {
    const e = event as { type?: string; time?: number; data?: { id?: unknown; source?: { kind?: unknown; rpcId?: unknown }; content?: TextBlocks } } | undefined
    if (e?.type !== 'user/message') continue
    const kind = e.data?.source?.kind
    // A scheduled prompt is the session's own text: it closes the door as a relayed message does (D11).
    if (kind === 'schedule') return undefined
    if (typeof kind === 'string' && NEUTRAL_SOURCES.has(kind)) continue
    const rpcId = e.data?.source?.rpcId
    if (kind !== 'user' || (typeof rpcId === 'string' && rpcId.startsWith('a2a-')) || typeof e.data?.id !== 'string' || typeof e.time !== 'number') return undefined
    const text = textOf(e.data.content)
    return text === '' ? undefined : { id: e.data.id, atMs: e.time, text }
  }
  return undefined
}

/**
 * A member's last turn: whether it still runs a job, and the text of its last answer.
 * @param id - the member session.
 * @param events - its events, oldest first.
 * @param jobs - DSH's jobs service, if mounted.
 * @returns the turn's state.
 */
export function memberTurnFrom(id: string, events: readonly unknown[], jobs: unknown): { quiet: boolean; text: string } {
  const list = (jobs as { list?: (caller: string) => readonly { owner?: string; status: string }[] } | undefined)?.list
  const quiet = !(list?.(id) ?? []).some(job => job.owner === id && (job.status === 'running' || job.status === 'stopping'))
  const last = [...events].reverse().find(event => (event as { type?: string } | undefined)?.type === 'assistant/message') as { data?: { message?: { content?: TextBlocks } } } | undefined
  return { quiet, text: textOf(last?.data?.message?.content) }
}

/**
 * Stop a session's running turn, as the person's stop does.
 * @param agent - the session's agent, if loaded.
 * @returns true when a turn was running and is being cancelled.
 */
export function cancelAgentTurn(agent: unknown): boolean {
  const a = agent as { status?: string; cancel?: (reason: { kind: 'user' }, options: { keepInbox: boolean }) => unknown } | undefined
  if (a === undefined || a.status === 'idle' || typeof a.cancel !== 'function') return false
  a.cancel({ kind: 'user' }, { keepInbox: false })
  return true
}

/**
 * The team's model choices: in-process sessionController.selectModel (the host's /api/session/* answers 401 without a
 * browser cookie). DSH answers with the selection it installed for the session's next request: that is the read-back.
 * @param loaded - whether the session is loaded on this host.
 * @param controller - DSH's sessionController service, if mounted.
 * @param sessionId - the session.
 * @param pick - the model.
 * @returns true when DSH installed exactly that model; otherwise it throws why.
 */
export async function selectSessionModel(loaded: boolean, controller: unknown, sessionId: string, pick: { provider: string; model: string; reasoningEffort?: string }): Promise<boolean> {
  if (!loaded) throw new Error('the session is not loaded on this host yet')
  const select = (controller as { selectModel?: (request: unknown) => Promise<unknown> } | undefined)?.selectModel
  if (select === undefined) throw new Error('DSH offers no sessionController here')
  const done = await select.call(controller, { sessionId, ...pick }) as { selected?: { provider?: string; model?: string } } | undefined
  if (done?.selected?.provider !== pick.provider || done.selected.model !== pick.model) throw new Error(`DSH installed ${String(done?.selected?.provider)}/${String(done?.selected?.model)} instead`)
  return true
}

/**
 * Decision cards C8: a proposer's files go on the file channel, granted to its team's canvas, as a2a_file_send stages them.
 * @param on - the store, this host's origin (empty until it publishes a card), the proposer's workspace, the grant target and the proposer.
 * @param paths - the files, relative to the workspace or absolute.
 * @returns the staged files, or why not.
 */
export function stageCardFiles(on: { blobStore: BlobStore; from: string; cwd: unknown; team: string; by: string }, paths: readonly string[]): { ok: true; files: Array<{ sha256: string; size: number; name: string; ref: string }> } | { ok: false; code: string; error: string } {
  if (on.from === '') return { ok: false, code: 'files', error: 'this host publishes no card URL yet: nobody could pull the files' }
  const files: Array<{ sha256: string; size: number; name: string; ref: string }> = []
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : typeof on.cwd === 'string' && on.cwd !== '' ? resolve(on.cwd, p) : ''
    if (abs === '') return { ok: false, code: 'files', error: `relative path ${p} needs a session workspace` }
    let bytes: Uint8Array
    try {
      const st = statSync(abs)
      if (!st.isFile()) return { ok: false, code: 'files', error: `${p} is not a file` }
      if (st.size > BLOB_FILE_MAX) return { ok: false, code: 'files', error: `${p} is ${String(st.size)} bytes; a file on a card is at most ${String(BLOB_FILE_MAX)}` }
      bytes = readFileSync(abs)
    } catch (error) { return { ok: false, code: 'files', error: `cannot read ${p}: ${error instanceof Error ? error.message : String(error)}` } }
    const out = on.blobStore.stage(bytes, { name: abs.split(/[\\/]/).pop() ?? p, to: on.team, by: on.by })
    if (!out.ok) return { ok: false, code: out.code ?? 'files', error: `${p}: ${out.error}` }
    files.push({ sha256: out.sha256, size: out.size, name: out.name, ref: formatFileRef({ sha256: out.sha256, size: out.size, name: out.name, from: on.from }) })
  }
  return { ok: true, files }
}
