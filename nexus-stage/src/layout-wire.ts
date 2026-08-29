/**
 * The planning canvas's layout save loop: debounce dirty flags into one
 * POST, drive the save lamp (idle -> pending -> saved | error), and adopt
 * the host's normalized snapshot without ever fighting an in-flight drag.
 *
 * Discipline (born of the review's "empty catch" incidents):
 * - the payload is read at SEND time, so edits during the debounce window
 *   ride the same request;
 * - on success the sent document is compared against the live one - if
 *   they differ, the user edited during flight: positions are NOT touched
 *   (the live model is authoritative), the lamp stays pending, and the
 *   loop chains the follow-up save. Only an unchanged document adopts the
 *   host's normalized response, and because the client pre-clamps with
 *   the host-mirror discipline, our own echo is byte-equal and adoption
 *   is a no-op in the common case;
 * - failures surface (lamp error + the stage's throttled fault reporter),
 *   never swallowed - retry is explicit (click) or implicit (next edit).
 *
 * Pure control flow: the transport, the timer, and the clock are all
 * injected, so tests pin the ladder without a network or real time.
 * @module nexus-stage/layout-wire
 */

/** Save-lamp states: grey=start, amber=unsaved, green=stored, red=failed. */
export type LampState = 'idle' | 'pending' | 'saved' | 'error'

/** Debounce window collapsing nudge storms into one request. */
export const SAVE_DEBOUNCE_MS = 800

/** What send() must resolve to: the host's {ok, layout?, error?} body. */
export interface SaveResponse { ok: boolean; layout?: unknown; error?: string }

export interface SaveLoopDeps {
  /** The current layout document, read at send time. */
  snapshot(): unknown
  /** POST the document; resolve with the parsed host body, throw on transport failure. */
  send(doc: unknown, opts: { keepalive: boolean }): Promise<SaveResponse>
  /** Timer injection: schedule(fn, ms) returns its cancel function. */
  schedule(fn: () => void, ms: number): () => void
  /** Injectable clock (reserved for throttle semantics parity with fault.ts). */
  now(): number
  /** Lamp transitions; never called with the same state twice in a row. */
  onLamp(state: LampState): void
  /** Adopt the host's normalized layout (only on unchanged-document success). */
  onAdopt(layout: unknown): void
  /** Transport/refusal failures, for the stage's fault surface. */
  onHttpError(message: string): void
}

export interface SaveLoop {
  /** Something moved: lamp pending, debounced save (re-)armed. */
  markDirty(): void
  /** Explicit retry after an error (lamp click). */
  retry(): void
  /** Fire now with keepalive - the pagehide path. */
  flush(): void
  /** True while a request is in flight. */
  isBusy(): boolean
  /** Cancel the armed timer; the loop stops. */
  dispose(): void
}

/** Create the save loop over the given dependencies. */
export function createSaveLoop(deps: SaveLoopDeps): SaveLoop {
  let cancelTimer: (() => void) | undefined
  let busy = false
  let dirty = false
  let flushAfterSettle = false
  let lamp: LampState = 'idle'

  function setLamp(next: LampState): void {
    if (next === lamp) return
    lamp = next
    deps.onLamp(next)
  }

  function clearTimer(): void {
    if (cancelTimer !== undefined) { cancelTimer(); cancelTimer = undefined }
  }

  function arm(): void {
    clearTimer()
    cancelTimer = deps.schedule(() => { cancelTimer = undefined; void fire(false) }, SAVE_DEBOUNCE_MS)
  }

  async function fire(keepalive: boolean): Promise<void> {
    if (busy) { dirty = true; return }
    busy = true
    clearTimer()
    const sent = deps.snapshot()
    let sentJson: string
    try {
      sentJson = JSON.stringify(sent)
    } catch {
      busy = false
      setLamp('error')
      deps.onHttpError('layout document is not JSON-serializable')
      return
    }
    try {
      const res = await deps.send(sent, { keepalive })
      if (res === null || typeof res !== 'object' || res.ok !== true) {
        setLamp('error')
        const reason = res !== null && typeof res === 'object' && typeof res.error === 'string' ? res.error : 'layout save refused'
        deps.onHttpError(`layout save: ${reason}`)
      } else if (JSON.stringify(deps.snapshot()) === sentJson) {
        deps.onAdopt(res.layout)
        setLamp('saved')
      } else {
        // Edited mid-flight: the live model stays authoritative; the dirty
        // handling below chains the follow-up save.
      }
    } catch (error) {
      setLamp('error')
      deps.onHttpError(`layout save unreachable: ${String((error as Error | undefined)?.message ?? error).slice(0, 80)}`)
    }
    busy = false
    // pagehide raced a busy save: the queued edits must not wait for a
    // debounce that a closing page will never fire — flush immediately.
    if (flushAfterSettle && lamp !== 'error') {
      flushAfterSettle = false
      void fire(true)
      return
    }
    if (dirty && lamp !== 'error') {
      dirty = false
      setLamp('pending')
      arm()
    }
  }

  return {
    markDirty() {
      dirty = false
      setLamp('pending')
      if (busy) { dirty = true; return }
      arm()
    },
    retry() {
      if (lamp !== 'error' || busy) return
      setLamp('pending')
      void fire(false)
    },
    flush() {
      if (busy) { flushAfterSettle = true; dirty = true; return }
      clearTimer()
      void fire(true)
    },
    isBusy() { return busy },
    dispose() { clearTimer() },
  }
}
