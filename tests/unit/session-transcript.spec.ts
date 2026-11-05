import { mkdtempSync } from '../temp-dirs.ts'
import { writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { createSessionLogDecoder, decodeSessionLog, extractTranscript, scanZstdFrames, TRANSCRIPT_ENTRY_TEXT_CAP, TRANSCRIPT_DEFAULT_LIMIT } from '../../src/session-transcript.ts'

function frame(lines: string[]): Buffer {
  return zstdCompressSync(lines.join('\n') + '\n')
}

describe('scanZstdFrames', () => {
  it('splits concatenated frames structurally', () => {
    const buffer = Buffer.concat([frame(['{"a":1}']), frame(['{"b":2}', '{"c":3}'])])
    const frames = scanZstdFrames(buffer)
    expect(frames.length).toBe(2)
    expect(frames[0]!.start).toBe(0)
    expect(frames[1]!.start).toBe(frames[0]!.end)
    expect(frames[1]!.end).toBe(buffer.length)
  })

  it('returns empty for plain text', () => {
    expect(scanZstdFrames(Buffer.from('plain jsonl\n'))).toEqual([])
  })

  it('drops a torn trailing frame', () => {
    const whole = frame(['{"a":1}'])
    const torn = Buffer.concat([whole, whole.subarray(0, Math.floor(whole.length / 2))])
    const frames = scanZstdFrames(torn)
    expect(frames.length).toBe(1)
    expect(frames[0]!.end).toBe(whole.length)
  })
})

describe('decodeSessionLog', () => {
  it('enforces a single-frame output ceiling inside the real codec before returning a Buffer', () => {
    const compressed = zstdCompressSync(Buffer.alloc(4096, 120)), decode = createSessionLogDecoder(zstdDecompressSync, 1024)
    expect(compressed.length).toBeLessThan(1024)
    expect(() => decode(compressed)).toThrow(expect.objectContaining({ code: 'ERR_BUFFER_TOO_LARGE' }))
    expect(decode(zstdCompressSync(Buffer.alloc(1024,120)))).toHaveLength(1024)
  })
  it('passes the decreasing remaining budget into every frame, not just the first one', () => {
    const decoder = vi.fn((bytes: Uint8Array, options: {maxOutputLength:number}) => zstdDecompressSync(bytes,options))
    const decode = createSessionLogDecoder(decoder,1024), one=zstdCompressSync(Buffer.alloc(600,120)),two=zstdCompressSync(Buffer.alloc(600,121))
    expect(() => decode(Buffer.concat([one,two]))).toThrow(expect.objectContaining({code:'ERR_BUFFER_TOO_LARGE'}))
    expect(decoder.mock.calls.map(([,options])=>options.maxOutputLength)).toEqual([1,1024,424])
    const first=zstdCompressSync(Buffer.alloc(1024,120));decoder.mockClear()
    expect(()=>decode(Buffer.concat([first,two]))).toThrow('decompressed-size cap')
    expect(decoder).toHaveBeenCalledTimes(1)
  })
  it('refuses a decoder that ignores output limits before passing any untrusted frame to it', () => {
    const untrusted=zstdCompressSync(Buffer.alloc(4096,122)), ignores=vi.fn((bytes:Uint8Array)=>zstdDecompressSync(bytes))
    const decode=createSessionLogDecoder(ignores,1024)
    expect(()=>decode(untrusted)).toThrow('does not enforce maxOutputLength')
    expect(ignores).toHaveBeenCalledTimes(1)
    expect(Buffer.from(ignores.mock.calls[0]![0])).not.toEqual(untrusted)
    expect(()=>decode(untrusted)).toThrow('does not enforce maxOutputLength')
    expect(ignores).toHaveBeenCalledTimes(1)
  })
  it('does not infer support from arbitrary codec errors or retry with an unbounded call',()=>{
    const unsupported=vi.fn(()=>{throw Object.assign(Error('unsupported option'),{code:'ERR_INVALID_ARG_VALUE'})})
    const decode=createSessionLogDecoder(unsupported,100)
    expect(()=>decode(zstdCompressSync('hello'))).toThrow('does not enforce maxOutputLength')
    expect(unsupported).toHaveBeenCalledTimes(1)
  })
  it('keeps plain logs available without a codec probe and rejects invalid budget widening',()=>{
    const codec=vi.fn(()=>{throw Error('not supported')}),decode=createSessionLogDecoder(codec,4)
    expect(decode(Buffer.from('four'))).toBe('four');expect(codec).not.toHaveBeenCalled()
    expect(()=>decode(Buffer.from('five!'))).toThrow('decompressed-size cap')
    expect(()=>createSessionLogDecoder(codec,Infinity)).toThrow('invalid')
    expect(()=>createSessionLogDecoder(codec,161*1024*1024)).toThrow('invalid')
  })

  it('decodes every frame, not just the first (node public decoder stops at one)', () => {
    const text = 'line-one\nline-two\n'
    const buffer = Buffer.concat([zstdCompressSync(text), zstdCompressSync('line-three\n')])
    expect(decodeSessionLog(buffer)).toBe(text + 'line-three\n')
  })

  it('passes plain artifacts through untouched', () => {
    expect(decodeSessionLog(Buffer.from('{"type":"session"}\n'))).toBe('{"type":"session"}\n')
  })
})

describe('extractTranscript', () => {
  const log = [
    JSON.stringify({ type: 'session', version: 3, id: 'session-x' }),
    JSON.stringify({ type: 'user/message', time: 1, data: { content: [{ type: 'text', text: '检查插件' }] } }),
    JSON.stringify({ type: 'assistant/message', time: 2, data: { message: { role: 'assistant', content: [{ type: 'reasoning', text: 'inner thought' }, { type: 'text', text: '开始扫描' }] } } }),
    JSON.stringify({ type: 'tool/call', time: 3, data: { name: 'bash' } }),
    JSON.stringify({ type: 'user/message', time: 4, data: { content: [{ type: 'image', url: 'x' }, { type: 'text', text: '第二问' }] } }),
    JSON.stringify({ type: 'assistant/message', time: 5, data: { message: { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' }] } } }),
    'not-json-at-all',
  ].join('\n')

  it('keeps human-visible text and skips reasoning/tool segments', () => {
    const entries = extractTranscript(log)
    expect(entries).toEqual([
      { role: 'user', text: '检查插件', time: 1 },
      { role: 'assistant', text: '开始扫描', time: 2 },
      { role: 'user', text: '第二问', time: 4 },
    ])
  })

  it('returns the tail up to the limit', () => {
    const long = Array.from({ length: 30 }, (_, i) => JSON.stringify({ type: 'user/message', time: i, data: { content: [{ type: 'text', text: `q${i}` }] } })).join('\n')
    expect(extractTranscript(long, 5).map(entry => entry.text)).toEqual(['q25', 'q26', 'q27', 'q28', 'q29'])
    expect(extractTranscript(long).length).toBe(TRANSCRIPT_DEFAULT_LIMIT)
  })

  it('caps entry length and flattens whitespace', () => {
    const long = JSON.stringify({ type: 'user/message', data: { content: [{ type: 'text', text: 'x'.repeat(TRANSCRIPT_ENTRY_TEXT_CAP + 50) }] } })
    const [entry] = extractTranscript(long)
    expect(entry!.text.length).toBe(TRANSCRIPT_ENTRY_TEXT_CAP + 1)
    expect(entry!.text.endsWith('…')).toBe(true)
  })
})

describe('real 3081 artifact shape (regression guard)', () => {
  it('round-trips a two-frame generation log written to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'transcript-'))
    const file = join(dir, 'session.v3.jsonl.zstd')
    const lines = [
      JSON.stringify({ type: 'session', version: 3, id: 'session-t' }),
      JSON.stringify({ type: 'user/message', time: 9, data: { content: [{ type: 'text', text: '你好' }] } }),
    ]
    writeFileSync(file, Buffer.concat([frame([lines[0]!]), frame([lines[1]!])]))
    expect(decodeSessionLog(readFileSync(file))).toBe(lines.join('\n') + '\n')
  })
})
