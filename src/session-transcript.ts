/**
 * Session transcript reader (0.6.11): lets the workbench inspector show the
 * tail of a LOCAL session's own conversation log, inline, with no navigation
 * (owner ruling 2026-10-20: no jumps, responsive only). Remote nodes' logs
 * live on their machines — this module deliberately only reads this host's
 * <dshHome>/sessions tree.
 *
 * Log layout (dsh session-persistence-jsonl): each session dir holds one
 * append-only JSONL artifact per FORMAT GENERATION — session.jsonl.zstd,
 * session.v2.jsonl.zstd, session.v3.jsonl.zstd… (generation, not rotation:
 * a migration writes the next file and new events append there). The zstd
 * artifacts are CONCATENATED independent frames — the writer appends one
 * self-contained checksummed frame per durable batch, and node:zlib's public
 * decoder stops after the first frame, so a reader must split frames
 * structurally and decode each with zstdDecompressSync.
 *
 * Event records (JSONL lines) this extractor cares about:
 *   {"type":"user/message","seq","time","data":{"content":[{"type":"text","text"}]}}
 *   {"type":"assistant/message","seq","time","data":{"message":{"role":"assistant","content":[{"type":"text"|"reasoning"|"tool-call",…}]}}}
 * reasoning and tool-call segments are skipped; only human-visible text is a
 * transcript entry.
 */
import { zstdDecompressSync } from 'node:zlib'

/** One human-readable transcript entry. */
export interface TranscriptEntry {
  role: 'user' | 'assistant'
  text: string
  time?: number
}

/** Hard caps so a pathological log cannot balloon memory or the response. */
export const TRANSCRIPT_MAX_FILE_BYTES = 64 * 1024 * 1024
export const TRANSCRIPT_MAX_DECOMPRESSED_BYTES = 160 * 1024 * 1024
export const TRANSCRIPT_ENTRY_TEXT_CAP = 500
export const TRANSCRIPT_DEFAULT_LIMIT = 20
export const TRANSCRIPT_MAX_LIMIT = 100

const ZSTD_MAGIC = 0xfd2fb528

/** Byte range of one structurally complete zstd frame. */
interface FrameRange { start: number; end: number }

/**
 * Walk concatenated zstd frames structurally (no block decoding) and return
 * their byte ranges. Malformed structure rejects; EOF inside a final frame is
 * dropped from the result (a torn tail frame decodes to nothing usable).
 */
export function scanZstdFrames(buffer: Buffer): FrameRange[] {
  const frames: FrameRange[] = []
  let offset = 0
  while (offset + 4 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    const start = offset
    offset += 4
    if (offset >= buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    let complete = false
    while (offset + 3 <= buffer.length) {
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) return frames // reserved block type: stop before it
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (offset + payloadBytes > buffer.length) break
      offset += payloadBytes
      if (lastBlock) { complete = true; break }
    }
    if (!complete) break
    if (checksum) offset += 4
    if (offset > buffer.length) break
    frames.push({ start, end: offset })
  }
  return frames
}

/**
 * Decode a session log artifact to text. Plain .jsonl passes through; .zstd
 * artifacts are split into frames and decoded frame by frame (node's public
 * decoder is single-frame).
 */
export function decodeSessionLog(buffer: Buffer): string {
  const frames = scanZstdFrames(buffer)
  if (frames.length === 0) return buffer.toString('utf8')
  const parts: string[] = []
  let total = 0
  for (const frame of frames) {
    const chunk = zstdDecompressSync(buffer.subarray(frame.start, frame.end))
    total += chunk.length
    if (total > TRANSCRIPT_MAX_DECOMPRESSED_BYTES) {
      throw new Error('session log exceeds the decompressed-size cap')
    }
    parts.push(chunk.toString('utf8'))
  }
  return parts.join('')
}

function clampEntry(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > TRANSCRIPT_ENTRY_TEXT_CAP ? flat.slice(0, TRANSCRIPT_ENTRY_TEXT_CAP) + '…' : flat
}

/**
 * Extract the last `limit` human-visible turns from a decoded session log.
 * User lines come from user/message data.content[].text; assistant lines from
 * assistant/message data.message.content[] segments of type "text" (reasoning
 * and tool calls are working detail, not transcript).
 */
export function extractTranscript(logText: string, limit = TRANSCRIPT_DEFAULT_LIMIT): TranscriptEntry[] {
  const entries: TranscriptEntry[] = []
  for (const line of logText.split('\n')) {
    if (line.trim() === '') continue
    let record: unknown
    try { record = JSON.parse(line) } catch { continue }
    if (typeof record !== 'object' || record === null) continue
    const event = record as { type?: unknown; data?: unknown; time?: unknown }
    const time = typeof event.time === 'number' ? event.time : undefined
    if (event.type === 'user/message') {
      const data = event.data as { content?: Array<{ type?: string; text?: unknown }> } | undefined
      const text = (data?.content ?? [])
        .filter(seg => seg?.type === 'text' && typeof seg.text === 'string')
        .map(seg => seg.text as string)
        .join(' ')
      if (text.trim() !== '') entries.push({ role: 'user', text: clampEntry(text), time })
    } else if (event.type === 'assistant/message') {
      const data = event.data as { message?: { content?: Array<{ type?: string; text?: unknown }> } } | undefined
      const text = (data?.message?.content ?? [])
        .filter(seg => seg?.type === 'text' && typeof seg.text === 'string')
        .map(seg => seg.text as string)
        .join(' ')
      if (text.trim() !== '') entries.push({ role: 'assistant', text: clampEntry(text), time })
    }
  }
  return entries.slice(-limit)
}
