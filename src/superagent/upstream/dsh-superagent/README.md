# Vendored superagent domain engine

This directory is upstream [dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype) at the commit named in `UPSTREAM.json`, byte for byte, under its MIT license (`../LICENSE.dsh-superagent`).

- `src/core/`: the pure domain engine. It contains the Source → Trigger → Thread → Eval → Decision → Ticket → Assignment flow, its rules, and the ports it depends on (`ports.ts`): repositories, policy, source scope, assessor, executor and outbox. It imports nothing but `node:crypto`.
- `tests/`: upstream's own engine tests, run unchanged by this repository's suite. They are the evidence that the vendored engine behaves as upstream's.

## Rules

- **Never edit these files.** a2a adapts to the engine through its ports, in code outside this directory. `node scripts/superagent-upstream.mjs` (also run as a unit test) fails on any byte that differs from `UPSTREAM.json`, on any unlisted file, and on any import that leaves the engine.
- **Syncing to a newer upstream commit** is a reviewed change of its own:
  1. Run `node scripts/superagent-upstream.mjs --compare <checkout>` to see what changed.
  2. Run `--sync <checkout> --commit <sha>` to copy the files and rewrite the manifest.
  3. Run the full suite.
- Only the domain engine lives here. Upstream's store, views and panel are entangled with its app (its sources, migrations and settings), so a2a implements those against the ports instead of vendoring them.
