# Release Provenance: source gap record and clean-source policy (proposed)

- **Status**: proposed — this document becomes a project rule only after a normal PR review (non-author reviewer) lands it.
- **Basis**: supervisor rulings direct-91d8539b (no reconstruction of past history) and direct-83a25c09 (submit via PR; three wording corrections).
- **Scope**: release builds and publish evidence from 0.6.30 on. No build/install/tag/Release/publish is authorized by this document.

## 1. v0.6.29 source-gap record (statement of record)

**Established (artifact identity)**
- npm `@nelsonlongxiang/dsh-open-a2a-net@0.6.29` published 2026-10-28T01:47:56.038Z, shasum `d2dc83c364746b1e6d632c46a05815b09fc80cda`.
- Local candidate `candidate.tgz` (1,007,693 B, mtime 09:41 +0800) has sha1 `d2dc83c36474` — equal to the registry shasum, so the published artifact is byte-identical to that tgz. Digest equality proves artifact bytes only; it does not prove which source produced them.

**Not established (source build chain)**
- The reflog records HEAD=`eaab508` at 09:36:47; a reflog entry and an mtime do not prove the working tree did not change between that record and the pack.
- `package/lib/` containing 71 files proves the package ships those files; it does not by itself prove `prepare` ran for this build.
- The tree was dirty at pack time (`assets/nexusDist` files in a stash-pop state); the candidate tree is therefore not identical to a pure `eaab508`.
- No build log and no publish-action log were retained on this host.

**Record verdict**: artifact identity established; source build chain unproven; release metadata (tag/Release) not backfilled. Issue #55's residual item stays visible and is not closed by this document's review.

## 2. Policy (proposed clauses)

### A. Build and pack inputs
1. **Pack input manifest**: the packing list is the full `files` manifest from `npm pack --dry-run --json`, stored line by line. An empty `git status --porcelain` is NOT proof of a clean input — ignored `lib/` or `dist/` can hide stale artifacts.
2. **Isolated output**: builds run only into an approved isolated output directory (`tmp/release/<version>/build/`); nothing is written into the shared tree. Cleanup removes only the run's own artifacts, and the removed paths are recorded. Cleaning the shared tree "just to be clean" and `git stash` as a cleanliness trick are both forbidden.
3. **Identity triple**: `HEAD_SHA`, `TREE_SHA` (`git rev-parse HEAD^{tree}`) and the package version go on the log's first line; HEAD/dirty snapshots are taken immediately before packing too, and any difference between the two snapshots refuses the release.
4. **Environment capture**: node and pnpm versions, OS, lockfile sha256, the exact build command and its exit code.

### B. Publishing
5. **One tgz, one identity**: verify and publish the same tgz file (record its sha256 and sha1). `npm publish <dir>` is forbidden because it re-runs `prepare` and repacks; the publish command takes the file argument.
6. **Evidence surface**: the actual pack/prepare commands with exit codes, before/after HEAD, dirty state and output hashes, the publish log (sensitive fields redacted), and a registry read-back compared byte for byte with the local artifact. The registry comparison **downloads the published tarball and computes its digests** — it does not assume the registry metadata carries a SHA256 field; the registry `integrity` (SHA512) and remote shasum are recorded alongside the locally computed ones.
7. **Seal the log before shipping**: `provenance.json`, `build.log` and `pack.manifest` are sealed into a package whose digest is recorded **outside it** (a sidecar file or the audit ledger) — the package never certifies its own hash. GitHub Release assets are distribution copies, not the single source of truth. A release that fails mid-way is accounted stage by stage; success is never claimed for a partial run.

### C. Tag and authorization
8. **Tag conditions**: a tag is created only when all of the following hold: (a) source-artifact manifest agreed; (b) the project's independent gates passed (validators and the dual-stamp rule); (c) an authorization record exists (owner or chief-engineer); (d) a remote refs query shows the target tag neither exists nor conflicts; (e) the tag points at the verified `HEAD_SHA`. A conflict or drift never moves an existing tag; a new ruling and a new version are required instead.

## 3. Counterexample cases (to be EXECUTED, not assumed to pass)

These are test cases for the implementation PRs that land this policy. Each must ship with machine evidence (command output, exit codes, rc) in that PR; this document does not claim any of them has passed.

| Case | Setup | Expected refusal |
|---|---|---|
| C1 ignored stale dist | shared tree `git status` empty while `lib/` is an older build (ignored) | pack manifest entries disagree with this run's build output hashes → refused |
| C2 directory publish repack | verify `candidate.tgz`, then `npm publish <dir>` | prepare repacks; published sha256 differs from the verified tgz → refused (command shape gate: publish accepts a file argument only) |
| C3 head drift | snapshot HEAD before packing differs from the one logged | before/after snapshots disagree → refused |
| C4 digest mismatch | registry read-back integrity/SHA256 differs from the local tgz bytes | mismatch → refused, no tag |
| C5 pre-existing tag | target vX.Y.Z tag already exists or points elsewhere | remote refs conflict → refused; the tag is never moved |

## 4. Boundaries

This document does not reconstruct past history, does not fabricate logs, and does not clean or modify other people's directories or worktrees. Scripts added to enforce it must be registered in the same commit as the policy clause they serve.
