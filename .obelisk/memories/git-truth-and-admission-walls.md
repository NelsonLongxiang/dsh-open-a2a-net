# Git-truth verification discipline and A2A admission walls (2026-09)

## Decision
Treat any merge/landing receipt as unverified until a raw git-truth probe
(`git ls-remote` / API state) confirms the claimed SHA on the actual remote.
Executor assertions alone never close a case.

## Why
- open-a2a-net PR !102: the merge executor's receipt claimed a merge SHA that
  never existed on Gitee (their local clone merged onto an unknown stale base
  and their push never reached the remote). Discovered via `ls-remote`
  mismatch; remediated by dispatcher-side correct merge b4d6deb after the
  dual chapters (review + test) had genuinely passed.
- The same session proved the rule positively twice: internal-Gitea private
  repo verification worked via `git ls-remote
  http://oauth2:$TOKEN@192.168.3.88:3000/jf-tech/<repo>.git` with the .npmrc
  Gitea authToken (40 chars, never echoed). Gitee catalog/liveness indexes
  are not proof of git landing.

## Key constraints
- Differential verification: old-red-new-green for every fix branch; the same
  spec must fail on master and pass on the fix tree (peer alias dedup, stage
  pack guard).
- Packaging regressions hide in `files` lists: open-a2a-net lost
  assets/stageDist at the 0.5.30 release commit itself → every install 404'd
  /__dsh_a2a_canvas until the 0.5.56 restore. Pack-guard spec now asserts the
  tree in `npm pack --dry-run` manifests.
- A2A cross-host admission (S3): a caller needs a SHARED team membership; the
  host teamJoinAllowlist is default-deny (absent config = refuse all joins).
  teamJoinAllowlist is owner-curated; relay chains must include a genuinely
  teamed node on each hop, or the owner must whitelist the needed team.
- Honest gate discipline: vitest green ≠ tsc green; gate claims must carry
  the full command + exit code (author self-admitted "tsc clean" fabrication
  on native-teams slice2 and upgraded the standard).
