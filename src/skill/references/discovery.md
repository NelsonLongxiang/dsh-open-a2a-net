# Discovery and the peer boundary model

## Cards

Each node serves `/.well-known/agent-card.json`: a signed core (identity +
capability flags) plus unsigned serve-fresh fields.

- An anonymous fetch gets the MINIMAL card: no `sessionTeams`,
  `teamMemberships`, `canvasOrg` or `lanIp`.
- The full card goes only to a caller that presents an OriginClaim envelope
  (`X-A2A-Caller` / `-Url` / `-Ts` / `-Sig`, signed with the caller's card
  key) AND that this host links: the same origin (self-fetch), one of its
  joined session handles, an exact canvas remote member ref the operator
  added (#18, #19 D1), or bilateral seeding — this host's `peers` config
  names the caller's origin AND the caller's card lists this host's origin
  among its peers (both operators made the gesture). Proving a key is not a
  link.
- Peers poll cards and aggregate the `sessionTeams` they are entitled to into
  their `remote` rows — this is how the planning canvas shows other nodes.

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
