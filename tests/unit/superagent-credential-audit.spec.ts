// @vitest-environment node
/**
 * The credential-access audit (local market trial, 2026-11-11): a team member read another session's token file and used
 * it. The host now records any team call that touches credentials, an Authorization header or another session's files,
 * tells the owner on a P1 card, and keeps nothing it read. The persona says to use only what the host gives.
 */
import { mkdtempSync } from '../temp-dirs.ts'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { credentialAccess, redactedPreview } from '../../src/superagent/host/credential-audit.ts'

const SECRET = 'fakeTrialValueZZZZYYYYXXXXWWWWVVVV'
const SCRATCH = '/private/tmp/claude-501/-Users-x-workspace-market/0f1e/scratchpad/trial-local'

describe('what a call touches', () => {
  it('the trial member\'s own commands: the token file in another session\'s scratch directory, then a call with it', () => {
    expect(credentialAccess({ command: `ls -la "${SCRATCH}/secrets"` })).toEqual(['credential-file', 'other-session'])
    expect(credentialAccess({ command: `TOKEN=$(cat "${SCRATCH}/secrets/mcp-market-trial-team.token"); curl -sS -X POST http://127.0.0.1:9890/mcp -H "Authorization: Bearer $TOKEN"` }))
      .toEqual(['credential-file', 'authorization-header', 'other-session'])
    expect(credentialAccess({ command: `cat "${SCRATCH}/run.log"` })).toEqual(['other-session'])
  })

  it('credential places, headers and other sessions\' files, in a shell command or a path argument', () => {
    for (const command of ['cat ~/.ssh/id_ed25519', 'cat ~/.a2a/host.env', 'cat ~/.npmrc', 'ls ~/.config/gh', 'cat .env', 'security find-generic-password -s x', 'cat deploy.pem']) {
      expect(credentialAccess({ command }), command).toContain('credential-file')
    }
    expect(credentialAccess({ command: `curl -H 'x-api-key: abc' http://127.0.0.1:1` })).toContain('authorization-header')
    expect(credentialAccess({ path: '/Users/x/.dsh/sessions/--ws--/session-1/session.v4.jsonl.zstd' })).toEqual(['other-session'])
    expect(credentialAccess({ command: 'ls ~/Library/Application\\ Support/Claude/side-session-notes' })).toEqual(['other-session'])
  })

  it('ordinary work touches nothing', () => {
    for (const command of ['npm test', 'git status --short', 'cat src/index.ts', 'node -e "console.log(obj.key)"', 'grep -rn token src/receipt.ts', 'ls docs/design', 'curl -sS http://127.0.0.1:9890/api/health']) {
      expect(credentialAccess({ command }), command).toEqual([])
    }
    expect(credentialAccess(undefined)).toEqual([])
  })

  it('the preview blanks what looks secret and is cut short', () => {
    const preview = redactedPreview({ command: `curl -H "Authorization: Bearer ${SECRET}" -d '{"password":"hunter2hunter2"}' http://127.0.0.1:1` })
    expect(preview).not.toContain(SECRET)
    expect(preview).not.toContain('hunter2hunter2')
    expect(preview).toContain('<redacted>')
    expect(redactedPreview({ command: 'x'.repeat(500) }).length).toBeLessThanOrEqual(200)
  })
})

describe('the host records a hit and tells the owner', () => {
  it('a P1 card once per session and kind every 10 minutes; the hit keeps the kinds and a redacted preview, never the secret', async () => {
    const { SuperagentHost, CREDENTIAL_CARD_GAP_MS } = await import('../../src/superagent/host/index.ts')
    let clock = Date.parse('2026-11-11T15:21:32.000Z')
    const h = new SuperagentHost({ canvasTeam: (name: string) => name === 'team' ? { local: ['session-r', 'session-m'], remote: [] } : undefined,
      home: mkdtempSync(join(tmpdir(), 'sa-cred-')), logger: { info: () => {}, warn: () => {} }, deliverToSession: () => true, interval: () => () => {},
      now: () => new Date(clock).toISOString(), sessionName: (id: string) => id === 'session-m' ? '成员一' : id } as never)
    expect(h.saveSettings({ canvas: 'team', router: 'session-r' }, () => true)).toMatchObject({ ok: true })
    const call = { command: `curl -H "Authorization: Bearer ${SECRET}" http://127.0.0.1:9890/mcp` }
    expect(h.auditCall('session-m', 'member', 'bash', call)).toEqual(['authorization-header'])
    expect(h.auditCall('session-m', 'member', 'bash', call)).toEqual(['authorization-header'])
    const cards = () => h.decisionCards().filter(c => c.by === 'credential:session-m')
    expect(cards()).toHaveLength(1)
    expect(cards()[0]).toMatchObject({ level: 'P1', recommended: '知道了', source: 'health' })
    expect(cards()[0]!.question).toContain('成员一')
    clock += CREDENTIAL_CARD_GAP_MS
    h.auditCall('session-m', 'member', 'bash', call)
    expect(cards()).toHaveLength(2)
    const state = JSON.stringify(h.state())
    expect(state).toContain('authorization-header')
    expect(state).not.toContain(SECRET)
    expect((h.state() as { credentialAudit: unknown[] }).credentialAudit).toHaveLength(3)
    // Ordinary work raises nothing.
    expect(h.auditCall('session-m', 'member', 'bash', { command: 'npm test' })).toEqual([])
    expect((h.state() as { credentialAudit: unknown[] }).credentialAudit).toHaveLength(3)
    await h.stop()
  })
})

describe('the personas say to use only what the host gives', () => {
  it('the router, members and observers carry the credential rule', () => {
    const layer = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
    const preset = (id: string) => layer.slice(layer.indexOf(`- id: ${id}-preset`)).split(/\n    - id: superagent-/)[0]!
    for (const id of ['superagent-router', 'superagent-member', 'superagent-observer']) {
      expect(preset(id), id).toContain('use only the tools and credentials this host gives you')
      expect(preset(id), id).toContain("do not read other sessions' files or scratch directories")
    }
  })
})
