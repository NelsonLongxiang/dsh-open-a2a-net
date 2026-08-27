/**
 * Self-referral-filter unit tests: the suppression window that stops a
 * mirrored referral list from re-offering a URL whose own fetch just proved
 * it serves this node, plus window expiry and empty-URL bounds.
 */
import { describe, expect, it } from 'vitest'
import { SELF_REFERRAL_SUPPRESS_MS, SelfReferralFilter } from '../src/self-suppress.ts'

describe('SelfReferralFilter', () => {
  it('passes strangers and refuses URLs remembered inside the window', () => {
    const filter = new SelfReferralFilter(() => 1_000)
    expect(filter.shouldOffer('http://10.0.0.9:1')).toBe(true)
    filter.remember('http://127.0.0.1:1')
    expect(filter.shouldOffer('http://127.0.0.1:1')).toBe(false)
    // A stranger stays untouched by the memory of another URL.
    expect(filter.shouldOffer('http://192.168.1.4:2')).toBe(true)
  })

  it('ignores empty URLs so callers need no guard', () => {
    const filter = new SelfReferralFilter(() => 1_000)
    filter.remember('')
    expect(filter.shouldOffer('')).toBe(true)
  })

  it('frees the URL once the suppression window elapses', () => {
    let clock = 5_000
    const filter = new SelfReferralFilter(() => clock)
    filter.remember('http://localhost:13080')
    expect(filter.shouldOffer('http://localhost:13080')).toBe(false)
    clock += SELF_REFERRAL_SUPPRESS_MS
    // Boundary: exactly at the window's end the memory still holds.
    expect(filter.shouldOffer('http://localhost:13080')).toBe(false)
    clock += 1
    expect(filter.shouldOffer('http://localhost:13080')).toBe(true)
  })
})
