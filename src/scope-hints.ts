/**
 * Owner-board scope hints (production feedback 2026-11-14). Two hosts each own their own canvases and nothing syncs
 * them: a peer's canvas can hold one of this host's sessions beside its own session while this host declares nothing
 * about that session. Routing out already works (outboundScope reads the peer's canvas) and the agent tools list the
 * session [shared via] that canvas, but this host's admission still has no link for the peer session calling in, and
 * nobody is told. A hint names each such pair so the owner can declare the other side with one click on the board
 * (canvas add-member under the session's key-pinned reference), or join the local session first when it is not on the
 * network. Hints are suggestions on the owner's GUI face only; nothing here changes membership.
 * @module scope-hints
 */
import { qualifiedSessionMember } from './canvas-member.ts'
import { advertisedCanvasTeams } from './peer-directory.ts'
import type { A2aPeerCard } from './types.ts'

/** One local session the peer canvas holds. */
export interface ScopeHintLocal {
  /** Local session id. */
  readonly id: string
  /** Its `<zone>/<id8>` handle. */
  readonly handle: string
  /** Whether the session is on the network (joined). */
  readonly joined: boolean
  /** This host's canvas teams the session is a member of (the places the remote session can be added). */
  readonly canvases: readonly string[]
}

/** A peer session that shares a peer canvas with local sessions but is declared nowhere on this host. */
export interface ScopeHint {
  /** The peer URL whose card publishes both the canvas and the session. */
  readonly peer: string
  /** The peer's canvas team (`<zone>/canvas/<name>`). */
  readonly peerCanvas: string
  /** The remote session team (`<zone>/<id8>`). */
  readonly remote: string
  /** The key-pinned reference to add (`<zone>/<id8>@<fp8>`), when the card's key yields one. */
  readonly memberRef?: string
  /** The remote session's published name. */
  readonly name: string
  /** The local sessions that peer canvas holds. */
  readonly local: readonly ScopeHintLocal[]
}

export interface ScopeHintInput {
  /** Tracked peers with their cached verified cards (unreachable ones are left out by the caller). */
  readonly cards: ReadonlyArray<{ readonly url: string; readonly card: A2aPeerCard }>
  /** Local-first handle resolution: a canvas ref to a local session id (joined or live), or undefined. */
  readonly resolveLocal: (ref: string) => string | undefined
  readonly joined: (id: string) => boolean
  readonly handleOf: (id: string) => string
  readonly canvasesOf: (id: string) => readonly string[]
  /** Whether any canvas on this host already holds this reference (raw slots: a suspended one is still declared). */
  readonly declared: (ref: string) => boolean
}

/** Bounded: a board shows a handful of suggestions, never a fleet census. */
export const SCOPE_HINT_CAP = 64

export function scopeHints(input: ScopeHintInput): ScopeHint[] {
  const hints: ScopeHint[] = []
  const seen = new Set<string>()
  for (const { url, card } of input.cards) {
    const sessions = new Map((card.sessionTeams ?? []).map(entry => [entry.team, entry.name] as const))
    for (const canvas of advertisedCanvasTeams(card)) {
      const local = new Map<string, ScopeHintLocal>()
      for (const ref of canvas.members) {
        const id = input.resolveLocal(ref)
        if (id === undefined || local.has(id)) continue
        local.set(id, { id, handle: input.handleOf(id), joined: input.joined(id), canvases: [...input.canvasesOf(id)] })
      }
      if (local.size === 0) continue
      for (const [remote, name] of sessions) {
        const memberRef = qualifiedSessionMember(remote, card.publicKey)
        if (!canvas.members.some(ref => ref === remote || (memberRef !== undefined && ref === memberRef))) continue
        if (input.declared(remote) || (memberRef !== undefined && input.declared(memberRef))) continue
        const key = `${url}\u0000${canvas.team}\u0000${remote}`
        if (seen.has(key)) continue
        seen.add(key)
        hints.push({ peer: url, peerCanvas: canvas.team, remote, ...(memberRef !== undefined ? { memberRef } : {}), name, local: [...local.values()] })
        if (hints.length >= SCOPE_HINT_CAP) return hints
      }
    }
  }
  return hints
}
