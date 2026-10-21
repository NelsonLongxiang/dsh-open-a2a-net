/**
 * Test helper (gh#9+gh#10 OriginClaim): build the four envelope headers
 * signed with a mounted node's own card key, naming its own card URL —
 * the node verifies itself (its card is reachable at that loopback URL,
 * and the zone name derives from card.team).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPrivateKey, sign as edSign } from 'node:crypto'

export function envelopeFor(home: string, port: number, zone: string): Record<string, string> {
  const key = createPrivateKey(readFileSync(join(home, 'a2a', 'node-key.pem'), 'utf8'))
  const callerUrl = `http://127.0.0.1:${String(port)}`
  const ts = Date.now()
  const signature = edSign(undefined, Buffer.from(JSON.stringify([zone, callerUrl, ts]), 'utf8'), key).toString('base64')
  return {
    'X-A2A-Caller': zone,
    'X-A2A-Caller-Url': callerUrl,
    'X-A2A-Caller-Ts': String(ts),
    'X-A2A-Caller-Sig': signature,
  }
}
