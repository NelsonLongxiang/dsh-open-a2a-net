/**
 * Owner vs mirror on the board (owner ruling 2026-10-29, PR#96: canvas sync
 * is single owner + mirror). A team belongs to the host that made it; every
 * other host renders it as a MIRROR of that host's published card and edits
 * it through the fleet relay. The frame head says so: 「镜像 · <owner host>」,
 * and 「同步中…」 from the moment a relayed edit is sent until the owner
 * answers (the relay refreshes the owner's card before replying, so the next
 * poll already shows the result). Local frames carry no marker — this host
 * is their owner.
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
