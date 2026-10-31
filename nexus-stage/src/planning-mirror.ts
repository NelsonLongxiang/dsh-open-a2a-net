/**
 * Owner vs mirror on the board (owner ruling 2026-10-29, PR#96: canvas sync
 * is single owner + mirror). A team belongs to the host that made it; every
 * other host renders it as a MIRROR of that host's published card and edits
 * it through the fleet relay. The frame head says so: 「镜像 · <owner host>」,
 * and 「同步中…」 from the moment a relayed edit is sent until the owner
 * answers (the relay then re-reads the owner's card in the background, and
 * the owner's own change ping backs it up). Local frames carry no marker —
 * this host is their owner.
 * @module nexus-stage/planning-mirror
 */
import { peerHostOf } from './federation'

export interface MirrorRoute {
  readonly text: string
  readonly title: string
  readonly syncing: boolean
}

/** The route line of a remote (mirrored) frame; undefined for a local frame. */
export function mirrorRoute(ownerUrl: string | undefined, syncing: boolean): MirrorRoute | undefined {
  if (ownerUrl === undefined) return undefined
  const host = peerHostOf(ownerUrl)
  return {
    text: syncing ? `同步中… · ${host}` : `镜像 · ${host}`,
    title: syncing
      ? `已把改动交给属主 ${host}，等待它确认`
      : `这个团队属于 ${host}，这里显示的是它的镜像；拖入或移出成员会经中继交给 ${host} 执行`,
    syncing,
  }
}

type MirrorOrg = ReadonlyArray<{ readonly url: string; readonly org: ReadonlyArray<{ readonly name: string }> }>

/** After the owner accepted a dissolve, hide its team at most this long: a
 *  peer's late add-member re-creates the team on the owner, and then it is
 *  real again even though the owner's org never stopped listing it. */
export const DISSOLVE_HIDE_MS = 10_000

/**
 * 解散 on a mirror frame: the frame stays gone from the moment the dissolve
 * is sent until the owner's published org stops listing the team (or
 * DISSOLVE_HIDE_MS after the owner accepted). Without this, a poll that lands
 * while the relay is in flight — or before the owner's card is re-read —
 * draws the frame again (and keeps its saved rect for a later team of the
 * same name). Keyed by owner AND name: two owners may both have a team X.
 */
export function createDissolveGuard(now: () => number = Date.now) {
  const key = (ownerUrl: string, name: string): string => `${ownerUrl}\u0000${name}`
  const dissolving = new Map<string, { url: string; name: string; acceptedAt?: number }>()
  return {
    /** Mark the dissolve and return the action carrying its owner (the relay fork). */
    fork<A extends { type: 'remove-team'; name: string }>(act: A, ownerUrl: string): A & { fleetPeer: string } {
      dissolving.set(key(ownerUrl, act.name), { url: ownerUrl, name: act.name })
      return { ...act, fleetPeer: ownerUrl }
    },
    /** The owner answered: a refusal (or a failed channel) lets the frame back now, an acceptance starts the clock. */
    settled(act: { type: string; name?: string; fleetPeer?: string }, ok: boolean): void {
      if (act.type !== 'remove-team' || act.name === undefined || act.fleetPeer === undefined) return
      const entry = dissolving.get(key(act.fleetPeer, act.name))
      if (entry === undefined) return
      if (ok) entry.acceptedAt = now()
      else dissolving.delete(key(act.fleetPeer, act.name))
    },
    /** True while this owner's team is being (or has just been) dissolved here. */
    hides(name: string, ownerUrl: string): boolean { return dissolving.has(key(ownerUrl, name)) },
    /** Forget a dissolve once its owner's org no longer lists the team, or once its time is up. */
    sweep(peerOrg: MirrorOrg): void {
      for (const [k, e] of dissolving) {
        const listed = peerOrg.find(row => row.url === e.url)?.org.some(t => t.name === e.name) === true
        if (!listed || (e.acceptedAt !== undefined && now() - e.acceptedAt > DISSOLVE_HIDE_MS)) dissolving.delete(k)
      }
    },
  }
}
