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

/**
 * 解散 on a mirror frame: the frame stays gone from the moment the dissolve
 * is sent until the owner's published org stops listing the team. Without
 * this, a poll that lands while the relay is in flight — or before the
 * owner's card is re-read — draws the frame again (and keeps its saved rect
 * for a later team of the same name).
 */
export function createDissolveGuard() {
  const dissolving = new Map<string, string>() // team name → owner URL
  return {
    /** Mark the dissolve and return the action carrying its owner (the relay fork). */
    fork<A extends { type: 'remove-team'; name: string }>(act: A, ownerUrl: string): A & { fleetPeer: string } {
      dissolving.set(act.name, ownerUrl)
      return { ...act, fleetPeer: ownerUrl }
    },
    /** The owner refused (or the channel failed): the frame may come back. */
    settled(act: { type: string; name?: string }, ok: boolean): void {
      if (!ok && act.type === 'remove-team' && act.name !== undefined) dissolving.delete(act.name)
    },
    /** True while this owner's team is being (or has just been) dissolved here. */
    hides(name: string, ownerUrl: string): boolean { return dissolving.get(name) === ownerUrl },
    /** Forget a dissolve once its owner's org no longer lists the team. */
    sweep(peerOrg: MirrorOrg): void {
      for (const [name, url] of dissolving) {
        if (peerOrg.find(row => row.url === url)?.org.some(t => t.name === name) !== true) dissolving.delete(name)
      }
    },
  }
}
