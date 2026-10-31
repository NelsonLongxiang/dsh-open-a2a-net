/**
 * #123 (#114 S5): the auto-receipt's `authRef` — one canonicalizer over the
 * inbound authorization record (task-auth.ts), pinned by a golden vector
 * computed independently (python3 hashlib.sha256 over the canonical string).
 */
import { describe, expect, it } from 'vitest'
import { authorizationRef, buildAuthorization, canonicalAuthorization, parseAuthorization, type TaskAuthorization } from '../../src/task-auth.ts'

const AUTH: TaskAuthorization = buildAuthorization(
  { ok: true, via: 'canvas-member', rule: 'canvas-shared', basis: ['peer-org:dsh/canvas/far', 'dsh/canvas/ops'] },
  {
    caller: 'dsh/aaaaaaaa', proof: 'origin-claim', claim: { caller: 'dsh', origin: 'http://100.75.181.127:13080' },
    ingress: 'wire', allowlistVersion: 'al1:0123456789abcdef', target: 'dsh/bbbbbbbb', receiptTarget: 'dsh/aaaaaaaa',
    receivedAt: 1_700_000_000_000, targetBusy: true,
  },
)

const CANONICAL = '{"v":1,"caller":"dsh/aaaaaaaa","proof":"origin-claim","claim":{"caller":"dsh","origin":"http://100.75.181.127:13080"},"ingress":"wire","via":"canvas-member","admission_rule":"canvas-shared","basis":["dsh/canvas/ops","peer-org:dsh/canvas/far"],"allowlist_version":"al1:0123456789abcdef","target":"dsh/bbbbbbbb","receipt_target":"dsh/aaaaaaaa","received_at":1700000000000,"target_busy":true}'

describe('#123 authRef (golden vector)', () => {
  it('canonical JSON: declaration key order, basis sorted, no whitespace', () => {
    expect(canonicalAuthorization(AUTH)).toBe(CANONICAL)
  })

  it('authRef is the first 16 hex of sha256 over the canonical JSON', () => {
    expect(authorizationRef(AUTH)).toBe('6b8957a6f02206de')
  })

  it('is stable under persisted key order and basis order (a restored record keeps its ref)', () => {
    const shuffled = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(AUTH)) as Record<string, unknown>).reverse())
    shuffled.basis = [...AUTH.basis].reverse()
    const restored = parseAuthorization(shuffled, 1_700_000_000_000)
    expect(restored).toBeDefined()
    expect(authorizationRef(restored!)).toBe('6b8957a6f02206de')
  })

  it('omits absent optional fields and moves with any field', () => {
    const plain = buildAuthorization(
      { ok: true, via: 'cli-deposit', rule: 'cli-deposit', basis: [] },
      { caller: 'review-seat/f62b3c7aa9f44276', proof: 'legacy-window', ingress: 'wire', allowlistVersion: 'al1:0123456789abcdef', target: 'dsh/414d2b90', receiptTarget: 'review-seat/f62b3c7aa9f44276', receivedAt: 1 },
    )
    expect(canonicalAuthorization(plain)).not.toContain('claim')
    expect(canonicalAuthorization(plain)).not.toContain('target_busy')
    expect(authorizationRef(plain)).toMatch(/^[0-9a-f]{16}$/)
    expect(authorizationRef({ ...AUTH, target: 'dsh/cccccccc' })).not.toBe(authorizationRef(AUTH))
    expect(authorizationRef({ ...AUTH, target_busy: undefined } as TaskAuthorization)).not.toBe(authorizationRef(AUTH))
  })
})
