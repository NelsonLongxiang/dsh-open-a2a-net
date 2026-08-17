# @nelsonlongxiang/dsh-open-a2a-net

Open A2A network plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): turns a DSH
deployment into one node of a decentralized agent network — no central server, no registry.

Each node publishes a **signed, expiring agent card** at `/.well-known/agent-card.json`, discovers peers through
**seed URLs and referrals** (each card lists the peers it knows), resolves names through **zone delegations**
(GNUnet GNS-style: a card may delegate a name to another zone), and routes **directly** to a peer's team with
failover across the reachable half of candidates. Every main session can additionally be exposed as a **session
node** other hosts can discover and join from the web sidebar.

## Install

```sh
npx -p @deepseek-ai/dsh dsh plugin --profile <name> add @nelsonlongxiang/dsh-open-a2a-net
```

(As a package specifier, a local path, or a Git URL; the package declares no `prepare`, so a Git or path install
needs `pnpm build` in the repository first.) Then restart the profile. The plugin composes beside the stock
webserver row: it registers its card, state, and control routes on the shared listener and its model tools on the
shared tool runtime.

## What you get

- **Model tools** — `a2a_teams` lists the teams this node can see (own, peers', joined sessions'); `a2a_route`
  sends one message to a team, reuses `context_id` to continue a remote conversation, and fails over across
  candidates when a peer is unreachable.
- **Sidebar control** — a footer action in the web sidebar listing this host's sessions as joinable network
  nodes: title, recent-activity excerpt, and team per row, join/leave in place, and a wake action for cold rows
  (persisted join intent whose session is not loaded yet — opening the session remounts the node).
- **Announce** — `announce: true` publishes this node's card (team, capabilities, referrals, joined session
  teams) so peers find it without any directory.

## Configuration

Row config overlays in the profile's patch layers; every key has a schema default.

| Key | Default | Purpose |
| --- | --- | --- |
| `announce` | `false` | Publish this node's agent card for peer discovery. |
| `peers` | `[]` | Seed base URLs; referred peers are learned from their cards. |
| `delegates` | `[]` | Zone delegations: `{ name, url, publicKey }` published on the card. |
| `team` | `'dsh'` | Team name this node exposes for direct routing. |
| `session` | `''` | Caller label; `''` derives a stable `dsh-host-<8hex>` per home. |
| `agentName` | `'DeepSeek Harness A2A node'` | Human-facing name on the card. |
| `apiKey` | `''` | `X-API-Key` sent on peer requests; non-empty also gates the control routes. |
| `sessionNodes` | `true` | Expose main sessions as joinable network nodes. |
| `cardTtlMs` / `flushTimeoutMs` / `routeTimeoutMs` | see schema | Card lifetime and route timing budgets. |

Example — one announcing node with a seed:

```yaml
- id: a2a
  name: '@nelsonlongxiang/dsh-open-a2a-net'
  config:
    announce: true
    peers: ['http://127.0.0.1:41243']
```

## Trust model

Cards are Ed25519-signed and expire; `peers` referrals and `sessionTeams` listings on a card are unsigned and
read fresh. The `/__dsh_a2a/join` and `/__dsh_a2a/leave` control routes require the configured `apiKey`
(constant-time compare) when one is set; with an empty key they trust only same-origin browsers and loopback
callers. Set an `apiKey` before exposing the listener beyond loopback.

## Verify

```sh
pnpm install   # auto-install-peers pulls the DSH peer train from npm
pnpm verify    # typecheck (host + client) and vitest
pnpm build     # host lib, client types, and the browser bundle (lib/client.js)
```

## License

MIT
