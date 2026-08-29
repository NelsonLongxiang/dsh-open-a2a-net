/**
 * The canvas write face's transport layer (POST /__dsh_a2a/canvas): action
 * sequencing, per-team serialization, and the notice classification that
 * design.md §3.4 mandates (host error text surfaces VERBATIM - the sidebar
 * reference's swallowed `.catch(() => {})` is the anti-pattern here).
 *
 * Classification per request:
 * - `ok:true`                                    → success (silent)
 * - `ok:false` WITH an `error` string            → error notice, verbatim
 * - `ok:false` without `error` (absent target,   → idempotent no-op,
 *   member cap hit)                                silent success
 * - HTTP >= 400                                  → body error verbatim, else `HTTP <status>`
 * - send() throws                                → `画布不可达：<message>`
 * - 200 + ok:false WITHOUT an error string       → idempotent no-op
 *   (absent target, member/team cap hit) — silent success
 * - 200 + non-JSON body (proxy artifact)         → classified as success
 *   (known limitation: nothing parseable to classify)
 *
 * Ops on the same team run through a serial queue (a later gesture waits
 * instead of racing; cross-team ops run in parallel) - mirrors the
 * sidebar's per-team busy keys, minus the rejection hostility. Pure
 * control flow: the transport is injected.
 * @module nexus-stage/canvas-wire
 */

/** One send outcome: HTTP status plus the parsed JSON body (whatever it is). */
export interface CanvasWireResult {
  status: number
  body: { ok?: boolean; error?: string; teams?: readonly string[]; members?: readonly string[]; name?: string }
}

/** Transport injection: POST the body, resolve with parsed outcome, throw on network failure. */
export type CanvasSend = (body: unknown) => Promise<CanvasWireResult>

export interface CanvasWireDeps {
  send: CanvasSend
  onNotice(kind: 'error' | 'info', text: string): void
}

export interface CanvasWire {
  /** create → add-member per id, serial, first failure stops. `created`:
   *  the team did not exist model-side before this action — a first-add
   *  failure would then leave a ghost EMPTY team on the host, compensated
   *  with a best-effort remove. */
  createTeam(name: string, ids: readonly string[], created?: boolean): Promise<boolean>
  addMembers(team: string, ids: readonly string[]): Promise<boolean>
  removeMembers(team: string, ids: readonly string[]): Promise<boolean>
  /** Pre-computed remove/add roster ops (from canvas-ops.reorderOps). */
  runRosterOps(team: string, ops: ReadonlyArray<{ op: 'remove' | 'add'; id: string }>): Promise<boolean>
  removeTeam(name: string): Promise<boolean>
  hasPending(): boolean
}

type RosterOp = { op: 'remove' | 'add'; id: string }

function errorText(body: CanvasWireResult['body']): string | undefined {
  return typeof body.error === 'string' ? body.error : undefined
}

export function createCanvasWire(deps: CanvasWireDeps): CanvasWire {
  const queues = new Map<string, Promise<unknown>>()
  let pending = 0

  /** Serial per-team queue: same key waits, other keys run in parallel. */
  function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    pending += 1
    const prev = queues.get(key) ?? Promise.resolve()
    const run = async (): Promise<T> => {
      try {
        return await task()
      } finally {
        pending -= 1 // settles BEFORE the returned promise resolves
      }
    }
    const next = prev.then(run, run) // run regardless of how the predecessor settled
    queues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  /** One classified request — NEVER enqueues (public ops own the queue). */
  async function raw(body: Record<string, unknown>): Promise<boolean> {
    let res: CanvasWireResult
    try {
      res = await deps.send(body)
    } catch (error) {
      const message = String((error as Error | undefined)?.message ?? error).slice(0, 80)
      deps.onNotice('error', `画布不可达：${message}`)
      return false
    }
    if (res.status >= 400) {
      deps.onNotice('error', errorText(res.body) ?? `HTTP ${res.status}`)
      return false
    }
    if (res.body.ok === true) return true
    const text = errorText(res.body)
    if (text !== undefined) {
      deps.onNotice('error', text)
      return false
    }
    return true // ok:false without error: idempotent no-op (absent target / cap)
  }

  async function serial(body: Record<string, unknown>, ids: readonly string[]): Promise<boolean> {
    for (const id of ids) {
      if (!(await raw({ ...body, id }))) return false
    }
    return true
  }

  return {
    createTeam(name, ids, created = false) {
      return enqueue(name, async () => {
        if (!(await raw({ action: 'create', name }))) return false
        for (let i = 0; i < ids.length; i++) {
          if (!(await raw({ action: 'add-member', name, id: ids[i]! }))) {
            // A failure on the FIRST add of a team this action created leaves
            // a ghost EMPTY team on the host — compensate with a remove.
            // Later failures keep whatever members genuinely joined.
            if (created && i === 0) await raw({ action: 'remove', name })
            return false
          }
        }
        return true
      })
    },
    addMembers(team, ids) {
      return enqueue(team, () => serial({ action: 'add-member', name: team }, ids))
    },
    removeMembers(team, ids) {
      return enqueue(team, () => serial({ action: 'remove-member', name: team }, ids))
    },
    runRosterOps(team, ops) {
      return enqueue(team, async () => {
        for (const op of ops) {
          const body = op.op === 'remove'
            ? { action: 'remove-member', name: team, id: op.id }
            : { action: 'add-member', name: team, id: op.id }
          if (!(await raw(body))) return false
        }
        return true
      })
    },
    removeTeam(name) {
      return enqueue(name, () => raw({ action: 'remove', name }))
    },
    hasPending() {
      return pending > 0
    },
  }
}
