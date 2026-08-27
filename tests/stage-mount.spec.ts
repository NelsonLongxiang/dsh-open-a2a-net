/**
 * Stage-mount resolution unit tests: the bare-mount redirect that keeps
 * relative asset references inside the served tree, prefix stripping, and
 * pass-through of foreign paths (traversal remains the handler's guard).
 */
import { describe, expect, it } from 'vitest'
import { resolveStageMount } from '../src/stage-mount.ts'

const MOUNT = '/__dsh_a2a_nexus'

describe('resolveStageMount', () => {
  it('redirects the bare mount so ./assets resolves inside the tree', () => {
    expect(resolveStageMount(MOUNT, MOUNT)).toEqual({ redirectTo: `${MOUNT}/`, rel: '' })
    // Query strings do not exempt the redirect; they belong to the document.
    expect(resolveStageMount(`${MOUNT}?theme=x`, MOUNT)).toEqual({ redirectTo: `${MOUNT}/`, rel: '' })
  })

  it('maps the slashed mount onto the built index.html', () => {
    expect(resolveStageMount(`${MOUNT}/`, MOUNT)).toEqual({ rel: '/index.html' })
    expect(resolveStageMount(`${MOUNT}/?t=1`, MOUNT)).toEqual({ rel: '/index.html' })
    // A bare name plus empty query still addresses the directory, not a file.
    expect(resolveStageMount(`${MOUNT}?`, MOUNT)).toEqual({ redirectTo: `${MOUNT}/`, rel: '' })
  })

  it('strips the prefix from deeper asset paths', () => {
    expect(resolveStageMount(`${MOUNT}/assets/index-A1b2C3.js`, MOUNT))
      .toEqual({ rel: '/assets/index-A1b2C3.js' })
    expect(resolveStageMount(`${MOUNT}/assets/x.js?ver=2`, MOUNT))
      .toEqual({ rel: '/assets/x.js' })
  })

  it('passes through paths outside the mount verbatim-ish', () => {
    expect(resolveStageMount('/favicon.ico', MOUNT)).toEqual({ rel: '/favicon.ico' })
    // Unusual no-leading-slash forms normalize like the nexus handler did.
    expect(resolveStageMount('assets/a.js', MOUNT)).toEqual({ rel: '/assets/a.js' })
  })

  it('leaves traversal candidates for the handler to reject', () => {
    // The helper only normalizes; the 403 decision stays at the serving site.
    expect(resolveStageMount(`${MOUNT}/../secret`, MOUNT)).toEqual({ rel: '/../secret' })
  })
})
