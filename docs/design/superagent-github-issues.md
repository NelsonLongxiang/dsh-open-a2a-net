# superagent: GitHub issues as a source of requests

Status: authorized by the owner on 2026-11-10 ("these are all mine to authorize"), with the defaults below.

## Context

Upstream superagent takes new work from GitHub: issues, pull requests, comments, CI. This plugin only followed the pull requests its own tickets opened (`pr-follow.ts`): GitHub was not a source of new work. The owner wants to file work for a team from a GitHub issue, and the team's allowed GitHub logins to come from the repositories' collaborators rather than be typed by hand.

## Decisions

- **G1 Off until the owner turns it on.** `sources.github` (default off) and `github: { repos, intake }` in the team settings. `repos` lists up to 10 repositories as `owner/name`. Pull request follow-ups keep working whatever the switch says.
- **G2 What counts as a request.** A new issue (not a pull request) in a listed repository. With `intake: 'mention'` (the default) it must carry the label `superagent` or mention `@superagent` in its title or body; with `intake: 'all'` every new issue counts. Issues that already existed when a repository was added are not news.
- **G3 Who counts as a person.** Only a login on `allowed.github` files explicit work, the same gate as every other source: an allowed person addressing the team is explicit; anyone else's new issue is recorded and refused as not listed. Bots (GitHub `type: Bot`) are never persons. The owner's own authority in a session (D11) is unchanged: nothing from GitHub can stop a ticket or change rules.
- **G4 Follow-ups.** A comment on an issue the team took is a follow-up on that issue's thread, gated as follow-ups are (an allowed person is explicit; anyone else is inferred, which accept mode `off` refuses).
- **G5 Replies go back to the issue.** The router's replies on an issue's thread are posted as issue comments with the host's `gh` login, prefixed `[superagent]`. A comment that cannot be posted stays pending and is retried on the next pass.
- **G6 Allowed logins from collaborators.** `{ action: 'sync-github-allowed' }` adds the logins with push access to the listed repositories to `allowed.github`. It adds and never removes: removing a person stays a deliberate edit.
- **G7 Changing who may file work needs the owner.** A settings write that touches `github`, `allowed.github` or `sources.github` needs the owner's logged-in browser, as a rule change does (D10), and so does the sync. The workbench and A2A lists and switches keep today's route.
- **G8 Polling.** One round a minute while the team is not paused, backing off up to 15 minutes on failure, as the pull request follower does. A round reads each repository's recently updated issues and its recent comments; what it saw is kept in `github-issues.json` in the team's state directory.

## Consequences

The host needs a `gh` that is logged in and can read the repositories (and comment on them for G5). Polling is minutes, not seconds. A person removed from `allowed.github` keeps the tickets already accepted on their word; revalidation reports the change to open tickets as for any other source.
