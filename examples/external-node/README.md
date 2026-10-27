# External A2A node (example)

An external implementer — a process that is NOT a DSH host — talks to the
A2A network by installing the package from npm and using its four subpath
exports. `node index.mjs` runs against an embedded mock peer.

## Three things you implement yourself

1. **Identity key** — an Ed25519 keypair is the node's identity anchor;
   persist it like the DSH host does (`<home>/a2a/node-key.pem`).
2. **The OriginClaim envelope signer** — the four-header closure the SDK
   client calls before every peer request (canonical form
   `JSON.stringify([caller, callerUrl, ts])`, signed with the card key).
3. **Transport + schedule seams** — thin adapters over `fetch` and
   `setTimeout` (the client takes them as constructor options).

## The four subpath exports exercised

| Subpath | In this example |
|---|---|
| `@nelsonlongxiang/dsh-open-a2a-net/card` | `signCard` your card, `verifyCard` peers' cards |
| `@nelsonlongxiang/dsh-open-a2a-net/a2a-client` | `A2aClient` — full-card fetch via the OriginClaim envelope, `routeDirect` delivery with `caller_session` / `task_id` / `context_id` |
| `@nelsonlongxiang/dsh-open-a2a-net/receipt` | `formatReceipt` / `parseReceipt` — the `[A2A receipt] task <id>` envelope |
| `@nelsonlongxiang/dsh-open-a2a-net/transport-caps` | `withinRouteBodyCap` — the ≤512KiB wire budget check |

## Run

```bash
npm install && node index.mjs
```

Expected: five log lines — `[card]`, `[client]`, `[caps]`, `[route]`,
`[receipt]` — and exit 0.
