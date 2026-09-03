# Discovery and the peer boundary model

## Cards

Each node serves `/.well-known/agent-card.json` (unsigned serve-fresh fields:
`peers`, `sessionTeams`, `teamMemberships`, `version`, `lanIp`; signed core:
identity + capability flags). Peers poll cards and aggregate `sessionTeams`
into their `remote` rows — this is how the planning canvas shows other nodes.

## Visibility follows membership

An unjoined session node is NOT advertised: it is absent from the served
card's `sessionTeams` and invisible to peer discovery. Join to appear; leave
to vanish. The node's own state face keeps every session (management surface
is local-only).

## The peer boundary model (connection layer)

Referrals — peer URLs learned from other peers' cards — pass two gates:

1. `referralLearning: false` freezes the tracked set to the configured seed
   (`peers` config) for that config's lifetime: referrals are neither learned
   nor offered.
2. A non-empty `peerAllowlist` admits a referral only when its host matches
   an entry — exact `host[:port]`, bare domain suffix (`.example.com`), or
   the full URL. An empty list keeps the historical open-referral posture.

Seeds from the `peers` config are owner-configured and never filtered.

Self-referrals (a peer listing this node's own URL back) are dropped and
remembered as aliases so mirrored lists stop re-offering them.

## Where to look

- Node state: `GET /__dsh_a2a/state`
- Card: `GET /.well-known/agent-card.json`
- Direct delivery: `POST /a2a/direct` (`{team, message, caller_session, wait}`)
- Task query: `POST /a2a/query` (`{task_id, fingerprint}`)
