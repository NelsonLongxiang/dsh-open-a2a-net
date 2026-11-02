/** #189 follow-up: a path-prefixed claim URL links only as the EXACT mounted peer URL the operator seeded. */
import { describe, expect, it } from 'vitest'
import { sameMountedUrl } from '../../src/origin-claim.ts'

describe('sameMountedUrl', () => {
  it('matches the same origin and path, trailing slashes ignored', () => {
    expect(sameMountedUrl('https://f.example/node', 'https://f.example/node')).toBe(true)
    expect(sameMountedUrl('https://f.example/node/', 'https://f.example/node')).toBe(true)
    expect(sameMountedUrl('https://F.example/node', 'https://f.example/node/')).toBe(true)
  })

  it('refuses another path under the same origin, a deeper path, another origin, and the root', () => {
    expect(sameMountedUrl('https://f.example/node', 'https://f.example/evil')).toBe(false)
    expect(sameMountedUrl('https://f.example/node', 'https://f.example/node/x')).toBe(false)
    expect(sameMountedUrl('https://f.example/node', 'https://g.example/node')).toBe(false)
    expect(sameMountedUrl('https://f.example/', 'https://f.example/')).toBe(false)
  })

  it('refuses userinfo, query or fragment on either side, and junk', () => {
    expect(sameMountedUrl('https://f.example/node', 'https://u@f.example/node')).toBe(false)
    expect(sameMountedUrl('https://f.example/node', 'https://f.example/node?x=1')).toBe(false)
    expect(sameMountedUrl('https://f.example/node#a', 'https://f.example/node')).toBe(false)
    expect(sameMountedUrl('not a url', 'https://f.example/node')).toBe(false)
    expect(sameMountedUrl('ftp://f.example/node', 'ftp://f.example/node')).toBe(false)
  })
})
