/**
 * An external A2A node in one file: signs its card, runs a mock peer,
 * fetches that peer's card with a verifiable OriginClaim envelope,
 * delivers a direct route with caller_session / task_id / context_id, and
 * formats + parses the receipt — all through the four npm subpath exports.
 *
 * Run: npm install && node index.mjs
 */
import { createServer } from 'node:http'
import { generateKeyPairSync, createPrivateKey, sign as edSign } from 'node:crypto'

// ① ② ③ ④ — the four subpaths this example exercises:
import { signCard, verifyCard } from '@nelsonlongxiang/dsh-open-a2a-net/card'
import { A2aClient } from '@nelsonlongxiang/dsh-open-a2a-net/a2a-client'
import { formatReceipt, parseReceipt } from '@nelsonlongxiang/dsh-open-a2a-net/receipt'
import { withinRouteBodyCap } from '@nelsonlongxiang/dsh-open-a2a-net/transport-caps'

// ── Self-implementation 1: identity key (persist this in production!) ──
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const MY_ZONE = 'ext-demo'
const MY_BASE_URL = 'http://127.0.0.1:39999' // demo-only; our mock publishes nothing

// ── ① /card — sign this node's agent card ──
const card = signCard({
  name: 'external demo node',
  session: 'ext-demo-session',
  team: MY_ZONE,
  capabilities: { route: true, async: true, roster: true },
  expiresAt: Date.now() + 172_800_000,
}, privateKey)
console.log('[card] signed:', card.team, 'sig ok →', verifyCard(card, Date.now()).ok)

// ── Self-implementation 2: the OriginClaim envelope signer ──
function originClaimHeaders() {
  const ts = Date.now()
  const signature = edSign(undefined, Buffer.from(JSON.stringify([MY_ZONE, MY_BASE_URL, ts]), 'utf8'), privateKey).toString('base64')
  return { 'X-A2A-Caller': MY_ZONE, 'X-A2A-Caller-Url': MY_BASE_URL, 'X-A2A-Caller-Ts': String(ts), 'X-A2A-Caller-Sig': signature }
}

// ── Self-implementation 3: transport + schedule seams for the client ──
const fetchImpl = (url, init) => fetch(url, init).then(async r => ({ ok: r.ok, status: r.status, text: () => r.text() }))
const schedule = (cb, ms) => { const t = setTimeout(cb, ms); return () => clearTimeout(t) }

const peerKey = generateKeyPairSync('ed25519')
const peerCard = signCard({ name: 'mock peer', session: 'mock-session', team: 'peer-zone', capabilities: { route: true }, expiresAt: Date.now() + 3600_000 }, peerKey.privateKey)

// Mock peer: serves the card, verifies the envelope on delivery, answers.
const mock = createServer((req, res) => {
  if (req.url === '/.well-known/agent-card.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(peerCard)); return }
  if (req.url === '/a2a/direct' && req.method === 'POST') {
    let body = ''
    req.on('data', c => { body += c })
    req.on('end', () => {
      const msg = JSON.parse(body)
      const verdict = verifyCard(peerCard, Date.now()) // the real server verifies the CALLER's envelope against the fetched caller card; the demo echoes the correlation shape
      const receipt = formatReceipt(msg.task_id ?? 'direct-demo', 'processed by mock peer', { outcome: 'completed', idempotencyKey: msg.task_id })
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ routed: verdict.ok, result: { text: receipt }, task_id: msg.task_id, context_id: msg.context_id }))
    })
    return
  }
  res.statusCode = 404; res.end('{}')
})
await new Promise(resolve => mock.listen(39998, '127.0.0.1', resolve))

const client = new A2aClient({ apiKey: '', sessionId: 'ext-demo-session', cardCaller: MY_ZONE, originClaim: originClaimHeaders, schedule, fetch: fetchImpl })

// ── ② /a2a-client — fetch the peer's FULL card via the envelope ──
const fetched = await client.fetchCardDetail('http://127.0.0.1:39998')
if (!fetched.ok) throw new Error('card fetch failed: ' + fetched.reason)
console.log('[client] peer card verified:', fetched.card.team, fetched.card.name)

// ── ④ /transport-caps — check the body budget before the wire ──
const message = 'hello from an external node'
console.log('[caps] body within route cap:', withinRouteBodyCap(Buffer.byteLength(JSON.stringify({ team: 'peer-zone', message }), 'utf8')))

// ── ③ /a2a-client delivery — caller_session / task_id / context_id ride the body ──
const taskId = `direct-ext-${Math.random().toString(16).slice(2, 10)}`
const contextId = `ctx-ext-${Math.random().toString(16).slice(2, 10)}`
const reply = await client.routeDirect('http://127.0.0.1:39998', 'peer-zone', message, contextId, undefined, MY_ZONE, false, taskId)
if (reply.ok !== true) throw new Error('delivery failed: ' + String(reply.error))
console.log('[route] delivered:', reply.task_id, '· context:', reply.context_id)

// ── ④ /receipt — format a receipt, parse it back, and read the peer's ──
const demoReceipt = formatReceipt(taskId, 'external node round-trip', { outcome: 'completed', idempotencyKey: taskId })
const parsed = parseReceipt(demoReceipt)
console.log('[receipt] parsed:', `[A2A receipt] task ${parsed.taskId} ${parsed.summary}`)

mock.close()
