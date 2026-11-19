/** Directory identity, not an admission decision: retain the source the person actually selected. */
export interface RemoteSource { readonly team: string; readonly memberRef?: string; readonly via?: string; readonly unreachable?: boolean }

/** Canonical peer endpoint for comparison only. Never invent an endpoint or accept URL credentials. */
export function remotePeer(via: string | undefined): string | undefined {
  if (!via) return undefined
  try {
    const url = new URL(via)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) return undefined
    return url.href.replace(/\/$/, '')
  } catch { return undefined }
}

/** Include the publishing endpoint even for modern bare process rows (e.g. team=dsh). */
export function remoteSourceKey(row: RemoteSource): string {
  return JSON.stringify([row.team, row.memberRef ?? null, remotePeer(row.via) ?? row.via ?? null])
}

/** The qualified selector must name the displayed team; missing provenance cannot become an add selection. */
export function remoteMember(row: RemoteSource): string | undefined {
  if (!remotePeer(row.via) || row.unreachable === true || !row.team.includes('/')) return undefined
  if (row.memberRef === undefined) return row.team
  return row.memberRef.startsWith(row.team + '@') && /^[a-f0-9]{8}$/i.test(row.memberRef.slice(row.team.length + 1)) ? row.memberRef : undefined
}
