# Protocol: Exposure Grants — Composite Declaration Anchors

- **Status**: accepted-codification of ROUND-2 ruling A4 (the free addendum promised alongside the chair's ACK-A4-SPLIT-DONE); implementation lands with native-teams slice 2 (0.14.0) against `mount`/`TeamDeclaration`
- **Owner**: dsh-open-a2a-net (protocol face)
- **Baselines**: governance-rulings-round2.md §A4 (this repo) · tool-face card v7 design notes (native-teams ledger)

## 1. Purpose and division of labor

A4 introduced composite anchors so a team reference survives rename, multi-host
collision, and content drift without any central registry:

| Party | Commitment |
|---|---|
| Tool face (native-teams) | Every declaration reference emitted by `mount`/`TeamDeclaration` carries the FULL anchor; `TeamRegistry.describeTarget/catalog` expose all three fields |
| Protocol face (this plugin) | Grants/group memberships referencing declarations are validated per §5; mismatch fails loud (`projection-stale`), never silently misbinds |
| Canvas face | Renders projections; drift surfaces as an explicit stale badge fed by the same verdict |

## 2. Protocol constants (frozen; change = destructive, new constant version instead)

```text
ANCHOR_HASH_ALGORITHM = 'sha256'      # over the declaration's canonical form
ANCHOR_HASH_HEX_CHARS = 16            # first 16 hex chars, lowercase
DECLARATION_ID_CHARSET = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
```

Canonical form ownership: the declaration layer owns what "identical content"
means (stable across re-serialization) and publishes that definition; hashing
consumes its canonical bytes. Two producers claiming the same anchor MUST have
byte-identical canonical forms — the hash is the dispute arbiter.

## 3. The CompositeAnchor object

```ts
interface CompositeAnchor {
  /** Host-stable identifier of the declaring origin (reuses the identity-anchor surface; opaque elsewhere). */
  readonly originHostAnchor: string
  /** Declared team id, unique within its origin host only. */
  readonly declarationId: string
  /** {@link ANCHOR_HASH_ALGORITHM} digest prefix per {@link ANCHOR_HASH_HEX_CHARS}. */
  readonly contentHash: string   // /^[0-9a-f]{16}$/
}
```

Shape checks at every ingress (validation is cheap and total):

1. three fields present, correct charsets (§2);
2. `contentHash` lowercase hex, exactly 16 chars;
3. equality = deep triple equality; any single-field difference ⇒ different
   projection (there is no partial match tier).

## 4. Object integrations

| Carrier | Change |
|---|---|
| `GroupRecord.members[]` | optional `declaration?: CompositeAnchor` alongside the existing `url/publicKey` route facts — presence marks a declared team over an ad-hoc session node |
| `ExposureGrant` | optional `declaration?: CompositeAnchor`; grants referencing declared teams gain drift detection for free |
| `internalFacts[]` | optional same field so foreign canvases can cross-reference frames by origin+id, not name |

All fields optional and additive — anchors never replace route addressing;
they annotate provenance for validation and rendering.

## 5. Validation contract (protocol-face enforcement ladder)

| Verdict | Condition | Consumer action |
|---|---|---|
| `anchored-ok` | triple complete, hash matches the projection currently held | proceed |
| `projection-stale` | id matches, `contentHash` differs | surface stale badge; re-fetch projection; do NOT auto-mutate membership |
| `unknown-anchor` | origin/id unseen | behaves exactly like an unresolved name (`not-found`) — **no existence oracle leak** |
| `malformed-anchor` | §3 shape checks fail | reject the carrying record at authoring time (`validate-at-authoring`, same discipline as grant targets) |

Verdicts ride the cluster-C error-code family; none are advisory-only.

## 6. Acceptance criteria

1. Same `declarationId` declared on two hosts yields two distinct anchors that never unify.
2. Pure rename on the origin flips only `contentHash` (plus backend bookkeeping) — old grants report `projection-stale`, not loss.
3. Restored ledgers/canvas layouts survive restarts without altering any stored anchor byte-for-byte.
4. `describeTarget/catalog` round-trip preserves the triple through the registry with no normalization losses.
5. Validation runs without network I/O on cached data (hash compare is local).

## 7. Open questions (non-blocking)

- Rotation interplay: if handles rotate (see fingerprint criteria F3), does the anchor stay stable? Default: yes — anchors track declarations, not presentation aliases.
- Whether `originHostAnchor` should eventually carry a key fingerprint alongside the label (synergy with delivery-origin-auth §2); deferred until slice 2 exercises real shapes.
