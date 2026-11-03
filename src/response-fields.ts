import type { ServerResponse } from 'node:http'

/** Add structured fields to any JSON response exit and recompute its Content-Length. */
export function withResponseFields(res: ServerResponse, fields: Readonly<Record<string, unknown>>): void {
  const writeHead = res.writeHead.bind(res) as (status: number, headers?: Record<string, string | number>) => ServerResponse
  const end = res.end.bind(res) as (body?: string) => ServerResponse
  let head: { status: number; headers: Record<string, string | number> } | undefined
  ;(res as unknown as { writeHead: unknown }).writeHead = (status: number, headers?: Record<string, string | number>) => {
    head = { status, headers: { ...(headers ?? {}) } }
    return res
  }
  ;(res as unknown as { end: unknown }).end = (body?: string) => {
    let out = body
    if (typeof body === 'string') {
      try {
        const parsed: unknown = JSON.parse(body)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) out = JSON.stringify({ ...parsed, ...fields })
      } catch { /* not JSON: unchanged */ }
    }
    if (head !== undefined) {
      if (out !== undefined && 'Content-Length' in head.headers) head.headers['Content-Length'] = Buffer.byteLength(out)
      writeHead(head.status, head.headers)
    }
    return end(out)
  }
}
