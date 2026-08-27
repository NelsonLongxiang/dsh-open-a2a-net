# Protocol Note: Organizational Fingerprint Aggregation — Residual Risk Criteria

- **Status**: accepted-as-criteria (work-order P5 / ROUND-2 Cluster C3)
- **Owner**: dsh-open-a2a-net (protocol face)

## 1. Purpose

The visible-not-addressable governance stance intentionally publishes SOME
facts about teams while withholding addressability. This note fixes the
vocabulary, threat taxonomy, and residual-risk ratings agreed in ROUND-2 so
future surface changes have a stable rubric to argue against.

## 2. Vocabulary

| Term | Definition |
|---|---|
| Routable surface | Fields whose names are legitimate route targets: narrowed `sessionTeams` (group entries + captains), routable GroupRecord members |
| Facts surface | `internalFacts[]`: display metadata (handle, title, excerpt, role, `routable:false`) |
| Excerpt | One-line recent-activity text derived from session events (today ships on cards by design) |
| Handle | Opaque reference replacing real names where linkage matters; deterministic derivation (e.g. id8) is trackable over time |
| Granted counterpart | A remote node holding a valid inbound ExposureGrant |

## 3. Threat taxonomy and ratings

| ID | Vector | Rating | Rationale |
|---|---|---|---|
| F1 | Granted counterpart aggregates internalFacts | L1 negligible | Designed visibility inside the trust circle; a grant IS consent |
| F2 | Third parties aggregate excerpts for behavioral profiling | **MEDIUM** | Excerpts ship plaintext on cards today (pre-governance baseline); long-horizon correlation maps activity rhythms and leaks business text fragments |
| F3 | Stable handles enable longitudinal tracking | L2 low | Deterministic id8 derivable from public session ids; rotation possible but currently unused |

## 4. Knobs and defaults (rubric obligations)

| Surface | Default | Obligation |
|---|---|---|
| internalFacts publication | OFF (`publishInternalFacts=false`) | C4 consensus; opt-in only |
| Group visibility | `visibility:'private'` for governed groups | facts travel in-task, not on durable public cards |
| Excerpt emission | `excerptMode:'full'` (compatibility) | MUST add `'redacted'`,`'off'` modes; document risk; change does NOT block governance rollout |
| Handle stability | derived id8 today | rotation hook listed in exposure doc appendix; not blocking |

## 5. Residual statement

After governance rollout with defaults above: overall residual rating
LOW-MEDIUM, dominated solely by F2 excerpt aggregation. The rubric obliges
any future card-field addition to state its effects on F1–F3 in the same
table format; unassessed surface changes are review-blocking by convention.

## 6. Review cadence

Rerun ratings whenever (a) a new card field ships, (b) excerpt generation
logic changes, or (c) a grant scope widens beyond `'pair'`.
