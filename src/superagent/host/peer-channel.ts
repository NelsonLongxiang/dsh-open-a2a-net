import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, win32 } from 'node:path'

export const PEER_CHANNEL_APPROVE = '批准七天队内交流'
export const PEER_CHANNEL_DECLINE = '拒绝'
export const PEER_CHANNEL_TOOL = 'a2a_team_message'
export const PEER_CHANNEL_LIFETIME = 7 * 24 * 60 * 60 * 1000
const CAP = 4096

export interface PeerChannelTarget {
  readonly kind: 'peer-channel'
  readonly team: string
  readonly ticketId: string
  readonly assignment: string
  readonly sender: string
  readonly senderBinding: string
  readonly recipient: string
  readonly recipientBinding: string
  readonly receivingBinding?: string
  readonly senderReceivingBinding?: string
}

export interface PeerGrant extends PeerChannelTarget {
  readonly id: string
  readonly cardId: string
  readonly by: string
  readonly approvedAt: number
  readonly revoked?: { readonly by: string; readonly at: number; readonly reason: string }
}

export interface PeerGrantView {
  readonly id: string
  readonly ticketId: string
  readonly recipient: string
  readonly expiresAt: number
}

export const peerGrantView = (row: PeerGrant): PeerGrantView =>
  ({ id: row.id, ticketId: row.ticketId, recipient: row.recipient, expiresAt: row.approvedAt + PEER_CHANNEL_LIFETIME })

export function validPeerGrantView(raw: unknown): raw is PeerGrantView {
  const row = peerObject(raw)
  return identifier(row?.id) && identifier(row.ticketId) && identifier(row.recipient) && millis(row.expiresAt)
}

export interface PeerFile {
  readonly path: string
  readonly sha256: string
}

export interface PeerMessage {
  readonly id: string
  readonly grantId: string
  readonly team: string
  readonly ticketId: string
  readonly sender: string
  readonly recipient: string
  readonly receivingBinding?: string
  readonly at: number
  readonly text?: string
  readonly file?: PeerFile
}

export type PeerMessageStatus = 'unknown' | 'queued' | 'refused'

export function peerDeliveryId(message: PeerMessage, binding: string): string {
  return 'peer-' + createHash('sha256').update(JSON.stringify([message.team, message.grantId, message.id, message.sender, message.recipient, binding])).digest('hex')
}

export function peerMessageText(message: PeerMessage): string {
  const file = message.file === undefined ? '' : '\n[team file reference; existing file permissions apply] ' + JSON.stringify(message.file)
  return '[superagent peer message] Context from ' + message.sender + ' on ticket ' + message.ticketId + '.\n' + (message.text ?? '') + file
}
type Entry = { readonly owner: string; readonly payload: PeerMessage; readonly status: PeerMessageStatus }
type Binding = { readonly member: string; readonly identity: string; readonly generation: string }
type Snapshot = { readonly version: 1; readonly bindings: readonly Binding[]; readonly grants: readonly PeerGrant[]; readonly messages: readonly Entry[] }

export const peerObject = (raw: unknown): Record<string, unknown> | undefined =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
const identifier = (raw: unknown): raw is string => typeof raw === 'string' && raw !== '' && raw.length <= 1024 && !/[\x00-\x1f\x7f]/.test(raw)
const millis = (raw: unknown): raw is number => typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0
export const peerMessageId = (raw: unknown): raw is string => typeof raw === 'string' && /^[a-zA-Z0-9._:-]{1,64}$/.test(raw)

export function validPeerTarget(raw: unknown): raw is PeerChannelTarget {
  const row = peerObject(raw)
  return row?.kind === 'peer-channel' && [row.team, row.ticketId, row.assignment, row.sender, row.senderBinding, row.recipient, row.recipientBinding].every(identifier) &&
    row.sender !== row.recipient && (row.receivingBinding === undefined || identifier(row.receivingBinding)) &&
    (row.senderReceivingBinding === undefined || identifier(row.senderReceivingBinding))
}

export function peerFile(raw: unknown): PeerFile | undefined {
  const row = peerObject(raw)
  if (!identifier(row?.path) || (!isAbsolute(row.path) && !win32.isAbsolute(row.path)) || typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256)) return undefined
  return { path: row.path, sha256: row.sha256 }
}

export function peerPayload(raw: unknown): Pick<PeerMessage, 'text' | 'file'> | undefined {
  const row = peerObject(raw)
  if (row === undefined) return undefined
  const text = row.text
  const file = row.file === undefined ? undefined : peerFile(row.file)
  if (text !== undefined && (typeof text !== 'string' || !text.trim() || text.length > 4000) || row.file !== undefined && file === undefined || text === undefined && file === undefined) return undefined
  return { ...(typeof text === 'string' ? { text } : {}), ...(file !== undefined ? { file } : {}) }
}

export function readPeerMessage(raw: unknown): PeerMessage | undefined {
  const row = peerObject(raw)
  const content = peerPayload(raw)
  if (!row || !content || !peerMessageId(row.id) || !identifier(row.grantId) || !identifier(row.team) || !identifier(row.ticketId) ||
    !identifier(row.sender) || !identifier(row.recipient) || row.sender === row.recipient || !millis(row.at) ||
    (row.receivingBinding !== undefined && !identifier(row.receivingBinding))) return undefined
  return { id: row.id, grantId: row.grantId, team: row.team, ticketId: row.ticketId, sender: row.sender, recipient: row.recipient,
    ...(row.receivingBinding !== undefined ? { receivingBinding: row.receivingBinding } : {}), at: row.at, ...content }
}

const empty = (): Snapshot => ({ version: 1, bindings: [], grants: [], messages: [] })
const distinct = (keys: readonly string[]): boolean => new Set(keys).size === keys.length
const validBinding = (raw: unknown): raw is Binding => {
  const row = peerObject(raw)
  return identifier(row?.member) && identifier(row.identity) && identifier(row.generation)
}
const validGrant = (raw: unknown): raw is PeerGrant => {
  const row = peerObject(raw)
  if (!row || !validPeerTarget(row) || !identifier(row.id) || !identifier(row.cardId) || !identifier(row.by) || !millis(row.approvedAt)) return false
  const revoked = peerObject(row.revoked)
  return row.revoked === undefined || (identifier(revoked?.by) && millis(revoked.at) && revoked.at >= row.approvedAt && typeof revoked.reason === 'string' && revoked.reason.length <= 500)
}
const validMessageEntry = (raw: unknown): raw is Entry => {
  const row = peerObject(raw)
  return identifier(row?.owner) && readPeerMessage(row.payload) !== undefined && (row.status === 'unknown' || row.status === 'queued' || row.status === 'refused')
}

/** A commit becomes visible only after its snapshot replacement succeeds. An unreadable journal grants nothing. */
export class PeerChannelBook {
  private value = empty()
  ready = true

  constructor(private readonly path: string) {
    try {
      if (!existsSync(path)) return
      const raw = peerObject(JSON.parse(readFileSync(path, 'utf8')))
      if (raw?.version !== 1 || !Array.isArray(raw.bindings) || !raw.bindings.every(validBinding) || !distinct(raw.bindings.map(row => row.member)) ||
        !Array.isArray(raw.grants) || raw.grants.length > CAP || !raw.grants.every(validGrant) || !distinct(raw.grants.map(row => row.id)) ||
        !Array.isArray(raw.messages) || raw.messages.length > CAP || !raw.messages.every(validMessageEntry) ||
        !distinct(raw.messages.map(row => JSON.stringify([row.owner, row.payload.id])))) throw Error('invalid peer channel journal')
      this.value = { version: 1, bindings: raw.bindings, grants: raw.grants, messages: raw.messages }
    } catch { this.ready = false }
  }

  private commit(next: Snapshot): void {
    if (!this.ready) throw Error('peer channel journal is unavailable')
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = this.path + '.' + randomUUID()
    try { writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); renameSync(temporary, this.path) }
    finally { rmSync(temporary, { force: true }) }
    this.value = next
  }

  syncMembers(members: ReadonlyMap<string, string>): void {
    if (!this.ready) return
    const bindings = [...members].map(([member, identity]) => {
      const existing = this.value.bindings.find(row => row.member === member && row.identity === identity)
      return existing ?? { member, identity, generation: randomUUID() }
    })
    if (bindings.length === this.value.bindings.length && bindings.every((binding, i) => binding === this.value.bindings[i])) return
    try { this.commit({ ...this.value, bindings }) } catch { this.ready = false }
  }

  binding(member: string): string | undefined {
    return this.ready ? this.value.bindings.find(row => row.member === member)?.generation : undefined
  }

  grants(): readonly PeerGrant[] { return this.ready ? this.value.grants : [] }

  approve(target: PeerChannelTarget, id: string, cardId: string, by: string, at: number): void {
    const previous = this.value.grants.find(row => row.id === id)
    if (previous !== undefined) {
      if (previous.cardId === cardId && previous.approvedAt === at && previous.by === by) return
      throw Error('peer channel decision identity conflict')
    }
    if (!millis(at) || this.value.grants.length >= CAP) throw Error('peer channel grant journal unavailable')
    this.commit({ ...this.value, grants: [...this.value.grants, { ...target, id, cardId, by, approvedAt: at }] })
  }

  revoke(id: string, by: string, at: number, reason: string): boolean {
    const matching = this.value.grants.find(row => row.id === id)
    if (!matching || !millis(at) || at < matching.approvedAt) return false
    if (matching.revoked !== undefined) return true
    this.commit({ ...this.value, grants: this.value.grants.map(row => row === matching ? { ...row, revoked: { by, at, reason } } : row) })
    return true
  }

  find(owner: string, id: string): Entry | undefined {
    return this.ready ? this.value.messages.find(row => row.owner === owner && row.payload.id === id) : undefined
  }

  reserve(owner: string, payload: PeerMessage): void {
    if (this.find(owner, payload.id) !== undefined || this.value.messages.length >= CAP) throw Error('peer message journal unavailable')
    this.commit({ ...this.value, messages: [...this.value.messages, { owner, payload, status: 'unknown' }] })
  }

  finish(owner: string, id: string, status: Exclude<PeerMessageStatus, 'unknown'>): void {
    const entry = this.find(owner, id)
    if (entry?.status !== 'unknown') return
    this.commit({ ...this.value, messages: this.value.messages.map(row => row === entry ? { ...row, status } : row) })
  }

  audit(ticketId: string): readonly Entry[] {
    return this.ready ? this.value.messages.filter(row => row.owner.startsWith('out:') && row.payload.ticketId === ticketId) : []
  }
}
